import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { type Clock, wallClock } from '../common/clock';
import {
  type AgentAction,
  actionTools,
  parseToolCall,
  type ScreenSize,
} from '../llm/actions';
import type { ChatResult, LlmClient } from '../llm/llm-client';
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
  MAX_NOTES,
  MAX_STEPS,
  REPEAT_LIMIT,
  REPEAT_WINDOW,
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
  lost: 'Se perdió la conexión con el escritorio; se detuvo la interacción.',
  error:
    'Error durante la ejecución; se detuvo toda interacción con el escritorio.',
};

interface RunStats {
  taskId: string;
  steps: number;
  tokensIn: number;
  tokensOut: number;
  cached: number;
  cost: number;
  model: string;
}

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

    const stats: RunStats = {
      taskId: input.taskId,
      steps: 0,
      tokensIn: 0,
      tokensOut: 0,
      cached: 0,
      cost: 0,
      model: '',
    };
    const onAbort = () => desktop.destroy();
    ctx.signal.addEventListener('abort', onAbort, { once: true });
    try {
      return await this.run(desktop, input, ctx, stats);
    } catch (error) {
      return this.end('fallida', this.describeError(error, ctx.signal), stats);
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
    stats: RunStats,
  ): Promise<TaskOutcome> {
    const screen: ScreenSize = { width: desktop.width, height: desktop.height };
    const tools = actionTools(screen);
    const remaining = () => ctx.deadlineAt - this.clock.now();
    const secs = () => Math.max(0, Math.floor(remaining() / 1000));
    const convo = new Conversation(systemPrompt(screen));
    const commits: CommitRecord[] = [];
    const notes: string[] = [];
    const executed: string[] = [];
    let invalid = 0;
    let blocked = 0;
    let lastNoteStep = 0;

    let frame = await desktop.capture();
    convo.start(taskMessage(input.instruction, screen), toPngDataUrl(frame));

    for (let step = 1; step <= MAX_STEPS; step++) {
      stats.steps = step;
      if (ctx.signal.aborted) return this.end('fallida', RESUMEN.time, stats);
      convo.beginTurn();
      const tLlm = this.clock.now();
      const result = await this.llm.chat({
        messages: convo.messages,
        tools,
        remainingMs: remaining(),
        signal: ctx.signal,
      });
      const llmMs = Math.round(this.clock.now() - tLlm);
      accumulate(stats, result);
      const trace = (what: string, outcome: string) =>
        this.logger.debug(
          `tarea ${input.taskId} paso ${step} (${secs()} s): ${what} → ${outcome} · llm ${llmMs} ms · in ${result.usage.promptTokens} (caché ${result.usage.cachedTokens ?? 0})`,
        );

      const [call, ...extra] = result.toolCalls;
      if (!call) {
        convo.assistant(result.text, []);
        convo.userText('Responde con exactamente UNA herramienta.');
        convo.summarize(`Paso ${step}: respuesta sin herramienta.`);
        trace('sin herramienta', 'se pide una');
        if (++invalid >= MAX_INVALID_IN_A_ROW)
          return this.end('fallida', RESUMEN.invalid, stats);
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
        convo.summarize(
          `Paso ${step}: ${call.function.name} RECHAZADA (${formatError}).`,
        );
        trace(call.function.name, `RECHAZADA: ${formatError}`);
        if (++invalid >= MAX_INVALID_IN_A_ROW)
          return this.end('fallida', RESUMEN.invalid, stats);
        continue;
      }
      invalid = 0;
      // La nota describe la captura que el modelo acaba de ver: vale aunque la acción se bloquee.
      if ('nota' in action && action.nota) {
        notes.push(`Paso ${step}: ${action.nota}`);
        lastNoteStep = step;
        if (notes.length > MAX_NOTES) notes.shift();
      }

      const verdict = checkAction(action, {
        instruction: input.instruction,
        remainingMs: remaining(),
        commits,
      });
      if (!verdict.allowed) {
        convo.toolResult(call.id, `BLOQUEADA: ${verdict.reason}.`);
        convo.summarize(
          `Paso ${step}: ${describe(action)} BLOQUEADA (${verdict.reason}).`,
        );
        trace(describe(action), `BLOQUEADA: ${verdict.reason}`);
        if (++blocked >= MAX_BLOCKED_IN_A_ROW)
          return this.end('fallida', RESUMEN.blocked, stats);
        continue;
      }
      blocked = 0;

      if (action.type === 'finish' || action.type === 'fail') {
        trace(action.type, 'fin');
        return this.end(
          action.type === 'finish' ? 'terminada' : 'fallida',
          action.resumen,
          stats,
        );
      }
      if (verdict.commit) commits.push(verdict.commit);

      if (ctx.signal.aborted) return this.end('fallida', RESUMEN.time, stats);
      const before = frame;
      const tAct = this.clock.now();
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
      const repeats = trackRepeat(executed, signature(action));
      // Repetir con notas nuevas es progreso (p. ej. «Siguiente» en cada página): solo se avisa
      // si en esa racha no se anotó nada.
      const stalled = step - lastNoteStep >= REPEAT_LIMIT;
      const warning =
        repeats >= REPEAT_LIMIT && stalled
          ? ` AVISO: has repetido esta misma acción ${repeats} veces en los últimos ${REPEAT_WINDOW} pasos. Anota lo que ves (nota) y avanza, o termina.`
          : '';
      convo.toolResult(call.id, note + warning);
      convo.observe(observationText(step, secs(), notes), toPngDataUrl(frame));
      convo.summarize(
        `Paso ${step}: ${describe(action)} → ${note.split('.')[0]}.`,
      );
      trace(
        describe(action),
        `${note.split('.')[0]}${warning ? ' (repetida)' : ''} en ${Math.round(this.clock.now() - tAct)} ms`,
      );
    }
    return this.end('fallida', RESUMEN.steps, stats);
  }

  private end(
    estado: TaskOutcome['estado'],
    resumen: string,
    stats: RunStats,
  ): TaskOutcome {
    const pct = stats.tokensIn
      ? Math.round((100 * stats.cached) / stats.tokensIn)
      : 0;
    this.logger.log(
      `tarea ${stats.taskId} fin ${estado} en ${stats.steps} paso(s) · ${stats.model || '—'} · tokens ${stats.tokensIn}+${stats.tokensOut} (caché ${pct} %) · coste ${stats.cost.toFixed(4)}`,
    );
    return { estado, resumen };
  }

  private describeError(error: unknown, signal: AbortSignal): string {
    if (signal.aborted) return RESUMEN.time;
    if (
      error instanceof LlmError &&
      (error.code === 'NO_TIME' || error.code === 'ABORTED')
    )
      return RESUMEN.time;
    if (error instanceof VncError && error.code === 'CLOSED')
      return RESUMEN.lost;
    const e = error instanceof Error ? error : new Error(String(error));
    this.logger.error(`${e.name}: ${e.message}`);
    return RESUMEN.error;
  }
}

function accumulate(stats: RunStats, result: ChatResult): void {
  stats.tokensIn += result.usage.promptTokens;
  stats.tokensOut += result.usage.completionTokens;
  stats.cached += result.usage.cachedTokens ?? 0;
  stats.cost += result.usage.cost ?? 0;
  stats.model = result.model;
}

function observationText(
  step: number,
  secondsLeft: number,
  notes: readonly string[],
): string {
  const block = notes.length
    ? `\nTus notas hasta ahora:\n${notes.map((n) => `- ${n}`).join('\n')}`
    : '';
  return `Paso ${step}. Quedan ${secondsLeft} s.${block}\nCaptura actual:`;
}

/** Firma de una acción ejecutada, para detectar bucles. */
function signature(action: AgentAction): string {
  switch (action.type) {
    case 'click':
      return `click:${action.x},${action.y}`;
    case 'type':
      return `type:${action.text}`;
    case 'key':
      return `key:${action.combo.toLowerCase()}`;
    case 'scroll':
      return `scroll:${action.x},${action.y},${action.direction}`;
    default:
      return action.type;
  }
}

/** Registra la firma y devuelve cuántas veces aparece en la ventana reciente. */
function trackRepeat(executed: string[], sig: string): number {
  executed.push(sig);
  if (executed.length > REPEAT_WINDOW) executed.shift();
  return executed.filter((s) => s === sig).length;
}

/** Descripción corta de una acción para logs y para el resumen de turnos antiguos. */
function describe(action: AgentAction): string {
  const why = 'reason' in action ? ` «${action.reason}»` : '';
  const nota = 'nota' in action && action.nota ? ` [nota: ${action.nota}]` : '';
  switch (action.type) {
    case 'click':
      return `click (${action.x},${action.y}) [${action.intent}]${why}${nota}`;
    case 'type':
      return `type ${JSON.stringify(action.text.slice(0, 40))}${action.replace ? ' (reemplaza)' : ''}${why}${nota}`;
    case 'key':
      return `key ${action.combo} [${action.intent}]${why}${nota}`;
    case 'scroll':
      return `scroll ${action.direction} ×${action.amount} en (${action.x},${action.y})${why}${nota}`;
    case 'wait':
      return `wait ${action.ms} ms${why}${nota}`;
    default:
      return action.type;
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
