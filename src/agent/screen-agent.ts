import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { type Clock, wallClock } from '../common/clock';
import {
  type AgentAction,
  actionTools,
  parseToolCall,
  type ScreenSize,
} from '../llm/actions';
import type { LlmClient } from '../llm/llm-client';
import { LlmError } from '../llm/llm-error';
import { LLM_CLIENT } from '../llm/llm.constants';
import type { TaskOutcome } from '../tasks/task';
import type {
  TaskExecutionContext,
  TaskExecutionInput,
  TaskExecutor,
} from '../tasks/task-executor';
import { parseKeyCombo } from '../vnc/keys';
import { toPngDataUrl } from '../vnc/png';
import { VncError } from '../vnc/rfb-session';
import { VncConnector } from '../vnc/vnc-connector';
import type { VncDesktop } from '../vnc/vnc-desktop';
import {
  AGENT_CLOCK,
  MAX_BLOCKED_IN_A_ROW,
  MAX_INVALID_IN_A_ROW,
  MAX_STEPS,
} from './agent.constants';
import { Conversation } from './conversation';
import { checkAction, type CommitRecord } from './guard';
import { systemPrompt, taskMessage } from './prompt';

const RESUMEN = {
  connect: (code: string) =>
    `No se pudo conectar al escritorio (${code}); no se realizó ningún cambio.`,
  time: 'Tiempo agotado: se detuvo toda interacción con el escritorio antes del límite.',
  steps:
    'Se alcanzó el máximo de pasos sin completar ni verificar la tarea; se detuvo la interacción.',
  invalid:
    'El modelo no produjo acciones válidas de forma reiterada; se detuvo la interacción sin completar la tarea.',
  blocked:
    'Las acciones propuestas fueron bloqueadas reiteradamente por la política de seguridad; se detuvo la interacción.',
  error:
    'Error durante la ejecución; se detuvo toda interacción con el escritorio.',
};

/**
 * Agente de pantalla (ADR-0003): observar → decidir (LLM) → Guard → actuar (VNC) → verificar.
 * Implementa el puerto TaskExecutor: al volver, la sesión VNC ya está cerrada; si la señal
 * se aborta (watchdog), destruye la sesión de inmediato y no envía más eventos.
 */
@Injectable()
export class ScreenAgent implements TaskExecutor {
  private readonly logger = new Logger('ScreenAgent');
  private readonly clock: Clock;

  constructor(
    private readonly vnc: VncConnector,
    @Inject(LLM_CLIENT) private readonly llm: LlmClient,
    @Optional() @Inject(AGENT_CLOCK) clock?: Clock,
  ) {
    this.clock = clock ?? wallClock;
  }

  async execute(
    input: TaskExecutionInput,
    ctx: TaskExecutionContext,
  ): Promise<TaskOutcome> {
    let desktop: VncDesktop;
    try {
      desktop = await this.vnc.connect(input.desktop, { signal: ctx.signal });
    } catch (error) {
      const code = error instanceof VncError ? error.code : 'CONNECT_FAILED';
      return { estado: 'fallida', resumen: RESUMEN.connect(code) };
    }

    const onAbort = () => desktop.destroy();
    ctx.signal.addEventListener('abort', onAbort, { once: true });
    try {
      return await this.run(desktop, input, ctx);
    } catch (error) {
      return {
        estado: 'fallida',
        resumen: this.describeError(error, ctx.signal),
      };
    } finally {
      ctx.signal.removeEventListener('abort', onAbort);
      if (ctx.signal.aborted) desktop.destroy();
      else await desktop.close().catch(() => desktop.destroy());
    }
  }

  private async run(
    desktop: VncDesktop,
    input: TaskExecutionInput,
    ctx: TaskExecutionContext,
  ): Promise<TaskOutcome> {
    const screen: ScreenSize = { width: desktop.width, height: desktop.height };
    const tools = actionTools(screen);
    const remaining = () => ctx.deadlineAt - this.clock.now();
    const convo = new Conversation(systemPrompt(screen));
    const commits: CommitRecord[] = [];
    const stats = { tokensIn: 0, tokensOut: 0, cost: 0, model: '' };
    let invalid = 0;
    let blocked = 0;

    let frame = await desktop.capture();
    convo.observe(taskMessage(input.instruction, screen), toPngDataUrl(frame));

    for (let step = 1; step <= MAX_STEPS; step++) {
      if (ctx.signal.aborted)
        return { estado: 'fallida', resumen: RESUMEN.time };
      const result = await this.llm.chat({
        messages: convo.messages,
        tools,
        remainingMs: remaining(),
        signal: ctx.signal,
      });
      stats.tokensIn += result.usage.promptTokens;
      stats.tokensOut += result.usage.completionTokens;
      stats.cost += result.usage.cost ?? 0;
      stats.model = result.model;

      const [call, ...extra] = result.toolCalls;
      if (!call) {
        convo.assistant(result.text, []);
        convo.userText('Responde con exactamente UNA herramienta.');
        if (++invalid >= MAX_INVALID_IN_A_ROW)
          return this.end('fallida', RESUMEN.invalid, step, stats);
        continue;
      }
      convo.assistant(result.text, result.toolCalls);
      for (const e of extra)
        convo.toolResult(
          e.id,
          'IGNORADA: solo se ejecuta una acción por turno.',
        );

      const parsed = parseToolCall(
        call.function.name,
        call.function.arguments,
        screen,
      );
      const action = parsed.ok ? parsed.action : null;
      const formatError = parsed.ok
        ? keyComboError(parsed.action)
        : parsed.error;
      if (!action || formatError) {
        convo.toolResult(
          call.id,
          `RECHAZADA: ${formatError}. Vuelve a proponer la acción corregida.`,
        );
        if (++invalid >= MAX_INVALID_IN_A_ROW)
          return this.end('fallida', RESUMEN.invalid, step, stats);
        continue;
      }
      invalid = 0;

      const verdict = checkAction(action, {
        instruction: input.instruction,
        remainingMs: remaining(),
        commits,
      });
      this.logger.debug(
        `tarea ${input.taskId} paso ${step}: ${action.type}${'intent' in action ? `/${action.intent}` : ''} → ${verdict.allowed ? 'ok' : 'bloqueada'}`,
      );
      if (!verdict.allowed) {
        convo.toolResult(call.id, `BLOQUEADA: ${verdict.reason}.`);
        if (++blocked >= MAX_BLOCKED_IN_A_ROW)
          return this.end('fallida', RESUMEN.blocked, step, stats);
        continue;
      }
      blocked = 0;

      if (action.type === 'finish')
        return this.end('terminada', action.resumen, step, stats);
      if (action.type === 'fail')
        return this.end('fallida', action.resumen, step, stats);
      if (verdict.commit) commits.push(verdict.commit);

      if (ctx.signal.aborted)
        return { estado: 'fallida', resumen: RESUMEN.time };
      const before = frame;
      let note: string;
      if (action.type === 'wait') {
        await this.clock.sleep(action.ms);
        frame = await desktop.capture();
        note = `EJECUTADA: espera de ${action.ms} ms.`;
      } else {
        await perform(desktop, action);
        const settled = await desktop.settle(before);
        frame = settled.frame;
        note = settled.changed
          ? `EJECUTADA. La pantalla cambió${settled.stable ? ' y está estable' : ' y sigue cambiando'}.`
          : 'EJECUTADA, pero NO se observó cambio en pantalla (puede ir con retraso). Observa antes de repetir nada.';
      }
      convo.toolResult(call.id, note);
      convo.observe(
        `Paso ${step}. Quedan ${Math.max(0, Math.floor(remaining() / 1000))} s. Captura actual:`,
        toPngDataUrl(frame),
      );
    }
    return this.end('fallida', RESUMEN.steps, MAX_STEPS, stats);
  }

  private end(
    estado: TaskOutcome['estado'],
    resumen: string,
    steps: number,
    stats: { tokensIn: number; tokensOut: number; cost: number; model: string },
  ): TaskOutcome {
    this.logger.log(
      `fin ${estado} en ${steps} paso(s) · ${stats.model} · tokens ${stats.tokensIn}+${stats.tokensOut} · coste ${stats.cost.toFixed(4)}`,
    );
    return { estado, resumen };
  }

  private describeError(error: unknown, signal: AbortSignal): string {
    if (signal.aborted) return RESUMEN.time;
    if (
      error instanceof LlmError &&
      (error.code === 'NO_TIME' || error.code === 'ABORTED')
    ) {
      return RESUMEN.time;
    }
    if (error instanceof VncError && error.code === 'CLOSED') {
      return 'Se perdió la conexión con el escritorio; se detuvo la interacción.';
    }
    const e = error instanceof Error ? error : new Error(String(error));
    this.logger.error(`${e.name}: ${e.message}`);
    return RESUMEN.error;
  }
}

function keyComboError(action: AgentAction): string | null {
  if (action.type !== 'key') return null;
  try {
    parseKeyCombo(action.combo);
    return null;
  } catch (e) {
    return `key: ${(e as Error).message}`;
  }
}

async function perform(
  desktop: VncDesktop,
  action: AgentAction,
): Promise<void> {
  switch (action.type) {
    case 'click':
      return desktop.click(action.x, action.y, {
        button: action.button,
        double: action.double,
      });
    case 'type':
      return desktop.typeText(action.text, { replace: action.replace });
    case 'key':
      return desktop.pressKeys(action.combo);
    case 'scroll':
      return desktop.scroll(
        action.x,
        action.y,
        action.direction,
        action.amount,
      );
    default:
      return undefined;
  }
}
