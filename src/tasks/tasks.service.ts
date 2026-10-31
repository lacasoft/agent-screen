import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ApiError } from '../common/api-error';
import { DesktopLeases, desktopKeyOf } from './desktop-lease';
import type { CreateTaskDto } from './dto/create-task.dto';
import type {
  TaskCreatedResponse,
  TaskStatusResponse,
} from './dto/task.responses';
import type { Task } from './task';
import { TaskRunner } from './task-runner';
import type { TaskRepository } from './task.repository';
import {
  RESUMEN_EN_CURSO,
  RESUMEN_INTERRUMPIDA,
  TASK_DEADLINE_MS,
  TASK_REPOSITORY,
} from './tasks.constants';

@Injectable()
export class TasksService implements OnApplicationBootstrap {
  private readonly logger = new Logger('TasksService');

  constructor(
    @Inject(TASK_REPOSITORY) private readonly repository: TaskRepository,
    private readonly leases: DesktopLeases,
    private readonly runner: TaskRunner,
  ) {}

  /** Tras un reinicio no se reanuda nada: las `en_curso` pasan a `fallida` (ADR-0004). */
  onApplicationBootstrap(): void {
    const n = this.repository.failInterrupted(RESUMEN_INTERRUMPIDA, Date.now());
    if (n > 0)
      this.logger.warn(`${n} tarea(s) interrumpida(s) marcadas como fallida`);
  }

  /** Registra `en_curso` y lanza la ejecución en segundo plano. 409 si el escritorio está ocupado. */
  create(dto: CreateTaskDto): TaskCreatedResponse {
    const desktopKey = desktopKeyOf(dto.escritorio.url);
    const id = randomUUID();
    if (!this.leases.tryAcquire(desktopKey, id)) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'DESKTOP_BUSY',
        'El escritorio ya tiene una tarea en curso',
      );
    }
    const now = Date.now();
    const task: Task = {
      id,
      instruction: dto.tarea,
      desktopKey,
      estado: 'en_curso',
      resumen: RESUMEN_EN_CURSO,
      createdAt: now,
      deadlineAt: now + TASK_DEADLINE_MS,
      finishedAt: null,
    };
    try {
      this.repository.insert(task);
    } catch (error) {
      this.leases.release(desktopKey, id);
      throw error;
    }
    this.runner.start(task, {
      taskId: id,
      instruction: dto.tarea,
      desktop: { url: dto.escritorio.url, password: dto.escritorio.password },
    });
    return { task_id: id };
  }

  get(id: string): TaskStatusResponse {
    const task = this.repository.findById(id);
    if (!task) {
      throw new ApiError(
        HttpStatus.NOT_FOUND,
        'TASK_NOT_FOUND',
        'No existe la tarea',
      );
    }
    return { estado: task.estado, resumen: task.resumen };
  }
}
