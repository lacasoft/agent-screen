import { actionTools, parseToolCall } from './actions';

const screen = { width: 1280, height: 800 };
const parse = (name: string, args: unknown) =>
  parseToolCall(
    name,
    typeof args === 'string' ? args : JSON.stringify(args),
    screen,
  );

describe('parseToolCall', () => {
  it('click con valores por defecto (izquierdo, simple)', () => {
    expect(
      parse('click', {
        x: 90,
        y: 134,
        intent: 'escribir',
        reason: 'campo Cliente',
      }),
    ).toEqual({
      ok: true,
      action: {
        type: 'click',
        x: 90,
        y: 134,
        button: 'left',
        double: false,
        intent: 'escribir',
        reason: 'campo Cliente',
      },
    });
  });

  it('confirmación con datos de commit', () => {
    expect(
      parse('key', {
        combo: 'Enter',
        intent: 'confirmar',
        registro: 'existente',
        coincidencias: 1,
        reason: 'guardar',
      }),
    ).toEqual({
      ok: true,
      action: {
        type: 'key',
        combo: 'Enter',
        intent: 'confirmar',
        registro: 'existente',
        coincidencias: 1,
        reason: 'guardar',
      },
    });
  });

  it('type respeta el texto literal (espacios incluidos) y recorta reason', () => {
    expect(
      parse('type', {
        text: ' Calle 80 # 24-15 ',
        replace: true,
        reason: '  dirección  ',
      }),
    ).toEqual({
      ok: true,
      action: {
        type: 'type',
        text: ' Calle 80 # 24-15 ',
        replace: true,
        reason: 'dirección',
      },
    });
  });

  it('finish y fail llevan solo el resumen', () => {
    expect(parse('finish', { resumen: 'respuesta: 45' })).toEqual({
      ok: true,
      action: { type: 'finish', resumen: 'respuesta: 45' },
    });
    expect(
      parse('fail', { resumen: 'Hay dos Ana Torres: 52345678 y 1019876543' })
        .ok,
    ).toBe(true);
  });

  it.each([
    [
      'coordenada fuera de pantalla',
      'click',
      { x: 1280, y: 10, intent: 'navegar', reason: 'r' },
    ],
    [
      'coordenada negativa',
      'click',
      { x: -1, y: 10, intent: 'navegar', reason: 'r' },
    ],
    [
      'coordenada decimal',
      'click',
      { x: 10.5, y: 10, intent: 'navegar', reason: 'r' },
    ],
    [
      'coordenada como texto',
      'click',
      { x: '10', y: 10, intent: 'navegar', reason: 'r' },
    ],
    ['sin reason', 'click', { x: 1, y: 1, intent: 'navegar' }],
    ['sin intent', 'click', { x: 1, y: 1, reason: 'r' }],
    [
      'intent desconocido',
      'key',
      { combo: 'Enter', intent: 'borrar_todo', reason: 'r' },
    ],
    [
      'coincidencias negativas',
      'click',
      { x: 1, y: 1, intent: 'confirmar', coincidencias: -1, reason: 'r' },
    ],
    [
      'registro inválido',
      'click',
      { x: 1, y: 1, intent: 'confirmar', registro: 'otro', reason: 'r' },
    ],
    [
      'campo extra',
      'click',
      { x: 1, y: 1, intent: 'navegar', reason: 'r', force: true },
    ],
    [
      'botón inválido',
      'click',
      { x: 1, y: 1, intent: 'navegar', reason: 'r', button: 'side' },
    ],
    ['texto vacío', 'type', { text: '', reason: 'r' }],
    ['wait demasiado largo', 'wait', { ms: 60_000, reason: 'r' }],
    ['scroll sin dirección', 'scroll', { x: 1, y: 1, reason: 'r' }],
    ['finish sin resumen', 'finish', {}],
    ['finish con resumen en blanco', 'finish', { resumen: '   ' }],
    ['acción desconocida', 'delete_record', { id: 1 }],
    ['JSON inválido', 'click', '{x: 1'],
    ['argumentos no objeto', 'click', '[1,2]'],
  ])('rechaza: %s', (_c, name, args) => {
    expect(parse(name, args).ok).toBe(false);
  });
});

describe('actionTools', () => {
  it('expone las 7 acciones con esquemas cerrados y límites de pantalla', () => {
    const tools = actionTools(screen);
    expect(tools.map((t) => t.function.name)).toEqual([
      'click',
      'type',
      'key',
      'scroll',
      'wait',
      'finish',
      'fail',
    ]);
    for (const t of tools)
      expect(t.function.parameters.additionalProperties).toBe(false);
    const click = tools[0].function.parameters as {
      properties: Record<string, { maximum?: number }>;
      required: string[];
    };
    expect(click.properties.x.maximum).toBe(1279);
    expect(click.properties.y.maximum).toBe(799);
    expect(click.required).toContain('intent');
  });
});
