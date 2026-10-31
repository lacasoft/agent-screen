// Presupuestos de llamada al LLM (ADR-0012). Constantes de código, no env.

/** Timeout máximo por llamada. */
export const LLM_CALL_MAX_MS = 25_000;
/** Margen respecto al watchdog: timeout = min(MAX, restante − MARGIN). */
export const LLM_DEADLINE_MARGIN_MS = 5_000;
/** Por debajo de esto no se llama: el agente debe cerrar como fallida por tiempo. */
export const LLM_CALL_MIN_MS = 5_000;
/** Reintento único ante 429/5xx/red, con backoff ± jitter, si queda ≥ RETRY_MIN de timeout. */
export const LLM_RETRY_BACKOFF_MS = 1_000;
export const LLM_RETRY_JITTER_MS = 250;
export const LLM_RETRY_MIN_TIMEOUT_MS = 10_000;

export const OPENROUTER_CHAT_URL =
  'https://openrouter.ai/api/v1/chat/completions';
export const LLM_MAX_OUTPUT_TOKENS = 1_024;

export const LLM_CLIENT = Symbol('LLM_CLIENT');
