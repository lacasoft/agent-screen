import { type Clock, systemClock } from '../common/clock';
import type {
  ChatRequest,
  ChatResult,
  LlmClient,
  ToolCall,
} from './llm-client';
import { LlmError } from './llm-error';
import {
  LLM_CALL_MAX_MS,
  LLM_CALL_MIN_MS,
  LLM_DEADLINE_MARGIN_MS,
  LLM_MAX_OUTPUT_TOKENS,
  LLM_RETRY_BACKOFF_MS,
  LLM_RETRY_JITTER_MS,
  LLM_RETRY_MIN_TIMEOUT_MS,
  OPENROUTER_CHAT_URL,
} from './llm.constants';

export interface OpenRouterOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly fallbackModels?: readonly string[];
  readonly url?: string;
  readonly fetch?: typeof fetch;
  readonly clock?: Clock;
  readonly random?: () => number;
}

/** Timeout de un intento: min(25 s, restante − 5 s); < 5 s → NO_TIME (ADR-0012). */
export function callTimeoutMs(remainingMs: number): number {
  const t = Math.min(LLM_CALL_MAX_MS, remainingMs - LLM_DEADLINE_MARGIN_MS);
  if (t < LLM_CALL_MIN_MS) {
    throw new LlmError(
      'NO_TIME',
      'No queda tiempo para otra llamada al modelo',
    );
  }
  return Math.floor(t);
}

/**
 * Cliente de OpenRouter con fetch nativo: tool calling, respaldo por `models` y un único
 * reintento ante 429/5xx/red. Solo envía parámetros de soporte amplio (ver buildBody).
 */
export class OpenRouterClient implements LlmClient {
  private readonly fetchFn: typeof fetch;
  private readonly clock: Clock;
  private readonly random: () => number;

  constructor(private readonly options: OpenRouterOptions) {
    this.fetchFn = options.fetch ?? fetch;
    this.clock = options.clock ?? systemClock;
    this.random = options.random ?? Math.random;
  }

  get model(): string {
    return this.options.model;
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    const start = this.clock.now();
    const remaining = () => request.remainingMs - (this.clock.now() - start);
    for (let attempt = 1; ; attempt++) {
      if (request.signal?.aborted)
        throw new LlmError('ABORTED', 'Llamada al modelo cancelada');
      const timeoutMs = callTimeoutMs(remaining());
      try {
        const partial = await this.once(request, timeoutMs);
        return {
          ...partial,
          attempts: attempt,
          latencyMs: Math.round(this.clock.now() - start),
        };
      } catch (error) {
        if (!(error instanceof LlmError) || !error.retryable || attempt >= 2)
          throw error;
        const backoff =
          LLM_RETRY_BACKOFF_MS +
          Math.round((this.random() * 2 - 1) * LLM_RETRY_JITTER_MS);
        const nextTimeout = Math.min(
          LLM_CALL_MAX_MS,
          remaining() - backoff - LLM_DEADLINE_MARGIN_MS,
        );
        if (nextTimeout < LLM_RETRY_MIN_TIMEOUT_MS) throw error;
        await this.clock.sleep(backoff);
      }
    }
  }

  private async once(
    request: ChatRequest,
    timeoutMs: number,
  ): Promise<Omit<ChatResult, 'attempts' | 'latencyMs'>> {
    const controller = new AbortController();
    let reason: 'timeout' | 'external' | null = null;
    const timer = setTimeout(() => {
      reason = 'timeout';
      controller.abort();
    }, timeoutMs);
    const onExternalAbort = () => {
      reason ??= 'external';
      controller.abort();
    };
    request.signal?.addEventListener('abort', onExternalAbort, { once: true });

    try {
      let res: Response;
      let body: unknown;
      try {
        res = await this.fetchFn(this.options.url ?? OPENROUTER_CHAT_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.options.apiKey}`,
            'Content-Type': 'application/json',
            'X-Title': 'agent-screen',
          },
          body: JSON.stringify(this.buildBody(request)),
          signal: controller.signal,
        });
        body = await res.json().catch(() => null);
      } catch {
        if (reason === 'timeout') {
          throw new LlmError(
            'TIMEOUT',
            `El modelo no respondió en ${timeoutMs} ms`,
          );
        }
        if (reason === 'external')
          throw new LlmError('ABORTED', 'Llamada al modelo cancelada');
        throw new LlmError('NETWORK', 'Fallo de red al llamar al modelo');
      }
      return parseResponse(res.status, res.ok, body, this.options.model);
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  private buildBody(request: ChatRequest): Record<string, unknown> {
    const fallbacks = (this.options.fallbackModels ?? []).filter(
      (m) => m && m !== this.options.model,
    );
    return {
      model: this.options.model,
      ...(fallbacks.length
        ? { models: [this.options.model, ...fallbacks] }
        : {}),
      messages: request.messages,
      tools: request.tools,
      // 'auto' y nada de temperature/parallel_tool_calls: con require_parameters, OpenRouter
      // descarta proveedores que no admitan TODO lo enviado (claude-sonnet-5.5 rechaza 'required').
      // Una acción por turno la imponen el prompt y el agente (usa la primera tool call).
      tool_choice: 'auto',
      max_tokens: LLM_MAX_OUTPUT_TOKENS,
      provider: { require_parameters: true },
      usage: { include: true },
    };
  }
}

interface OpenRouterBody {
  model?: string;
  error?: { code?: number | string; message?: string };
  choices?: {
    message?: { content?: string | null; tool_calls?: ToolCall[] };
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

function parseResponse(
  status: number,
  ok: boolean,
  raw: unknown,
  requestedModel: string,
): Omit<ChatResult, 'attempts' | 'latencyMs'> {
  const body = (raw ?? {}) as OpenRouterBody;
  // OpenRouter puede devolver 200 con { error } (fallo del proveedor a mitad de camino).
  const errStatus = !ok
    ? status
    : typeof body.error?.code === 'number'
      ? body.error.code
      : body.error
        ? 502
        : 0;
  if (errStatus) {
    const detail = (body.error?.message ?? '').slice(0, 200);
    const msg = `El modelo respondió ${errStatus}${detail ? `: ${detail}` : ''}`;
    throw errStatus === 429
      ? new LlmError('RATE_LIMITED', msg, 429)
      : new LlmError('HTTP_ERROR', msg, errStatus);
  }
  const message = body.choices?.[0]?.message;
  if (!message)
    throw new LlmError('BAD_RESPONSE', 'Respuesta del modelo sin choices');
  const toolCalls = (message.tool_calls ?? [])
    .filter((c): c is ToolCall => typeof c?.function?.name === 'string')
    .map((c) => ({
      id: c.id,
      type: 'function' as const,
      function: {
        name: c.function.name,
        arguments: c.function.arguments ?? '',
      },
    }));
  const text =
    typeof message.content === 'string' && message.content.trim()
      ? message.content
      : null;
  if (toolCalls.length === 0 && text === null) {
    throw new LlmError(
      'BAD_RESPONSE',
      'Respuesta del modelo sin acción ni texto',
    );
  }
  return {
    toolCalls,
    text,
    model: body.model ?? requestedModel,
    usage: {
      promptTokens: body.usage?.prompt_tokens ?? 0,
      completionTokens: body.usage?.completion_tokens ?? 0,
      ...(typeof body.usage?.cost === 'number'
        ? { cost: body.usage.cost }
        : {}),
      ...(typeof body.usage?.prompt_tokens_details?.cached_tokens === 'number'
        ? { cachedTokens: body.usage.prompt_tokens_details.cached_tokens }
        : {}),
    },
  };
}
