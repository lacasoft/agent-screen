import { envValidationSchema, nestLogLevels } from './env.validation';

const base = {
  AGENT_API_TOKEN: 'x'.repeat(32),
  OPENROUTER_API_KEY: 'k',
  LLM_MODEL: 'anthropic/claude-sonnet-5.5',
};

describe('envValidationSchema', () => {
  it('aplica valores por defecto', () => {
    const { error, value } = envValidationSchema.validate(base);
    expect(error).toBeUndefined();
    expect(value).toMatchObject({
      PORT: 3000,
      DATABASE_PATH: '/data/agent-screen.db',
      NODE_ENV: 'development',
    });
  });

  it.each(['AGENT_API_TOKEN', 'OPENROUTER_API_KEY', 'LLM_MODEL'])(
    'falla si falta %s (fail-fast)',
    (key) => {
      const env: Record<string, string> = { ...base };
      delete env[key];
      expect(envValidationSchema.validate(env).error?.message).toContain(key);
    },
  );

  it('exige un token de al menos 16 caracteres y no muestra su valor', () => {
    const { error } = envValidationSchema.validate({
      ...base,
      AGENT_API_TOKEN: 'corto-secreto',
    });
    expect(error).toBeDefined();
    expect(error?.message).not.toContain('corto-secreto');
  });
});

describe('LOG_LEVEL', () => {
  it.each(['info', 'INFO', 'debug', 'error'])('acepta %s', (level) => {
    expect(
      envValidationSchema.validate({ ...base, LOG_LEVEL: level }).error,
    ).toBeUndefined();
  });

  it('rechaza niveles desconocidos', () => {
    expect(
      envValidationSchema.validate({ ...base, LOG_LEVEL: 'ruido' }).error,
    ).toBeDefined();
  });

  it('info equivale a log de Nest; debug incluye los anteriores', () => {
    expect(nestLogLevels('info')).toEqual(['fatal', 'error', 'warn', 'log']);
    expect(nestLogLevels('debug')).toEqual([
      'fatal',
      'error',
      'warn',
      'log',
      'debug',
    ]);
    expect(nestLogLevels('error')).toEqual(['fatal', 'error']);
  });
});
