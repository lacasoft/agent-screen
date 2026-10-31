import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { DesktopLeases } from './desktop-lease';
import type { Task, TaskOutcome } from './task';
import type { TaskExecutionContext, TaskExecutor } from './task-executor';
import { TaskRunner } from './task-runner';
import type { TaskRepository } from './task.repository';
import {
  EXECUTOR_GRACE_MS,
  RESUMEN_ERROR_INTERNO,
  RESUMEN_TIEMPO_AGOTADO,
  TASK_DEADLINE_MS,
} from './tasks.constants';

const PASSWORD = 'desk-password-123';
const API_TOKEN = 'api-token-0123456789';

function setup(execute: TaskExecutor['execute']) {
  const calls: string[] = [];
  const finish = jest.fn((..._args: Parameters<TaskRepository['finish']>) => {
    calls.push('finish');
    return true;
  });
  const repository: TaskRepository = {
    insert: jest.fn(),
    findById: jest.fn(),
    finish,
    failInterrupted: jest.fn(),
  };
  const leases = new DesktopLeases();
  const release = jest.spyOn(leases, 'release').mockImplementation(() => {
    calls.push('release');
  });
  const config = { getOrThrow: () => API_TOKEN } as unknown as ConfigService;
  const runner = new TaskRunner(
    repository,
    { execute: jest.fn(execute) },
    leases,
    config,
  );
  const now = Date.now();
  const task: Task = {
    id: 't1',
    instruction: 'haz algo',
    desktopKey: 'k',
    estado: 'en_curso',
    resumen: 'Ejecutando tarea.',
    createdAt: now,
    deadlineAt: now + TASK_DEADLINE_MS,
    finishedAt: null,
  };
  const input = {
    taskId: 't1',
    instruction: 'haz algo',
    desktop: { url: 'wss://d/websockify', password: PASSWORD },
  };
  return { runner, finish, release, calls, task, input };
}

describe('TaskRunner', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('persiste el resultado redactado y después libera el lease', async () => {
    const { runner, finish, release, calls, task, input } = setup(() =>
      Promise.resolve({
        estado: 'terminada',
        resumen: `  respuesta: 45 (pw ${PASSWORD}, token ${API_TOKEN})  `,
      }),
    );
    runner.start(task, input);
    await runner.drain();
    expect(finish).toHaveBeenCalledWith(
      't1',
      'terminada',
      'respuesta: 45 (pw ***, token ***)',
      expect.any(Number),
    );
    expect(release).toHaveBeenCalledWith('k', 't1');
    expect(calls).toEqual(['finish', 'release']);
  });

  it('pasa al ejecutor la señal y el plazo de la tarea', async () => {
    let ctx: TaskExecutionContext | undefined;
    const { runner, task, input } = setup((_i, c) => {
      ctx = c;
      return Promise.resolve({ estado: 'fallida', resumen: 'ambiguo' });
    });
    runner.start(task, input);
    await runner.drain();
    expect(ctx?.deadlineAt).toBe(task.deadlineAt);
    expect(ctx?.signal.aborted).toBe(false);
  });

  it('error del ejecutor → fallida genérica, sin secretos en el log', async () => {
    const logged = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const { runner, finish, release, task, input } = setup(() =>
      Promise.reject(new Error(`no conecta con password ${PASSWORD}`)),
    );
    runner.start(task, input);
    await runner.drain();
    expect(finish).toHaveBeenCalledWith(
      't1',
      'fallida',
      RESUMEN_ERROR_INTERNO,
      expect.any(Number),
    );
    expect(release).toHaveBeenCalled();
    expect(JSON.stringify(logged.mock.calls)).not.toContain(PASSWORD);
    logged.mockRestore();
  });

  it.each([
    [{ estado: 'terminada', resumen: '   ' }],
    [{ estado: 'en_curso', resumen: 'x' }],
    [undefined],
  ])('un resultado mal formado (%p) nunca sale como terminada', async (bad) => {
    const { runner, finish, task, input } = setup(() =>
      Promise.resolve(bad as unknown as TaskOutcome),
    );
    runner.start(task, input);
    await runner.drain();
    expect(finish).toHaveBeenCalledWith(
      't1',
      'fallida',
      RESUMEN_ERROR_INTERNO,
      expect.any(Number),
    );
  });

  it('watchdog (ADR-0006): a los 270 s aborta, da margen al ejecutor y persiste fallida igualmente', async () => {
    let signal: AbortSignal | undefined;
    const { runner, finish, release, task, input } = setup((_i, c) => {
      signal = c.signal;
      return new Promise<TaskOutcome>(() => undefined); // colgado para siempre
    });
    runner.start(task, input);
    await jest.advanceTimersByTimeAsync(TASK_DEADLINE_MS - 1);
    expect(signal?.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(signal?.aborted).toBe(true);
    expect(finish).not.toHaveBeenCalled(); // aún dentro del margen de cierre
    await jest.advanceTimersByTimeAsync(EXECUTOR_GRACE_MS);
    expect(finish).toHaveBeenCalledWith(
      't1',
      'fallida',
      RESUMEN_TIEMPO_AGOTADO,
      expect.any(Number),
    );
    expect(release).toHaveBeenCalledWith('k', 't1');
  });

  it('si el ejecutor responde terminada tras el abort, el estado sigue siendo fallida por tiempo', async () => {
    const { runner, finish, task, input } = setup(
      (_i, c) =>
        new Promise<TaskOutcome>((resolve) =>
          c.signal.addEventListener('abort', () =>
            resolve({ estado: 'terminada', resumen: 'tarde' }),
          ),
        ),
    );
    runner.start(task, input);
    await jest.advanceTimersByTimeAsync(TASK_DEADLINE_MS);
    await runner.drain();
    expect(finish).toHaveBeenCalledWith(
      't1',
      'fallida',
      RESUMEN_TIEMPO_AGOTADO,
      expect.any(Number),
    );
  });

  it('el apagado aborta las tareas activas y las cierra como fallida', async () => {
    const { runner, finish, task, input } = setup(
      (_i, c) =>
        new Promise<TaskOutcome>((resolve) =>
          c.signal.addEventListener('abort', () =>
            resolve({ estado: 'fallida', resumen: 'x' }),
          ),
        ),
    );
    runner.start(task, input);
    const shutdown = runner.onApplicationShutdown();
    await jest.advanceTimersByTimeAsync(EXECUTOR_GRACE_MS);
    await shutdown;
    expect(finish).toHaveBeenCalledWith(
      't1',
      'fallida',
      RESUMEN_TIEMPO_AGOTADO,
      expect.any(Number),
    );
  });
});
