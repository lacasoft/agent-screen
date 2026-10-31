import type { Clock } from '../../common/clock';
import type { Frame } from '../frame';
import type { RfbSession } from '../rfb-session';
import { VncError } from '../rfb-session';

/** Reloj virtual: sleep() avanza el tiempo al instante. */
export class FakeClock implements Clock {
  private t = 0;
  now(): number {
    return this.t;
  }
  sleep(ms: number): Promise<void> {
    this.t += ms;
    return Promise.resolve();
  }
  advance(ms: number): void {
    this.t += ms;
  }
}

/** Frame sólido de w×h con rectángulos pintados encima. */
export function makeFrame(
  width: number,
  height: number,
  rects: { x: number; y: number; w: number; h: number }[] = [],
  capturedAt = 0,
): Frame {
  const rgba = new Uint8Array(width * height * 4).fill(200);
  for (const r of rects) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const i = (y * width + x) * 4;
        rgba[i] = 0;
        rgba[i + 1] = 0;
        rgba[i + 2] = 0;
      }
    }
  }
  return { width, height, rgba, capturedAt };
}

export type SessionEvent =
  | { kind: 'pointer'; x: number; y: number; mask: number; at: number }
  | { kind: 'key'; keysym: number; down: boolean; at: number };

/**
 * Sesión RFB falsa: registra los eventos con el instante virtual y devuelve
 * el frame que diga `screen(now)`. Cada captura cuesta `captureCostMs`.
 */
export class FakeSession implements RfbSession {
  readonly events: SessionEvent[] = [];
  closed = false;
  captures = 0;

  constructor(
    private readonly clock: FakeClock,
    readonly screen: (now: number) => Frame,
    readonly width = 100,
    readonly height = 80,
    private readonly captureCostMs = 0,
  ) {}

  captureFrame(): Promise<Frame> {
    if (this.closed) return Promise.reject(new VncError('CLOSED', 'cerrada'));
    this.captures++;
    this.clock.advance(this.captureCostMs);
    return Promise.resolve(this.screen(this.clock.now()));
  }

  pointerEvent(x: number, y: number, mask: number): void {
    if (this.closed) throw new VncError('CLOSED', 'cerrada');
    this.events.push({ kind: 'pointer', x, y, mask, at: this.clock.now() });
  }

  keyEvent(keysym: number, down: boolean): void {
    if (this.closed) throw new VncError('CLOSED', 'cerrada');
    this.events.push({ kind: 'key', keysym, down, at: this.clock.now() });
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }

  destroy(): void {
    this.closed = true;
  }
}
