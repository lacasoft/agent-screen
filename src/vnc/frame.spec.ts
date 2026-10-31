import { diffFrames, isSignificant } from './frame';
import { makeFrame } from './testing/fakes';

describe('diffFrames / isSignificant', () => {
  const base = makeFrame(100, 80);

  it('frames idénticos: sin píxeles ni caja', () => {
    expect(diffFrames(base, makeFrame(100, 80))).toEqual({
      pixels: 0,
      box: null,
    });
    expect(isSignificant(diffFrames(base, base))).toBe(false);
  });

  it('da la caja exacta del cambio', () => {
    const d = diffFrames(
      base,
      makeFrame(100, 80, [{ x: 10, y: 20, w: 12, h: 5 }]),
    );
    expect(d).toEqual({
      pixels: 60,
      box: { x: 10, y: 20, width: 12, height: 5 },
    });
    expect(isSignificant(d)).toBe(true);
  });

  it('ignora el caret parpadeante (1×13 px), medido en el spike', () => {
    const caret = makeFrame(100, 80, [{ x: 78, y: 25, w: 1, h: 13 }]);
    expect(isSignificant(diffFrames(base, caret))).toBe(false);
  });

  it('ignora líneas finas aunque superen 50 px (2 px de ancho)', () => {
    const line = makeFrame(100, 80, [{ x: 5, y: 0, w: 2, h: 40 }]);
    expect(diffFrames(base, line).pixels).toBe(80);
    expect(isSignificant(diffFrames(base, line))).toBe(false);
  });

  it('ignora cambios de 50 px o menos', () => {
    expect(
      isSignificant(
        diffFrames(base, makeFrame(100, 80, [{ x: 0, y: 0, w: 5, h: 10 }])),
      ),
    ).toBe(false);
    expect(
      isSignificant(
        diffFrames(base, makeFrame(100, 80, [{ x: 0, y: 0, w: 3, h: 17 }])),
      ),
    ).toBe(true);
  });

  it('el cambio de tamaño de pantalla cuenta como cambio total', () => {
    const d = diffFrames(base, makeFrame(120, 80));
    expect(d.box).toEqual({ x: 0, y: 0, width: 120, height: 80 });
    expect(isSignificant(d)).toBe(true);
  });
});
