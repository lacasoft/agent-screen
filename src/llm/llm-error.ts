export type LlmErrorCode =
  | 'NO_TIME' // no queda tiempo para una llamada útil
  | 'TIMEOUT' // la llamada superó su timeout
  | 'ABORTED' // señal externa (watchdog de la tarea)
  | 'RATE_LIMITED' // 429 tras el reintento
  | 'HTTP_ERROR' // otro estado HTTP no exitoso
  | 'NETWORK' // fallo de red
  | 'BAD_RESPONSE'; // respuesta sin la forma esperada

/** Error del cliente LLM. Nunca incluye la API key ni el contenido enviado. */
export class LlmError extends Error {
  constructor(
    readonly code: LlmErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'LlmError';
  }

  get retryable(): boolean {
    return (
      this.code === 'RATE_LIMITED' ||
      this.code === 'NETWORK' ||
      (this.code === 'HTTP_ERROR' && (this.status ?? 0) >= 500)
    );
  }
}
