// Entorno de los e2e: se fija antes de importar AppModule (ConfigModule valida al cargar).
process.env.NODE_ENV = 'test';
process.env.AGENT_API_TOKEN = 'e2e-token-0123456789abcdef';
process.env.OPENROUTER_API_KEY = 'e2e-openrouter-key';
process.env.LLM_MODEL = 'test/model';
process.env.DATABASE_PATH = ':memory:';
