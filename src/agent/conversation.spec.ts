import type { ChatMessage } from '../llm/llm-client';
import { KEEP_FULL_TURNS } from './agent.constants';
import { Conversation } from './conversation';

const img = (n: number) => `data:image/png;base64,IMG${n}`;
const images = (ms: ChatMessage[]) =>
  ms.flatMap((m) =>
    m.role === 'user' && Array.isArray(m.content)
      ? m.content.flatMap((p) =>
          p.type === 'image_url' ? [p.image_url.url] : [],
        )
      : [],
  );

function convoWithTurns(n: number): Conversation {
  const c = new Conversation('sistema');
  c.start('TAREA: x', img(0));
  for (let i = 1; i <= n; i++) {
    c.beginTurn();
    c.assistant(null, [
      {
        id: `c${i}`,
        type: 'function',
        function: { name: 'click', arguments: '{}' },
      },
    ]);
    c.toolResult(`c${i}`, 'EJECUTADA');
    c.observe(`Paso ${i}`, img(i));
    c.summarize(`Paso ${i}: click`);
  }
  return c;
}

describe('Conversation', () => {
  it('el sistema lleva punto de caché de prompt', () => {
    const [system] = convoWithTurns(0).messages;
    expect(system).toEqual({
      role: 'system',
      content: [
        { type: 'text', text: 'sistema', cache_control: { type: 'ephemeral' } },
      ],
    });
  });

  it('solo viaja la última captura', () => {
    const ms = convoWithTurns(3).messages;
    expect(images(ms)).toEqual([img(3)]);
    expect(JSON.stringify(ms)).toContain('[captura anterior omitida]');
  });

  it(`con más de ${KEEP_FULL_TURNS} turnos resume los antiguos y conserva la tarea`, () => {
    const total = KEEP_FULL_TURNS + 5;
    const ms = convoWithTurns(total).messages;
    expect(ms[1]).toMatchObject({ role: 'user' }); // la tarea sigue en la cabecera
    expect(JSON.stringify(ms[1])).toContain('TAREA: x');
    expect(ms[2]).toEqual({
      role: 'user',
      content: `Resumen de los pasos anteriores (ya ejecutados):\n${[1, 2, 3, 4, 5].map((i) => `Paso ${i}: click`).join('\n')}`,
    });
    const assistants = ms.filter((m) => m.role === 'assistant');
    expect(assistants).toHaveLength(KEEP_FULL_TURNS);
    expect(images(ms)).toEqual([img(total)]);
  });

  it('nunca deja un tool_call sin su respuesta', () => {
    const ms = convoWithTurns(KEEP_FULL_TURNS + 7).messages;
    const calls = ms.flatMap((m) =>
      m.role === 'assistant' ? (m.tool_calls ?? []).map((c) => c.id) : [],
    );
    const answered = new Set(
      ms.flatMap((m) => (m.role === 'tool' ? [m.tool_call_id] : [])),
    );
    expect(calls.every((id) => answered.has(id))).toBe(true);
    expect([...answered].every((id) => calls.includes(id))).toBe(true);
  });

  it('messages no muta el historial (la captura podada sigue disponible si vuelve a ser la última)', () => {
    const c = convoWithTurns(2);
    void c.messages;
    void c.messages;
    expect(images(c.messages)).toEqual([img(2)]);
  });

  it('añadir a un turno sin beginTurn es un error de programación', () => {
    expect(() => new Conversation('s').toolResult('x', 'y')).toThrow(
      'beginTurn',
    );
  });
});
