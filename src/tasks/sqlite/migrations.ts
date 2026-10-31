/** Migraciones versionadas y reversibles, aplicadas con PRAGMA user_version (ADR-0011). */
export interface Migration {
  readonly version: number;
  readonly up: string;
  readonly down: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE tasks (
        id           TEXT PRIMARY KEY,
        instruction  TEXT NOT NULL,
        desktop_key  TEXT NOT NULL,
        estado       TEXT NOT NULL CHECK (estado IN ('en_curso', 'terminada', 'fallida')),
        resumen      TEXT NOT NULL,
        created_at   INTEGER NOT NULL,
        deadline_at  INTEGER NOT NULL,
        finished_at  INTEGER
      );
      CREATE INDEX idx_tasks_estado ON tasks (estado);
    `,
    down: `DROP TABLE tasks;`,
  },
];
