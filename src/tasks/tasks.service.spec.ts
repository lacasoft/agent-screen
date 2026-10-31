import { DesktopLeases, desktopKeyOf } from './desktop-lease';
import type { Task } from './task';
import type { TaskRunner } from './task-runner';
import type { TaskRepository } from './task.repository';
import {
  RESUMEN_EN_CURSO,
  RESUMEN_INTERRUMPIDA,
  TASK_DEADLINE_MS,
} from './tasks.constants';
import { TasksService } from './tasks.service';

const dto = {
  tarea: 'Registra al cliente X',
  escritorio: { url: 'wss://desk.example/websockify', password: 'pw-123456' },
};

function setup() {
  const insert = jest.fn(
    (..._a: Parameters<TaskRepository['insert']>) => undefined,
  );
  const findById = jest.fn(
    (..._a: Parameters<TaskRepository['findById']>): Task | null => null,
  );
  const failInterrupted = jest.fn(
    (..._a: Parameters<TaskRepository['failInterrupted']>) => 0,
  );
  const start = jest.fn((..._a: Parameters<TaskRunner['start']>) => undefined);
  const repository: TaskRepository = {
    insert,
    findById,
    finish: jest.fn(),
    failInterrupted,
  };
  const leases = new DesktopLeases();
  const runner = { start } as unknown as TaskRunner;
  return {
    insert,
    findById,
    failInterrupted,
    start,
    leases,
    service: new TasksService(repository, leases, runner),
  };
}

describe('TasksService', () => {
  it('create: registra en_curso con plazo de 270 s, lanza el runner y devuelve task_id', () => {
    const { insert, start, service } = setup();
    const before = Date.now();
    const { task_id } = service.create(dto);
    const inserted = insert.mock.calls[0][0];
    expect(inserted).toMatchObject({
      id: task_id,
      estado: 'en_curso',
      resumen: RESUMEN_EN_CURSO,
      instruction: dto.tarea,
      desktopKey: desktopKeyOf(dto.escritorio.url),
    });
    expect(inserted.deadlineAt - inserted.createdAt).toBe(TASK_DEADLINE_MS);
    expect(inserted.createdAt).toBeGreaterThanOrEqual(before);
    expect(JSON.stringify(inserted)).not.toContain(dto.escritorio.password); // la contraseña no se persiste
    expect(start).toHaveBeenCalledWith(inserted, {
      taskId: task_id,
      instruction: dto.tarea,
      desktop: dto.escritorio,
    });
  });

  it('create: 409 DESKTOP_BUSY si el escritorio ya tiene una tarea activa, sin persistir nada', () => {
    const { insert, start, service } = setup();
    service.create(dto);
    expect(() => service.create(dto)).toThrow(
      expect.objectContaining({ status: 409 }) as Error,
    );
    try {
      service.create(dto);
    } catch (e) {
      expect((e as { getResponse(): unknown }).getResponse()).toEqual({
        code: 'DESKTOP_BUSY',
        message: 'El escritorio ya tiene una tarea en curso',
      });
    }
    expect(insert).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('create: si falla la persistencia, libera el lease y no arranca el runner', () => {
    const { insert, leases, start, service } = setup();
    insert.mockImplementation(() => {
      throw new Error('disco lleno');
    });
    expect(() => service.create(dto)).toThrow('disco lleno');
    expect(leases.holderOf(desktopKeyOf(dto.escritorio.url))).toBeUndefined();
    expect(start).not.toHaveBeenCalled();
  });

  it('get: estado y resumen literales, o 404 TASK_NOT_FOUND', () => {
    const { findById, service } = setup();
    findById.mockReturnValueOnce({
      id: 't',
      instruction: 'x',
      desktopKey: 'k',
      estado: 'terminada',
      resumen: 'respuesta: 45',
      createdAt: 0,
      deadlineAt: 0,
      finishedAt: 1,
    });
    expect(service.get('t')).toEqual({
      estado: 'terminada',
      resumen: 'respuesta: 45',
    });
    expect(() => service.get('nope')).toThrow(
      expect.objectContaining({ status: 404 }) as Error,
    );
  });

  it('al arrancar marca las tareas interrumpidas como fallida', () => {
    const { failInterrupted, service } = setup();
    service.onApplicationBootstrap();
    expect(failInterrupted).toHaveBeenCalledWith(
      RESUMEN_INTERRUMPIDA,
      expect.any(Number),
    );
  });
});
