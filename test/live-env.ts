import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

/** Jest da a cada test una copia de process.env: los tests live leen .env aparte, sin imprimir nada. */
export function liveEnv(): Record<string, string | undefined> {
  let fromFile: Record<string, string | undefined> = {};
  try {
    fromFile = parseEnv(readFileSync(`${__dirname}/../.env`, 'utf8'));
  } catch {
    // sin .env
  }
  return { ...fromFile, ...process.env };
}
