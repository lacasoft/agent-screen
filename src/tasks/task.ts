/** Estados del contrato público, literales en español. */
export type TaskState = 'en_curso' | 'terminada' | 'fallida';
export type TerminalState = Exclude<TaskState, 'en_curso'>;

export interface Task {
  readonly id: string;
  readonly instruction: string;
  /** Huella del escritorio (sin contraseña), para el lease y la trazabilidad. */
  readonly desktopKey: string;
  readonly estado: TaskState;
  readonly resumen: string;
  readonly createdAt: number;
  readonly deadlineAt: number;
  readonly finishedAt: number | null;
}

export interface TaskOutcome {
  readonly estado: TerminalState;
  readonly resumen: string;
}
