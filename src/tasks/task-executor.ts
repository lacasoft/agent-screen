import type { DesktopTarget } from '../vnc/rfb-session';
import type { TaskOutcome } from './task';

export interface TaskExecutionInput {
  readonly taskId: string;
  readonly instruction: string;
  readonly desktop: DesktopTarget;
}

export interface TaskExecutionContext {
  /** Se aborta en el watchdog (ADR-0006): el ejecutor debe cortar VNC y volver. */
  readonly signal: AbortSignal;
  /** Instante límite (reloj del runner, ms) para la última acción. */
  readonly deadlineAt: number;
}

/**
 * Puerto que implementa el agente. Contrato: al resolver, la sesión VNC ya está cerrada;
 * con `signal` abortado, deja de actuar y destruye la sesión de inmediato.
 */
export interface TaskExecutor {
  execute(
    input: TaskExecutionInput,
    context: TaskExecutionContext,
  ): Promise<TaskOutcome>;
}
