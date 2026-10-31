import type { TaskState } from '../task';

/** Formato literal del contrato: no renombrar campos. */
export interface TaskCreatedResponse {
  task_id: string;
}

export interface TaskStatusResponse {
  estado: TaskState;
  resumen: string;
}
