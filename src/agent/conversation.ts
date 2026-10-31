import type { ChatContentPart, ChatMessage, ToolCall } from '../llm/llm-client';
import { KEEP_FULL_TURNS, MAX_IMAGES_IN_CONTEXT } from './agent.constants';

const OMITTED_IMAGE: ChatContentPart = {
  type: 'text',
  text: '[captura anterior omitida]',
};

interface Turn {
  readonly messages: ChatMessage[];
  summary: string;
}

/**
 * Historial con el modelo, organizado por turnos (assistant → tool → captura):
 * - Cabecera fija: sistema (con punto de caché de prompt) y tarea.
 * - Últimos KEEP_FULL_TURNS turnos completos; los anteriores, una línea cada uno.
 *   Se descartan turnos enteros, así nunca queda un tool_call sin su respuesta.
 * - Solo las últimas MAX_IMAGES_IN_CONTEXT capturas viajan; las demás pasan a texto.
 */
export class Conversation {
  private readonly head: ChatMessage[];
  private readonly turns: Turn[] = [];

  constructor(system: string) {
    // La cabecera no cambia entre llamadas: Anthropic cachea herramientas + sistema.
    this.head = [
      {
        role: 'system',
        content: [
          { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
        ],
      },
    ];
  }

  /** Mensaje inicial con la tarea y la primera captura. */
  start(text: string, imageDataUrl: string): void {
    this.head.push(observation(text, imageDataUrl));
  }

  /** Abre un turno nuevo: todo lo que se añada hasta el siguiente pertenece a él. */
  beginTurn(): void {
    this.turns.push({ messages: [], summary: '' });
  }

  assistant(text: string | null, toolCalls: ToolCall[]): void {
    this.current().push({
      role: 'assistant',
      content: text,
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    });
  }

  toolResult(toolCallId: string, content: string): void {
    this.current().push({ role: 'tool', tool_call_id: toolCallId, content });
  }

  userText(text: string): void {
    this.current().push({ role: 'user', content: text });
  }

  observe(text: string, imageDataUrl: string): void {
    this.current().push(observation(text, imageDataUrl));
  }

  /** Línea que sustituye al turno cuando sale de la ventana completa. */
  summarize(line: string): void {
    const turn = this.turns.at(-1);
    if (turn) turn.summary = line;
  }

  /** Mensajes a enviar: cabecera + resumen de turnos antiguos + turnos recientes. */
  get messages(): ChatMessage[] {
    const old = this.turns.slice(
      0,
      Math.max(0, this.turns.length - KEEP_FULL_TURNS),
    );
    const recent = this.turns.slice(old.length);
    const out: ChatMessage[] = this.head.map(clone);
    if (old.length) {
      out.push({
        role: 'user',
        content: `Resumen de los pasos anteriores (ya ejecutados):\n${old.map((t) => t.summary).join('\n')}`,
      });
    }
    for (const t of recent) out.push(...t.messages.map(clone));
    pruneImages(out);
    return out;
  }

  get turnCount(): number {
    return this.turns.length;
  }

  private current(): ChatMessage[] {
    const turn = this.turns.at(-1);
    if (!turn) throw new Error('beginTurn() antes de añadir mensajes al turno');
    return turn.messages;
  }
}

function observation(text: string, imageDataUrl: string): ChatMessage {
  return {
    role: 'user',
    content: [
      { type: 'text', text },
      { type: 'image_url', image_url: { url: imageDataUrl } },
    ],
  };
}

function clone(m: ChatMessage): ChatMessage {
  return Array.isArray(m.content)
    ? ({ ...m, content: [...m.content] } as ChatMessage)
    : { ...m };
}

/** Deja solo las últimas capturas (recorre de la más reciente a la más antigua). */
function pruneImages(messages: ChatMessage[]): void {
  let kept = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'user' || !Array.isArray(m.content)) continue;
    m.content = m.content.map((part) => {
      if (part.type !== 'image_url') return part;
      kept++;
      return kept <= MAX_IMAGES_IN_CONTEXT ? part : OMITTED_IMAGE;
    });
  }
}
