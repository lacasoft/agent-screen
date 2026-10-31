import type { ChatContentPart, ChatMessage, ToolCall } from '../llm/llm-client';
import { MAX_IMAGES_IN_CONTEXT } from './agent.constants';

const OMITTED_IMAGE: ChatContentPart = {
  type: 'text',
  text: '[captura anterior omitida]',
};

/**
 * Historial de la conversación con el modelo. Solo conserva las últimas capturas
 * (MAX_IMAGES_IN_CONTEXT): las anteriores se sustituyen por texto para acotar coste y latencia.
 */
export class Conversation {
  private readonly history: ChatMessage[];

  constructor(system: string) {
    this.history = [{ role: 'system', content: system }];
  }

  get messages(): ChatMessage[] {
    return this.history;
  }

  /** Mensaje del usuario con texto y una captura (PNG en data URL). */
  observe(text: string, imageDataUrl: string): void {
    this.history.push({
      role: 'user',
      content: [
        { type: 'text', text },
        { type: 'image_url', image_url: { url: imageDataUrl } },
      ],
    });
    this.pruneImages();
  }

  userText(text: string): void {
    this.history.push({ role: 'user', content: text });
  }

  assistant(text: string | null, toolCalls: ToolCall[]): void {
    this.history.push({
      role: 'assistant',
      content: text,
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    });
  }

  toolResult(toolCallId: string, content: string): void {
    this.history.push({ role: 'tool', tool_call_id: toolCallId, content });
  }

  imageCount(): number {
    return this.history.reduce(
      (n, m) =>
        n +
        (m.role === 'user' && Array.isArray(m.content)
          ? m.content.filter((p) => p.type === 'image_url').length
          : 0),
      0,
    );
  }

  private pruneImages(): void {
    let kept = 0;
    for (let i = this.history.length - 1; i >= 0; i--) {
      const m = this.history[i];
      if (m.role !== 'user' || !Array.isArray(m.content)) continue;
      m.content = m.content.map((part) => {
        if (part.type !== 'image_url') return part;
        kept++;
        return kept <= MAX_IMAGES_IN_CONTEXT ? part : OMITTED_IMAGE;
      });
    }
  }
}
