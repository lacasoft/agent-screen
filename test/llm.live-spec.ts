// Una llamada real a OpenRouter con una imagen sintética diminuta (coste mínimo).
// Requiere OPENROUTER_API_KEY y LLM_MODEL (en .env). Sin ellas, se omite. `npm run test:live`.
import { actionTools, parseToolCall } from '../src/llm/actions';
import { OpenRouterClient } from '../src/llm/openrouter.client';
import { toPngDataUrl } from '../src/vnc/png';
import { makeFrame } from '../src/vnc/testing/fakes';
import { liveEnv } from './live-env';

const env = liveEnv();
const apiKey = env.OPENROUTER_API_KEY ?? '';
const model = env.LLM_MODEL ?? '';
const live = apiKey && model ? describe : describe.skip;

live('LLM en vivo (OpenRouter)', () => {
  it('ve la imagen y propone un clic válido dentro del rectángulo negro', async () => {
    const screen = { width: 320, height: 200 };
    const target = { x: 200, y: 120, w: 60, h: 30 };
    const frame = makeFrame(screen.width, screen.height, [target]);
    const client = new OpenRouterClient({ apiKey, model });

    const r = await client.chat({
      messages: [
        {
          role: 'system',
          content:
            'Operas una pantalla. Responde siempre con exactamente una herramienta.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Captura de ${screen.width}×${screen.height} px. Haz clic en el centro del rectángulo negro.`,
            },
            { type: 'image_url', image_url: { url: toPngDataUrl(frame) } },
          ],
        },
      ],
      tools: actionTools(screen),
      remainingMs: 60_000,
    });

    const call = r.toolCalls[0];
    console.log(
      `modelo ${r.model} · ${r.latencyMs} ms · ${r.attempts} intento(s) · tokens ${r.usage.promptTokens}+${r.usage.completionTokens}` +
        ` · coste ${r.usage.cost ?? '—'} · ${call?.function.name} ${call?.function.arguments}`,
    );
    expect(call).toBeDefined();
    const parsed = parseToolCall(
      call.function.name,
      call.function.arguments,
      screen,
    );
    expect(parsed).toMatchObject({ ok: true, action: { type: 'click' } });
    if (parsed.ok && parsed.action.type === 'click') {
      expect(parsed.action.x).toBeGreaterThanOrEqual(target.x - 10);
      expect(parsed.action.x).toBeLessThanOrEqual(target.x + target.w + 10);
      expect(parsed.action.y).toBeGreaterThanOrEqual(target.y - 10);
      expect(parsed.action.y).toBeLessThanOrEqual(target.y + target.h + 10);
    }
  });
});
