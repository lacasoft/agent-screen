import { FakeClock } from '../vnc/testing/fakes';
import type { ChatRequest } from './llm-client';
import { LlmError } from './llm-error';
import { callTimeoutMs, OpenRouterClient } from './openrouter.client';

const API_KEY = 'sk-or-secret-key-123';
const toolCall = {
  id: 'c1',
  type: 'function',
  function: { name: 'click', arguments: '{"x":1,"y":2,"reason":"r"}' },
};
const okBody = (over: Record<string, unknown> = {}) => ({
  model: 'anthropic/claude-sonnet-5.5',
  choices: [{ message: { content: null, tool_calls: [toolCall] } }],
  usage: { prompt_tokens: 1500, completion_tokens: 40, cost: 0.0034 },
  ...over,
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

function setup(
  responses: (Response | Error | 'hang')[],
  opts: { fallbacks?: string[] } = {},
) {
  const clock = new FakeClock();
  const requests: { url: string; init: RequestInit; rawBody: string }[] = [];
  const fetchFn = jest.fn((url: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: url instanceof Request ? url.url : url.toString(),
      init: init ?? {},
      rawBody: typeof init?.body === 'string' ? init.body : '',
    });
    const next = responses.shift() ?? new Error('sin más respuestas');
    if (next === 'hang') {
      return new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        ),
      );
    }
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
  const client = new OpenRouterClient({
    apiKey: API_KEY,
    model: 'anthropic/claude-sonnet-5.5',
    fallbackModels: opts.fallbacks,
    fetch: fetchFn as unknown as typeof fetch,
    clock,
    random: () => 0.5, // jitter 0
  });
  const body = (i = 0) =>
    JSON.parse(requests[i].rawBody) as Record<string, unknown>;
  return { client, clock, fetchFn, requests, body };
}

const request = (over: Partial<ChatRequest> = {}): ChatRequest => ({
  messages: [{ role: 'user', content: [{ type: 'text', text: 'tarea' }] }],
  tools: [],
  remainingMs: 200_000,
  ...over,
});

describe('callTimeoutMs (ADR-0012)', () => {
  it('min(25 s, restante − 5 s); por debajo de 5 s → NO_TIME', () => {
    expect(callTimeoutMs(270_000)).toBe(25_000);
    expect(callTimeoutMs(20_000)).toBe(15_000);
    expect(callTimeoutMs(10_000)).toBe(5_000);
    expect(() => callTimeoutMs(9_999)).toThrow(
      expect.objectContaining({ code: 'NO_TIME' }) as Error,
    );
  });
});

describe('OpenRouterClient', () => {
  it('envía tools con tool_choice auto, solo parámetros soportados y la API key solo en la cabecera', async () => {
    const { client, requests, body } = setup([json(okBody())]);
    await client.chat(request());
    expect(requests[0].url).toBe(
      'https://openrouter.ai/api/v1/chat/completions',
    );
    expect(
      (requests[0].init.headers as Record<string, string>).Authorization,
    ).toBe(`Bearer ${API_KEY}`);
    expect(body()).toMatchObject({
      model: 'anthropic/claude-sonnet-5.5',
      tool_choice: 'auto',
      provider: { require_parameters: true },
    });
    // Con require_parameters, cualquier parámetro no soportado descarta al proveedor (404).
    expect(body()).not.toHaveProperty('temperature');
    expect(body()).not.toHaveProperty('parallel_tool_calls');
    expect(body()).not.toHaveProperty('models');
    expect(requests[0].rawBody).not.toContain(API_KEY);
  });

  it('con respaldo envía models = [principal, ...respaldo] y devuelve el modelo que respondió', async () => {
    const { client, body } = setup(
      [json(okBody({ model: 'openai/gpt-6.1-sol' }))],
      {
        fallbacks: ['openai/gpt-6.1-sol', 'anthropic/claude-sonnet-5.5'],
      },
    );
    const r = await client.chat(request());
    expect(body().models).toEqual([
      'anthropic/claude-sonnet-5.5',
      'openai/gpt-6.1-sol',
    ]);
    expect(r.model).toBe('openai/gpt-6.1-sol');
  });

  it('devuelve tool calls, uso, coste e intentos', async () => {
    const { client } = setup([json(okBody())]);
    expect(await client.chat(request())).toMatchObject({
      toolCalls: [toolCall],
      text: null,
      usage: { promptTokens: 1500, completionTokens: 40, cost: 0.0034 },
      attempts: 1,
    });
  });

  it('reintenta una vez ante 429 con backoff de ~1 s', async () => {
    const { client, clock, fetchFn } = setup([
      json({ error: { message: 'slow down' } }, 429),
      json(okBody()),
    ]);
    const r = await client.chat(request());
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(r.attempts).toBe(2);
    expect(clock.now()).toBe(1_000);
  });

  it.each([
    ['5xx', [json({}, 503), json({}, 500)], 'HTTP_ERROR'],
    [
      'red',
      [new TypeError('fetch failed'), new TypeError('fetch failed')],
      'NETWORK',
    ],
    [
      'error de proveedor dentro de un 200',
      [json({ error: { code: 502, message: 'upstream' } }), json({}, 502)],
      'HTTP_ERROR',
    ],
  ])('reintenta %s solo una vez y luego falla', async (_c, responses, code) => {
    const { client, fetchFn } = setup(responses as Response[]);
    await expect(client.chat(request())).rejects.toMatchObject({ code });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('no reintenta un 400 y el error no contiene la API key', async () => {
    const { client, fetchFn } = setup([
      json({ error: { message: 'invalid tools' } }, 400),
    ]);
    const err = (await client
      .chat(request())
      .catch((e: unknown) => e)) as LlmError;
    expect(err).toMatchObject({ code: 'HTTP_ERROR', status: 400 });
    expect(err.message).toContain('invalid tools');
    expect(err.message).not.toContain(API_KEY);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('no reintenta si el siguiente intento tendría < 10 s de timeout', async () => {
    const { client, fetchFn } = setup([json({}, 429), json(okBody())]);
    await expect(
      client.chat(request({ remainingMs: 15_000 })),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('NO_TIME sin llamar si quedan menos de 10 s hasta el watchdog', async () => {
    const { client, fetchFn } = setup([json(okBody())]);
    await expect(
      client.chat(request({ remainingMs: 9_000 })),
    ).rejects.toMatchObject({ code: 'NO_TIME' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('BAD_RESPONSE si no hay choices o no hay acción ni texto', async () => {
    const a = setup([json({ choices: [] })]);
    await expect(a.client.chat(request())).rejects.toMatchObject({
      code: 'BAD_RESPONSE',
    });
    const b = setup([
      json(
        okBody({ choices: [{ message: { content: '  ', tool_calls: [] } }] }),
      ),
    ]);
    await expect(b.client.chat(request())).rejects.toMatchObject({
      code: 'BAD_RESPONSE',
    });
  });

  it('una respuesta solo con texto se devuelve (el agente decide qué hacer)', async () => {
    const { client } = setup([
      json(
        okBody({
          choices: [{ message: { content: 'no sé', tool_calls: [] } }],
        }),
      ),
    ]);
    expect(await client.chat(request())).toMatchObject({
      toolCalls: [],
      text: 'no sé',
    });
  });

  describe('timeouts y cancelación', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('corta la llamada en su timeout (TIMEOUT) y no la reintenta', async () => {
      const { client, fetchFn } = setup(['hang', json(okBody())]);
      const p = client
        .chat(request({ remainingMs: 20_000 }))
        .catch((e: unknown) => e);
      await jest.advanceTimersByTimeAsync(15_000);
      expect(await p).toMatchObject({ code: 'TIMEOUT' });
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('la señal de la tarea aborta la llamada en curso (ABORTED)', async () => {
      const { client } = setup(['hang']);
      const ac = new AbortController();
      const p = client
        .chat(request({ signal: ac.signal }))
        .catch((e: unknown) => e);
      await jest.advanceTimersByTimeAsync(100);
      ac.abort();
      expect(await p).toMatchObject({ code: 'ABORTED' });
    });

    it('con la señal ya abortada no llama', async () => {
      const { client, fetchFn } = setup([json(okBody())]);
      const ac = new AbortController();
      ac.abort();
      await expect(
        client.chat(request({ signal: ac.signal })),
      ).rejects.toMatchObject({ code: 'ABORTED' });
      expect(fetchFn).not.toHaveBeenCalled();
    });
  });
});
