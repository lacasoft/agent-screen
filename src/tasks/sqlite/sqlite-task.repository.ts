import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Task, TaskState, TerminalState } from '../task';
import type { TaskRepository } from '../task.repository';
import { type Migration, MIGRATIONS } from './migrations';

interface TaskRow {
  id: string;
  instruction: string;
  desktop_key: string;
  estado: TaskState;
  resumen: string;
  created_at: number;
  deadline_at: number;
  finished_at: number | null;
}

/** TaskRepository sobre SQLite con node:sqlite (ADR-0011, ADR-0014). */
export class SqliteTaskRepository implements TaskRepository {
  private readonly db: DatabaseSync;

  constructor(path: string, migrations: readonly Migration[] = MIGRATIONS) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    migrate(this.db, migrations);
  }

  insert(task: Task): void {
    this.db
      .prepare(
        `INSERT INTO tasks (id, instruction, desktop_key, estado, resumen, created_at, deadline_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        task.id,
        task.instruction,
        task.desktopKey,
        task.estado,
        task.resumen,
        task.createdAt,
        task.deadlineAt,
        task.finishedAt,
      );
  }

  findById(id: string): Task | null {
    const row = this.db
      .prepare('SELECT * FROM tasks WHERE id = ?')
      .get(id) as unknown as TaskRow | undefined;
    return row ? toTask(row) : null;
  }

  finish(
    id: string,
    estado: TerminalState,
    resumen: string,
    finishedAt: number,
  ): boolean {
    const r = this.db
      .prepare(
        `UPDATE tasks SET estado = ?, resumen = ?, finished_at = ?
         WHERE id = ? AND estado = 'en_curso'`,
      )
      .run(estado, resumen, finishedAt, id);
    return Number(r.changes) === 1;
  }

  failInterrupted(resumen: string, finishedAt: number): number {
    const r = this.db
      .prepare(
        `UPDATE tasks SET estado = 'fallida', resumen = ?, finished_at = ? WHERE estado = 'en_curso'`,
      )
      .run(resumen, finishedAt);
    return Number(r.changes);
  }

  /** Versión de esquema aplicada (PRAGMA user_version). */
  schemaVersion(): number {
    return userVersion(this.db);
  }

  close(): void {
    if (this.db.isOpen) this.db.close();
  }
}

function migrate(db: DatabaseSync, migrations: readonly Migration[]): void {
  const current = userVersion(db);
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    if (m.version <= current) continue;
    db.exec('BEGIN');
    try {
      db.exec(m.up);
      db.exec(`PRAGMA user_version = ${Math.trunc(m.version)}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

function userVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as unknown as {
    user_version: number;
  };
  return Number(row.user_version);
}

function toTask(r: TaskRow): Task {
  return {
    id: r.id,
    instruction: r.instruction,
    desktopKey: r.desktop_key,
    estado: r.estado,
    resumen: r.resumen,
    createdAt: Number(r.created_at),
    deadlineAt: Number(r.deadline_at),
    finishedAt: r.finished_at === null ? null : Number(r.finished_at),
  };
}
