import { keysymFromChar, keysyms } from 'rfb2';
import { VncError } from './rfb-session';

/** Combinación de teclas resuelta a keysyms X11: modificadores en orden + tecla final. */
export interface KeyCombo {
  readonly modifiers: readonly number[];
  readonly key: number;
}

const MODIFIERS: Record<string, number> = {
  ctrl: keysyms.ControlLeft,
  control: keysyms.ControlLeft,
  shift: keysyms.ShiftLeft,
  alt: keysyms.AltLeft,
  meta: keysyms.MetaLeft,
  super: keysyms.SuperLeft,
};

const NAMED_KEYS: Record<string, number> = {
  enter: keysyms.Return,
  return: keysyms.Return,
  tab: keysyms.Tab,
  escape: keysyms.Escape,
  esc: keysyms.Escape,
  backspace: keysyms.BackSpace,
  delete: keysyms.Delete,
  del: keysyms.Delete,
  insert: keysyms.Insert,
  home: keysyms.Home,
  end: keysyms.End,
  pageup: keysyms.PageUp,
  pagedown: keysyms.PageDown,
  left: keysyms.Left,
  right: keysyms.Right,
  up: keysyms.Up,
  down: keysyms.Down,
  space: keysyms.Space,
  f1: keysyms.F1,
  f2: keysyms.F2,
  f3: keysyms.F3,
  f4: keysyms.F4,
  f5: keysyms.F5,
  f6: keysyms.F6,
  f7: keysyms.F7,
  f8: keysyms.F8,
  f9: keysyms.F9,
  f10: keysyms.F10,
  f11: keysyms.F11,
  f12: keysyms.F12,
};

/**
 * Divide un texto en code points tras normalizar a NFC: los keysyms X11 van por code point,
 * y NFC compone "e" + tilde combinante en "é". Los emojis compuestos no se soportan.
 */
export function toCodePoints(text: string): string[] {
  return Array.from(text.normalize('NFC'));
}

/** Keysym de un carácter imprimible (incluye acentos y ñ). */
export function keysymForChar(char: string): number {
  const points = toCodePoints(char);
  if (points.length !== 1) {
    throw new VncError('INVALID_ARGUMENT', 'Se esperaba un único carácter');
  }
  const [c] = points;
  if (c === '\n') return keysyms.Return;
  if (c === '\t') return keysyms.Tab;
  return keysymFromChar(c);
}

/**
 * Interpreta combinaciones como "ctrl+a", "shift+tab", "Enter" o "F5" (sin distinguir mayúsculas).
 * Lanza INVALID_ARGUMENT si una parte no se reconoce.
 */
export function parseKeyCombo(combo: string): KeyCombo {
  const parts = combo
    .split('+')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) {
    throw new VncError('INVALID_ARGUMENT', 'Combinación de teclas vacía');
  }
  const last = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1).map((m) => {
    const keysym = MODIFIERS[m.toLowerCase()];
    if (keysym === undefined) {
      throw new VncError('INVALID_ARGUMENT', `Modificador desconocido: ${m}`);
    }
    return keysym;
  });
  const named = NAMED_KEYS[last.toLowerCase()];
  if (named !== undefined) return { modifiers, key: named };
  if (toCodePoints(last).length === 1) {
    // Con modificadores, la letra va en minúscula (ctrl+A = ctrl+a).
    const char = modifiers.length > 0 ? last.toLowerCase() : last;
    return { modifiers, key: keysymForChar(char) };
  }
  throw new VncError('INVALID_ARGUMENT', `Tecla desconocida: ${last}`);
}
