import type { Task, TerminalState } from './task';

/** Puerto de persistencia de tareas (ADR-0011). */
export interface TaskRepository {
  insert(task: Task): void;
  findById(id: string): Task | null;
  /** Solo pasa de `en_curso` a terminal; devuelve false si ya era terminal o no existe. */
  finish(
    id: string,
    estado: TerminalState,
    resumen: string,
    finishedAt: number,
  ): boolean;
  /** Arranque: toda tarea `en_curso` pasa a `fallida`. Devuelve cuántas. */
  failInterrupted(resumen: string, finishedAt: number): number;
}
