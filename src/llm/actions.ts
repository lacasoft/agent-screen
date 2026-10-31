/**
 * Acciones que el modelo puede proponer, como herramientas (tool calling). Aquí se valida
 * la FORMA (tipos, rangos, pantalla); la POLÍTICA (destructivas, plazo, homónimos) es del Guard.
 */
export type AgentAction =
  | {
      type: 'click';
      x: number;
      y: number;
      button: 'left' | 'right' | 'middle';
      double: boolean;
      reason: string;
    }
  | { type: 'type'; text: string; replace: boolean; reason: string }
  | { type: 'key'; combo: string; reason: string }
  | {
      type: 'scroll';
      x: number;
      y: number;
      direction: 'up' | 'down';
      amount: number;
      reason: string;
    }
  | { type: 'wait'; ms: number; reason: string }
  | { type: 'finish'; resumen: string }
  | { type: 'fail'; resumen: string };

export type AgentActionType = AgentAction['type'];

export interface ScreenSize {
  readonly width: number;
  readonly height: number;
}

export const WAIT_MIN_MS = 250;
export const WAIT_MAX_MS = 5_000;
const MAX_TEXT = 500;
const MAX_REASON = 300;
const MAX_RESUMEN = 2_000;

export interface ToolDefinition {
  type: 'function';
  function: {
    name: AgentActionType;
    description: string;
    parameters: Record<string, unknown>;
  };
}

const reason = {
  type: 'string',
  description: 'Por qué esta acción, en una frase.',
  maxLength: MAX_REASON,
};

/** Herramientas para la API (JSON Schema). Las coordenadas son píxeles de la captura. */
export function actionTools(screen: ScreenSize): ToolDefinition[] {
  const x = {
    type: 'integer',
    minimum: 0,
    maximum: screen.width - 1,
    description: 'Píxel X en la captura',
  };
  const y = {
    type: 'integer',
    minimum: 0,
    maximum: screen.height - 1,
    description: 'Píxel Y en la captura',
  };
  const obj = (properties: Record<string, unknown>, required: string[]) => ({
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  });
  return [
    tool(
      'click',
      'Clic en un punto de la pantalla.',
      obj(
        {
          x,
          y,
          button: {
            type: 'string',
            enum: ['left', 'right', 'middle'],
            default: 'left',
          },
          double: { type: 'boolean', default: false },
          reason,
        },
        ['x', 'y', 'reason'],
      ),
    ),
    tool(
      'type',
      'Escribe texto en el campo con foco. replace=true selecciona antes su contenido (Ctrl+A).',
      obj(
        {
          text: { type: 'string', minLength: 1, maxLength: MAX_TEXT },
          replace: { type: 'boolean', default: false },
          reason,
        },
        ['text', 'reason'],
      ),
    ),
    tool(
      'key',
      'Pulsa una tecla o combinación: "Enter", "Tab", "Escape", "ctrl+a", "shift+tab"…',
      obj(
        {
          combo: { type: 'string', minLength: 1, maxLength: 40 },
          reason,
        },
        ['combo', 'reason'],
      ),
    ),
    tool(
      'scroll',
      'Rueda del ratón sobre un punto.',
      obj(
        {
          x,
          y,
          direction: { type: 'string', enum: ['up', 'down'] },
          amount: { type: 'integer', minimum: 1, maximum: 20, default: 3 },
          reason,
        },
        ['x', 'y', 'direction', 'reason'],
      ),
    ),
    tool(
      'wait',
      'Espera a que la interfaz termine de cargar.',
      obj(
        {
          ms: { type: 'integer', minimum: WAIT_MIN_MS, maximum: WAIT_MAX_MS },
          reason,
        },
        ['ms', 'reason'],
      ),
    ),
    tool(
      'finish',
      'La tarea está completa y VERIFICADA en pantalla. resumen sigue el formato exigido.',
      obj(
        {
          resumen: { type: 'string', minLength: 1, maxLength: MAX_RESUMEN },
        },
        ['resumen'],
      ),
    ),
    tool(
      'fail',
      'La tarea no puede o no debe hacerse (ambigua, imposible, peligrosa). Explica con los datos relevantes.',
      obj(
        {
          resumen: { type: 'string', minLength: 1, maxLength: MAX_RESUMEN },
        },
        ['resumen'],
      ),
    ),
  ];
}

function tool(
  name: AgentActionType,
  description: string,
  parameters: Record<string, unknown>,
): ToolDefinition {
  return { type: 'function', function: { name, description, parameters } };
}

export type ParseResult =
  { ok: true; action: AgentAction } | { ok: false; error: string };

/**
 * Valida una tool call del modelo. Rechaza campos de más, tipos erróneos y coordenadas fuera
 * de pantalla: el agente vuelve a observar o termina fallida (fallas previstas del diseño).
 */
export function parseToolCall(
  name: string,
  rawArguments: string,
  screen: ScreenSize,
): ParseResult {
  let args: unknown;
  try {
    args = rawArguments.trim() === '' ? {} : JSON.parse(rawArguments);
  } catch {
    return { ok: false, error: `argumentos de ${name} no son JSON válido` };
  }
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    return { ok: false, error: `argumentos de ${name} deben ser un objeto` };
  }
  const a = args as Record<string, unknown>;
  try {
    switch (name) {
      case 'click':
        only(a, ['x', 'y', 'button', 'double', 'reason']);
        return ok({
          type: 'click',
          x: int(a.x, 'x', 0, screen.width - 1),
          y: int(a.y, 'y', 0, screen.height - 1),
          button: oneOf(a.button ?? 'left', 'button', [
            'left',
            'right',
            'middle',
          ] as const),
          double: bool(a.double ?? false, 'double'),
          reason: str(a.reason, 'reason', 1, MAX_REASON),
        });
      case 'type':
        only(a, ['text', 'replace', 'reason']);
        return ok({
          type: 'type',
          text: str(a.text, 'text', 1, MAX_TEXT),
          replace: bool(a.replace ?? false, 'replace'),
          reason: str(a.reason, 'reason', 1, MAX_REASON),
        });
      case 'key':
        only(a, ['combo', 'reason']);
        return ok({
          type: 'key',
          combo: str(a.combo, 'combo', 1, 40),
          reason: str(a.reason, 'reason', 1, MAX_REASON),
        });
      case 'scroll':
        only(a, ['x', 'y', 'direction', 'amount', 'reason']);
        return ok({
          type: 'scroll',
          x: int(a.x, 'x', 0, screen.width - 1),
          y: int(a.y, 'y', 0, screen.height - 1),
          direction: oneOf(a.direction, 'direction', ['up', 'down'] as const),
          amount: int(a.amount ?? 3, 'amount', 1, 20),
          reason: str(a.reason, 'reason', 1, MAX_REASON),
        });
      case 'wait':
        only(a, ['ms', 'reason']);
        return ok({
          type: 'wait',
          ms: int(a.ms, 'ms', WAIT_MIN_MS, WAIT_MAX_MS),
          reason: str(a.reason, 'reason', 1, MAX_REASON),
        });
      case 'finish':
      case 'fail':
        only(a, ['resumen']);
        return ok({
          type: name,
          resumen: str(a.resumen, 'resumen', 1, MAX_RESUMEN),
        });
      default:
        return { ok: false, error: `acción desconocida: ${name}` };
    }
  } catch (e) {
    return { ok: false, error: `${name}: ${(e as Error).message}` };
  }
}

const ok = (action: AgentAction): ParseResult => ({ ok: true, action });

function only(a: Record<string, unknown>, allowed: string[]): void {
  const extra = Object.keys(a).filter((k) => !allowed.includes(k));
  if (extra.length)
    throw new Error(`campos no permitidos: ${extra.join(', ')}`);
}

function int(v: unknown, field: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v))
    throw new Error(`${field} debe ser entero`);
  if (v < min || v > max)
    throw new Error(`${field} fuera de rango [${min}, ${max}]`);
  return v;
}

function str(v: unknown, field: string, min: number, max: number): string {
  if (typeof v !== 'string') throw new Error(`${field} debe ser texto`);
  const t = field === 'text' ? v : v.trim(); // el texto a escribir se respeta literal
  if (t.length < min || t.length > max)
    throw new Error(`${field} con longitud fuera de [${min}, ${max}]`);
  return t;
}

function bool(v: unknown, field: string): boolean {
  if (typeof v !== 'boolean') throw new Error(`${field} debe ser booleano`);
  return v;
}

function oneOf<T extends string>(
  v: unknown,
  field: string,
  values: readonly T[],
): T {
  if (typeof v !== 'string' || !values.includes(v as T)) {
    throw new Error(`${field} debe ser uno de: ${values.join(', ')}`);
  }
  return v as T;
}
