import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Task } from '../task';
import { SqliteTaskRepository } from './sqlite-task.repository';

const task = (id: string, over: Partial<Task> = {}): Task => ({
  id,
  instruction: 'Registra al cliente X',
  desktopKey: 'k',
  estado: 'en_curso',
  resumen: 'Ejecutando tarea.',
  createdAt: 1_000,
  deadlineAt: 271_000,
  finishedAt: null,
  ...over,
});

describe('SqliteTaskRepository (node:sqlite)', () => {
  let repo: SqliteTaskRepository;
  beforeEach(() => {
    repo = new SqliteTaskRepository(':memory:');
  });
  afterEach(() => repo.close());

  it('aplica las migraciones (user_version = 1)', () => {
    expect(repo.schemaVersion()).toBe(1);
  });

  it('inserta y lee una tarea tal cual', () => {
    repo.insert(task('t1'));
    expect(repo.findById('t1')).toEqual(task('t1'));
    expect(repo.findById('nope')).toBeNull();
  });

  it('finish solo transiciona desde en_curso (no pisa un estado terminal)', () => {
    repo.insert(task('t1'));
    expect(repo.finish('t1', 'terminada', 'respuesta: 45', 5_000)).toBe(true);
    expect(repo.finish('t1', 'fallida', 'otra cosa', 6_000)).toBe(false);
    expect(repo.findById('t1')).toMatchObject({
      estado: 'terminada',
      resumen: 'respuesta: 45',
      finishedAt: 5_000,
    });
    expect(repo.finish('nope', 'fallida', 'x', 1)).toBe(false);
  });

  it('failInterrupted marca como fallida solo las en_curso', () => {
    repo.insert(task('a'));
    repo.insert(task('b'));
    repo.finish('b', 'terminada', 'ok', 2_000);
    expect(repo.failInterrupted('reinicio', 9_000)).toBe(1);
    expect(repo.findById('a')).toMatchObject({
      estado: 'fallida',
      resumen: 'reinicio',
      finishedAt: 9_000,
    });
    expect(repo.findById('b')).toMatchObject({ estado: 'terminada' });
  });

  it('rechaza estados fuera del contrato (CHECK)', () => {
    expect(() => repo.insert(task('x', { estado: 'raro' as never }))).toThrow();
  });
});

describe('SqliteTaskRepository en fichero', () => {
  it('persiste entre aperturas y no reaplica migraciones', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-screen-'));
    const path = join(dir, 'sub', 'tasks.db'); // crea el directorio si falta
    try {
      const first = new SqliteTaskRepository(path);
      first.insert(task('t1'));
      first.close();
      const second = new SqliteTaskRepository(path);
      expect(second.schemaVersion()).toBe(1);
      expect(second.findById('t1')?.id).toBe('t1');
      second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('SqliteTaskRepository con ruta inaccesible', () => {
  it('falla con un mensaje que nombra DATABASE_PATH y la ruta', () => {
    // Directorio temporal de solo lectura (no /proc: en WSL mkdirSync recursivo se cuelga ahí).
    const dir = mkdtempSync(join(tmpdir(), 'agent-screen-ro-'));
    chmodSync(dir, 0o500);
    const path = join(dir, 'sub', 'tasks.db');
    try {
      expect(() => new SqliteTaskRepository(path)).toThrow(
        `No se puede abrir la base de datos en DATABASE_PATH="${path}" (EACCES)`,
      );
    } finally {
      chmodSync(dir, 0o700);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
