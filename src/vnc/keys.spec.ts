import { keysymFromChar, keysyms } from 'rfb2';
import { keysymForChar, parseKeyCombo } from './keys';
import { VncError } from './rfb-session';

describe('parseKeyCombo', () => {
  it('ctrl+a → ControlLeft + a', () => {
    expect(parseKeyCombo('ctrl+a')).toEqual({
      modifiers: [keysyms.ControlLeft],
      key: keysymFromChar('a'),
    });
  });

  it('con modificadores la letra va en minúscula (ctrl+A = ctrl+a)', () => {
    expect(parseKeyCombo('Ctrl+A')).toEqual(parseKeyCombo('ctrl+a'));
  });

  it('teclas con nombre, sin distinguir mayúsculas', () => {
    expect(parseKeyCombo('Enter').key).toBe(keysyms.Return);
    expect(parseKeyCombo('shift+Tab')).toEqual({
      modifiers: [keysyms.ShiftLeft],
      key: keysyms.Tab,
    });
    expect(parseKeyCombo('F5').key).toBe(keysyms.F5);
  });

  it.each(['', '+', 'hyper+a', 'ctrl+foo'])(
    'rechaza "%s" con INVALID_ARGUMENT',
    (combo) => {
      expect(() => parseKeyCombo(combo)).toThrow(VncError);
    },
  );
});

describe('keysymForChar', () => {
  it('acentos y ñ, también en forma descompuesta (NFC)', () => {
    expect(keysymForChar('ñ')).toBe(keysymFromChar('ñ'));
    expect(keysymForChar('e\u0301')).toBe(keysymFromChar('é'));
  });

  it('salto de línea → Return', () => {
    expect(keysymForChar('\n')).toBe(keysyms.Return);
  });

  it('rechaza más de un carácter', () => {
    expect(() => keysymForChar('ab')).toThrow(VncError);
  });
});
