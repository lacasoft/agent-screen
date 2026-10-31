import type { LogLevel } from '@nestjs/common';
import Joi from 'joi';

export const LOG_LEVELS = [
  'error',
  'warn',
  'info',
  'log',
  'debug',
  'verbose',
] as const;
export type AppLogLevel = (typeof LOG_LEVELS)[number];

/** Variables de entorno, validadas al boot (fail-fast). Ver .env.example. */
export const envValidationSchema = Joi.object({
  // Solo se distingue 'test' (ignora el .env local); cualquier otro valor se acepta.
  NODE_ENV: Joi.string().default('development'),
  PORT: Joi.number().port().default(3000),
  LOG_LEVEL: Joi.string()
    .lowercase()
    .valid(...LOG_LEVELS)
    .default('info'),
  AGENT_API_TOKEN: Joi.string().min(16).required(),
  OPENROUTER_API_KEY: Joi.string().required(),
  LLM_MODEL: Joi.string().required(),
  LLM_FALLBACK_MODELS: Joi.string().allow('').optional(),
  DATABASE_PATH: Joi.string().default('/data/agent-screen.db'),
});

/** Niveles de Nest activos para un LOG_LEVEL ('info' equivale a 'log' de Nest). */
export function nestLogLevels(level: string | undefined): LogLevel[] {
  const order: LogLevel[] = [
    'fatal',
    'error',
    'warn',
    'log',
    'debug',
    'verbose',
  ];
  const normalized = (level ?? 'info').toLowerCase();
  const target: LogLevel =
    normalized === 'info' ? 'log' : (normalized as LogLevel);
  const idx = order.indexOf(target);
  return order.slice(0, (idx === -1 ? order.indexOf('log') : idx) + 1);
}
