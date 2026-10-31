import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { redactSecrets } from '../common/redact';
import { DesktopLeases } from './desktop-lease';
import type { Task, TaskOutcome } from './task';
import type { TaskExecutionInput, TaskExecutor } from './task-executor';
import type { TaskRepository } from './task.repository';
import {
  EXECUTOR_GRACE_MS,
  RESUMEN_ERROR_INTERNO,
  RESUMEN_TIEMPO_AGOTADO,
  TASK_EXECUTOR,
  TASK_REPOSITORY,
} from './tasks.constants';

const MAX_RESUMEN_LENGTH = 4_000;

type Settled =
  { kind: 'done'; outcome: TaskOutcome } | { kind: 'error'; error: unknown };

/**
 * Ejecuta cada tarea en segundo plano (ADR-0004) con watchdog global (ADR-0006):
 * al llegar a deadlineAt aborta la señal, da EXECUTOR_GRACE_MS al ejecutor para cerrar VNC
 * y persiste `fallida` pase lo que pase. Orden: ejecutor termina → persistir → liberar lease.
 */
@Injectable()
export class TaskRunner implements OnApplicationShutdown {
  private readonly logger = new Logger('TaskRunner');
  private readonly running = new Map<
    string,
    { controller: AbortController; done: Promise<void> }
  >();
  private readonly apiToken: string;

  constructor(
    @Inject(TASK_REPOSITORY) private readonly repository: TaskRepository,
    @Inject(TASK_EXECUTOR) private readonly executor: TaskExecutor,
    private readonly leases: DesktopLeases,
    config: ConfigService,
  ) {
    this.apiToken = config.getOrThrow<string>('AGENT_API_TOKEN');
  }

  /** Lanza la tarea sin bloquear la respuesta HTTP. */
  start(task: Task, input: TaskExecutionInput): void {
    const controller = new AbortController();
    const done = this.run(task, input, controller).finally(() =>
      this.running.delete(task.id),
    );
    this.running.set(task.id, { controller, done });
  }

  /** Para tests y apagado: espera a que terminen las tareas activas. */
  async drain(): Promise<void> {
    await Promise.all([...this.running.values()].map((r) => r.done));
  }

  async onApplicationShutdown(): Promise<void> {
    for (const r of this.running.values())
      r.controller.abort(new Error('shutdown'));
    await this.drain();
  }

  private async run(
    task: Task,
    input: TaskExecutionInput,
    controller: AbortController,
  ): Promise<void> {
    let watchdog: NodeJS.Timeout | undefined;
    const timedOut = new Promise<'timeout'>((resolve) => {
      watchdog = setTimeout(
        () => {
          controller.abort(new Error('deadline'));
          resolve('timeout');
        },
        Math.max(0, task.deadlineAt - Date.now()),
      );
    });
    const aborted = new Promise<'timeout'>((resolve) => {
      controller.signal.addEventListener('abort', () => resolve('timeout'), {
        once: true,
      });
    });

    let outcome: TaskOutcome;
    try {
      const execution: Promise<Settled> = Promise.resolve()
        .then(() =>
          this.executor.execute(input, {
            signal: controller.signal,
            deadlineAt: task.deadlineAt,
          }),
        )
        .then(
          (o): Settled => ({ kind: 'done', outcome: o }),
          (e: unknown): Settled => ({ kind: 'error', error: e }),
        );
      const first = await Promise.race([execution, timedOut, aborted]);
      if (first === 'timeout') {
        await Promise.race([execution, sleep(EXECUTOR_GRACE_MS)]);
        outcome = { estado: 'fallida', resumen: RESUMEN_TIEMPO_AGOTADO };
      } else if (first.kind === 'error') {
        this.logError(task.id, first.error, input);
        outcome = { estado: 'fallida', resumen: RESUMEN_ERROR_INTERNO };
      } else {
        outcome = sanitize(first.outcome);
      }
    } finally {
      clearTimeout(watchdog);
    }

    const resumen = redactSecrets(outcome.resumen, [
      input.desktop.password,
      this.apiToken,
    ]);
    try {
      this.repository.finish(task.id, outcome.estado, resumen, Date.now());
    } catch (error) {
      this.logError(task.id, error, input);
    } finally {
      this.leases.release(task.desktopKey, task.id);
    }
  }

  private logError(
    taskId: string,
    error: unknown,
    input: TaskExecutionInput,
  ): void {
    const e = error instanceof Error ? error : new Error(String(error));
    const text = redactSecrets(`${e.name}: ${e.message}`, [
      input.desktop.password,
      this.apiToken,
    ]);
    this.logger.error(`tarea ${taskId}: ${text}`);
  }
}

/** Un resultado mal formado del ejecutor nunca llega al contrato como `terminada`. */
function sanitize(outcome: TaskOutcome | undefined): TaskOutcome {
  const estadoOk =
    outcome?.estado === 'terminada' || outcome?.estado === 'fallida';
  const resumen =
    typeof outcome?.resumen === 'string' ? outcome.resumen.trim() : '';
  if (!estadoOk || !resumen)
    return { estado: 'fallida', resumen: RESUMEN_ERROR_INTERNO };
  return {
    estado: outcome.estado,
    resumen: resumen.slice(0, MAX_RESUMEN_LENGTH),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
