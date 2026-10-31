import type {
  ChatRequest,
  ChatResult,
  LlmClient,
  ToolCall,
} from '../llm/llm-client';
import { LlmError } from '../llm/llm-error';
import type { TaskExecutionInput } from '../tasks/task-executor';
import { VncError } from '../vnc/rfb-session';
import { FakeClock, FakeSession, makeFrame } from '../vnc/testing/fakes';
import type { VncConnector } from '../vnc/vnc-connector';
import { VncDesktop } from '../vnc/vnc-desktop';
import { ScreenAgent } from './screen-agent';

const W = 100;
const H = 80;
const PASSWORD = 'desk-secret-pw';

let seq = 0;
const call = (name: string, args: Record<string, unknown>): ToolCall => ({
  id: `call-${++seq}`,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
});
const reply = (
  toolCalls: ToolCall[],
  text: string | null = null,
): ChatResult => ({
  toolCalls,
  text,
  model: 'test/model',
  usage: { promptTokens: 100, completionTokens: 10, cost: 0.001 },
  latencyMs: 1,
  attempts: 1,
});

type Step =
  ChatResult | Error | ((req: ChatRequest) => ChatResult | Promise<ChatResult>);

function setup(
  steps: Step[],
  opts: {
    remainingMs?: number;
    instruction?: string;
    connectError?: Error;
  } = {},
) {
  const clock = new FakeClock();
  // Cada evento de entrada cambia la pantalla (bloque de 10×10 en otra posición): settle ve el cambio.
  const ref: { session?: FakeSession } = {};
  const session = new FakeSession(
    clock,
    () => {
      const n = ref.session?.events.length ?? 0;
      return makeFrame(
        W,
        H,
        n ? [{ x: (n * 7) % 80, y: 10, w: 10, h: 10 }] : [],
      );
    },
    W,
    H,
  );
  ref.session = session;
  const desktop = new VncDesktop(session, clock);
  const connector = {
    connect: jest.fn(() =>
      opts.connectError
        ? Promise.reject(opts.connectError)
        : Promise.resolve(desktop),
    ),
  } as unknown as VncConnector;
  const requests: ChatRequest[] = [];
  const chat = jest.fn(async (req: ChatRequest) => {
    requests.push(structuredClone(req));
    const next = steps.shift();
    if (!next) throw new Error('el guion del LLM se agotó');
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next(req) : next;
  });
  const llm: LlmClient = { chat };
  const agent = new ScreenAgent(connector, llm, clock);
  const controller = new AbortController();
  const input: TaskExecutionInput = {
    taskId: 't1',
    instruction:
      opts.instruction ??
      'Registra al cliente Papelería Los Andes, NIT 901234567.',
    desktop: { url: 'wss://desk.example/websockify', password: PASSWORD },
  };
  const run = () =>
    agent.execute(input, {
      signal: controller.signal,
      deadlineAt: clock.now() + (opts.remainingMs ?? 200_000),
    });
  const toolResults = () =>
    requests
      .at(-1)
      ?.messages.flatMap((m) => (m.role === 'tool' ? [m.content] : [])) ?? [];
  return {
    run,
    session,
    connector,
    chat,
    requests,
    controller,
    clock,
    toolResults,
  };
}

describe('ScreenAgent', () => {
  it('camino feliz: escribe, confirma, verifica y termina; cierra VNC al acabar', async () => {
    const { run, session, requests } = setup([
      reply([
        call('click', {
          x: 20,
          y: 20,
          intent: 'escribir',
          reason: 'campo nombre',
        }),
      ]),
      reply([
        call('type', {
          text: 'Papelería Los Andes',
          replace: true,
          reason: 'nombre',
        }),
      ]),
      reply([
        call('click', {
          x: 50,
          y: 70,
          intent: 'confirmar',
          registro: 'nuevo',
          reason: 'guardar',
        }),
      ]),
      reply([
        call('finish', { resumen: 'Cliente creado y verificado en la lista.' }),
      ]),
    ]);
    expect(await run()).toEqual({
      estado: 'terminada',
      resumen: 'Cliente creado y verificado en la lista.',
    });
    expect(session.closed).toBe(true);
    expect(
      session.events.filter((e) => e.kind === 'key').length,
    ).toBeGreaterThan(0);

    const last = requests.at(-1)!;
    const images = last.messages.flatMap((m) =>
      m.role === 'user' && Array.isArray(m.content)
        ? m.content.filter((p) => p.type === 'image_url')
        : [],
    );
    expect(images).toHaveLength(1); // solo la última captura viaja al modelo
    expect(last.messages[0]).toMatchObject({ role: 'system' });
    expect(JSON.stringify(last.messages)).toContain(
      'Papelería Los Andes, NIT 901234567',
    );
    expect(JSON.stringify(requests)).not.toContain(PASSWORD); // la contraseña nunca va al modelo
    expect(last.tools.map((t) => t.function.name)).toContain('finish');
  });

  it('bloquea una acción destructiva no pedida sin enviar eventos, y el modelo termina con fail', async () => {
    const { run, session, toolResults } = setup([
      reply([
        call('click', {
          x: 5,
          y: 5,
          intent: 'eliminar',
          reason: 'borrar el duplicado',
        }),
      ]),
      reply([call('fail', { resumen: 'La tarea no pide borrar nada.' })]),
    ]);
    expect(await run()).toEqual({
      estado: 'fallida',
      resumen: 'La tarea no pide borrar nada.',
    });
    expect(session.events).toHaveLength(0);
    expect(toolResults()[0]).toMatch(/^BLOQUEADA: acción destructiva/);
  });

  it('homónimos: bloquea editar con 2 coincidencias y propaga el fail con los identificadores', async () => {
    const { run, session } = setup(
      [
        reply([
          call('key', {
            combo: 'Enter',
            intent: 'confirmar',
            registro: 'existente',
            coincidencias: 2,
            reason: 'guardar',
          }),
        ]),
        reply([
          call('fail', {
            resumen:
              'Hay dos «Ana Torres»: 52345678 y 1019876543. No se modificó ninguno.',
          }),
        ]),
      ],
      { instruction: 'Cambia el teléfono de Ana Torres a 3014445566.' },
    );
    expect(await run()).toMatchObject({
      estado: 'fallida',
      resumen: expect.stringContaining('1019876543'),
    });
    expect(session.events).toHaveLength(0);
  });

  it('con menos de 40 s no deja confirmar', async () => {
    const { run, session, toolResults } = setup(
      [
        reply([
          call('click', {
            x: 5,
            y: 5,
            intent: 'confirmar',
            registro: 'nuevo',
            reason: 'guardar',
          }),
        ]),
        reply([
          call('fail', { resumen: 'Sin tiempo para guardar y verificar.' }),
        ]),
      ],
      { remainingMs: 30_000 },
    );
    expect((await run()).estado).toBe('fallida');
    expect(session.events).toHaveLength(0);
    expect(toolResults()[0]).toMatch(/^BLOQUEADA: quedan 30 s/);
  });

  it('rechaza acciones mal formadas y combinaciones de teclas desconocidas sin actuar', async () => {
    const { run, session, toolResults } = setup([
      reply([call('click', { x: 999, y: 5, intent: 'navegar', reason: 'r' })]),
      reply([
        call('key', { combo: 'ctrl+nope', intent: 'navegar', reason: 'r' }),
      ]),
      reply([call('finish', { resumen: 'listo' })]),
    ]);
    expect((await run()).estado).toBe('terminada');
    expect(session.events).toHaveLength(0);
    expect(toolResults()[0]).toMatch(/^RECHAZADA: click: x fuera de rango/);
    expect(toolResults()[1]).toMatch(/^RECHAZADA: key: /);
  });

  it('tres respuestas inválidas seguidas → fallida', async () => {
    const bad = () =>
      reply([call('click', { x: -1, y: 0, intent: 'navegar', reason: 'r' })]);
    const { run } = setup([bad(), bad(), bad()]);
    expect(await run()).toMatchObject({
      estado: 'fallida',
      resumen: expect.stringContaining('acciones válidas'),
    });
  });

  it('respuesta solo con texto: se pide una herramienta y se continúa', async () => {
    const { run, requests } = setup([
      reply([], 'Creo que ya está.'),
      reply([call('finish', { resumen: 'ok' })]),
    ]);
    expect((await run()).estado).toBe('terminada');
    expect(requests[1].messages.at(-1)).toEqual({
      role: 'user',
      content: 'Responde con exactamente UNA herramienta.',
    });
  });

  it('con varias tool calls ejecuta solo la primera y responde a todas', async () => {
    const first = call('click', {
      x: 10,
      y: 10,
      intent: 'navegar',
      reason: 'menú',
    });
    const second = call('click', {
      x: 60,
      y: 60,
      intent: 'navegar',
      reason: 'otro',
    });
    const { run, session, requests } = setup([
      reply([first, second]),
      reply([call('finish', { resumen: 'ok' })]),
    ]);
    await run();
    const clicks = session.events.filter(
      (e) => e.kind === 'pointer' && e.mask === 1,
    );
    expect(clicks).toHaveLength(1);
    expect(clicks[0]).toMatchObject({ x: 10, y: 10 });
    const tools = requests[1].messages.flatMap((m) =>
      m.role === 'tool' ? [m] : [],
    );
    expect(tools.map((t) => t.tool_call_id).sort()).toEqual(
      [first.id, second.id].sort(),
    );
  });

  it('cuatro bloqueos seguidos → fallida por política', async () => {
    const del = () =>
      reply([call('click', { x: 1, y: 1, intent: 'eliminar', reason: 'r' })]);
    const { run } = setup([del(), del(), del(), del()]);
    expect(await run()).toMatchObject({
      estado: 'fallida',
      resumen: expect.stringContaining('bloqueadas'),
    });
  });

  it('si no conecta, falla sin llamar al modelo', async () => {
    const { run, chat } = setup([], {
      connectError: new VncError('AUTH_FAILED', 'x'),
    });
    expect(await run()).toEqual({
      estado: 'fallida',
      resumen:
        'No se pudo conectar al escritorio (AUTH_FAILED); no se realizó ningún cambio.',
    });
    expect(chat).not.toHaveBeenCalled();
  });

  it('watchdog: al abortar destruye la sesión y no envía más eventos', async () => {
    const at: { eventsAtAbort?: number; abort?: () => void } = {};
    const { run, session, controller } = setup([
      reply([
        call('click', { x: 10, y: 10, intent: 'navegar', reason: 'menú' }),
      ]),
      // El watchdog salta mientras el modelo piensa; luego el modelo "responde" otra acción.
      () => {
        at.eventsAtAbort = session.events.length;
        at.abort?.();
        return reply([
          call('click', { x: 60, y: 60, intent: 'navegar', reason: 'otro' }),
        ]);
      },
    ]);
    at.abort = () => controller.abort();
    const out = await run();
    expect(at.eventsAtAbort).toBeGreaterThan(0); // el primer clic sí se envió
    expect(session.events).toHaveLength(at.eventsAtAbort!); // nada después del abort
    expect(out).toMatchObject({
      estado: 'fallida',
      resumen: expect.stringContaining('Tiempo agotado'),
    });
    expect(session.closed).toBe(true);
  });

  it('sin tiempo para otra llamada (NO_TIME) → fallida por tiempo y cierra VNC', async () => {
    const { run, session } = setup([new LlmError('NO_TIME', 'sin tiempo')]);
    expect(await run()).toMatchObject({
      estado: 'fallida',
      resumen: expect.stringContaining('Tiempo agotado'),
    });
    expect(session.closed).toBe(true);
  });

  it('el resumen de finish con dos líneas respuesta se bloquea y se pide corregir', async () => {
    const { run, toolResults } = setup([
      reply([call('finish', { resumen: 'respuesta: 45\nrespuesta: 3' })]),
      reply([call('finish', { resumen: 'respuesta: 45; 3' })]),
    ]);
    expect(await run()).toEqual({
      estado: 'terminada',
      resumen: 'respuesta: 45; 3',
    });
    expect(toolResults()[0]).toMatch(/^BLOQUEADA: el resumen/);
  });
});

describe('ScreenAgent: notas y bucles (E3 en vivo)', () => {
  const nav = (x: number, nota?: string) =>
    reply([
      call('click', {
        x,
        y: 10,
        intent: 'navegar',
        reason: 'página',
        ...(nota ? { nota } : {}),
      }),
    ]);

  it('acumula las notas y las muestra en cada captura siguiente', async () => {
    const { run, requests } = setup([
      nav(10, 'pág. 1: 20 filas'),
      nav(20, 'pág. 2: 20 filas'),
      reply([
        call('finish', {
          resumen:
            'respuesta: 45\npág. 1: 20 + pág. 2: 20 + pág. 3: 5, todas vistas.',
        }),
      ]),
    ]);
    expect((await run()).estado).toBe('terminada');
    const lastUser = JSON.stringify(requests[2].messages.at(-1));
    expect(lastUser).toContain('Tus notas hasta ahora');
    expect(lastUser).toContain('Paso 1: pág. 1: 20 filas');
    expect(lastUser).toContain('Paso 2: pág. 2: 20 filas');
  });

  it('avisa al repetir la misma acción 3 veces en 6 pasos', async () => {
    const { run, toolResults } = setup([
      nav(10),
      nav(10),
      nav(10),
      reply([call('fail', { resumen: 'No pude contar.' })]),
    ]);
    await run();
    const results = toolResults();
    expect(results[1]).not.toContain('AVISO');
    expect(results[2]).toContain(
      'AVISO: has repetido esta misma acción 3 veces',
    );
  });
});
