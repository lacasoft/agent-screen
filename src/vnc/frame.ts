import {
  SIGNIFICANT_MIN_PIXELS,
  SIGNIFICANT_MIN_SIDE_PX,
} from './vnc.constants';

/** Captura del framebuffer en RGBA (4 bytes por píxel). */
export interface Frame {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
  /** Momento de la captura según el reloj del adaptador (ms). */
  readonly capturedAt: number;
}

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface FrameDiff {
  /** Píxeles cuyo RGB difiere. */
  readonly pixels: number;
  /** Caja que envuelve todos los píxeles distintos, o null si no hay ninguno. */
  readonly box: Box | null;
}

/** Compara RGB píxel a píxel (ignora alfa). Si cambian las dimensiones, cuenta como cambio total. */
export function diffFrames(a: Frame, b: Frame): FrameDiff {
  if (a.width !== b.width || a.height !== b.height) {
    return {
      pixels: b.width * b.height,
      box: { x: 0, y: 0, width: b.width, height: b.height },
    };
  }
  const { width } = a;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  let pixels = 0;
  const pa = a.rgba;
  const pb = b.rgba;
  for (let i = 0; i < pa.length; i += 4) {
    if (pa[i] !== pb[i] || pa[i + 1] !== pb[i + 1] || pa[i + 2] !== pb[i + 2]) {
      const p = i >> 2;
      const x = p % width;
      const y = (p - x) / width;
      pixels++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (pixels === 0) return { pixels: 0, box: null };
  return {
    pixels,
    box: { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 },
  };
}

/**
 * Cambio significativo (ADR-0013): descarta el caret parpadeante (1×13 px) y ruido fino.
 * Nota: dos cambios pequeños y distantes a la vez forman una caja grande; basta con superar los píxeles.
 */
export function isSignificant(diff: FrameDiff): boolean {
  return (
    diff.box !== null &&
    diff.pixels > SIGNIFICANT_MIN_PIXELS &&
    diff.box.width >= SIGNIFICANT_MIN_SIDE_PX &&
    diff.box.height >= SIGNIFICANT_MIN_SIDE_PX
  );
}
