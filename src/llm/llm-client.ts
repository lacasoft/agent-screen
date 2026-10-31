import type { ToolDefinition } from './actions';

/** `cache_control` marca un punto de caché de prompt (Anthropic vía OpenRouter); otros lo ignoran. */
export type ChatContentPart =
  | { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }
  | { type: 'image_url'; image_url: { url: string } };

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type ChatMessage =
  | { role: 'system'; content: string | ChatContentPart[] }
  | { role: 'user'; content: string | ChatContentPart[] }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface ChatRequest {
  readonly messages: ChatMessage[];
  readonly tools: ToolDefinition[];
  /** Tiempo hasta el watchdog de la tarea (ms): fija el timeout de cada intento (ADR-0012). */
  readonly remainingMs: number;
  /** Señal de la tarea: al abortar, la llamada se corta con ABORTED. */
  readonly signal?: AbortSignal;
}

export interface ChatUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  /** Tokens de entrada servidos desde la caché de prompt, si el proveedor lo informa. */
  readonly cachedTokens?: number;
  /** Coste en créditos de OpenRouter, si lo informa. */
  readonly cost?: number;
}

export interface ChatResult {
  readonly toolCalls: ToolCall[];
  readonly text: string | null;
  /** Modelo que respondió de verdad (puede ser uno de respaldo). */
  readonly model: string;
  readonly usage: ChatUsage;
  readonly latencyMs: number;
  readonly attempts: number;
}

/** Puerto del modelo multimodal: el agente no conoce al proveedor. */
export interface LlmClient {
  chat(request: ChatRequest): Promise<ChatResult>;
}
