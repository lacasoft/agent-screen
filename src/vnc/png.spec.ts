import { PNG } from 'pngjs';
import { encodePng, toPngDataUrl } from './png';
import { makeFrame } from './testing/fakes';

describe('encodePng', () => {
  it('produce un PNG válido con los mismos píxeles RGB', () => {
    const frame = makeFrame(7, 5, [{ x: 2, y: 1, w: 3, h: 2 }]);
    const decoded = PNG.sync.read(encodePng(frame));
    expect([decoded.width, decoded.height]).toEqual([7, 5]);
    for (let p = 0; p < 7 * 5; p++) {
      for (let c = 0; c < 3; c++)
        expect(decoded.data[p * 4 + c]).toBe(frame.rgba[p * 4 + c]);
      expect(decoded.data[p * 4 + 3]).toBe(255);
    }
  });

  it('toPngDataUrl usa el prefijo data:image/png;base64', () => {
    expect(toPngDataUrl(makeFrame(2, 2))).toMatch(
      /^data:image\/png;base64,iVBORw0KGgo/,
    );
  });
});
