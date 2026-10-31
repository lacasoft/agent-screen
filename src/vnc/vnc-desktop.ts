import { type Clock, systemClock } from './clock';
import { diffFrames, type Frame, isSignificant } from './frame';
import { keysymForChar, parseKeyCombo, toCodePoints } from './keys';
import { type RfbSession, VncError } from './rfb-session';
import {
  CALIBRATION_TIMEOUT_MS,
  CHANGE_WAIT_MAX_MS,
  CHANGE_WAIT_MIN_MS,
  CLICK_PRESS_MS,
  KEY_TAP_MS,
  LAG_FALLBACK_MS,
  POINTER_SETTLE_MS,
  POLL_MS,
  STABLE_MAX_MS,
  STABLE_MS,
} from './vnc.constants';

export type MouseButton = 'left' | 'middle' | 'right';
const BUTTON_MASK: Record<MouseButton, number> = {
  left: 1,
  middle: 2,
  right: 4,
};
const WHEEL_UP = 8;
const WHEEL_DOWN = 16;

export interface SettleResult {
  /** Última captura. */
  readonly frame: Frame;
  /** Hubo un cambio significativo respecto a la captura previa a la acción. */
  readonly changed: boolean;
  /** La pantalla quedó STABLE_MS sin cambios significativos. */
  readonly stable: boolean;
  /** Tiempo total esperando (ms). */
  readonly waitedMs: number;
}

export interface CalibrationResult {
  readonly lagMs: number;
  /** false si no se observó el cambio y se usó LAG_FALLBACK_MS. */
  readonly measured: boolean;
}

/**
 * Escritorio remoto de alto nivel: ver (capture/settle) y actuar (click/type/keys/scroll).
 * No decide nada ni reintenta acciones: eso es del agente y del Guard (ADR-0007).
 */
export class VncDesktop {
  private lag = LAG_FALLBACK_MS;

  constructor(
    private readonly session: RfbSession,
    private readonly clock: Clock = systemClock,
  ) {}

  get width(): number {
    return this.session.width;
  }

  get height(): number {
    return this.session.height;
  }

  get closed(): boolean {
    return this.session.closed;
  }

  /** Lag de pantalla vigente (ms): el calibrado o LAG_FALLBACK_MS. */
  get lagMs(): number {
    return this.lag;
  }

  /** Espera máxima de cambio tras una acción: clamp(1,5 × lag + 0,5 s, 1,5 s, 8 s) (ADR-0013). */
  get changeWaitMs(): number {
    return Math.min(
      CHANGE_WAIT_MAX_MS,
      Math.max(CHANGE_WAIT_MIN_MS, Math.round(1.5 * this.lag + 500)),
    );
  }

  capture(): Promise<Frame> {
    return this.session.captureFrame();
  }

  /**
   * Mide el lag moviendo el puntero a una zona neutra (abajo a la derecha) y esperando
   * a verlo en el framebuffer. Sin cambio en CALIBRATION_TIMEOUT_MS → LAG_FALLBACK_MS.
   */
  async calibrate(): Promise<CalibrationResult> {
    const before = await this.capture();
    const x = Math.max(0, this.width - 20);
    const y = Math.max(0, this.height - 20);
    const start = this.clock.now();
    this.movePointer(x, y);
    while (this.clock.now() - start < CALIBRATION_TIMEOUT_MS) {
      await this.clock.sleep(POLL_MS);
      const frame = await this.capture();
      if (isSignificant(diffFrames(before, frame))) {
        this.lag = Math.round(this.clock.now() - start);
        return { lagMs: this.lag, measured: true };
      }
    }
    this.lag = LAG_FALLBACK_MS;
    return { lagMs: this.lag, measured: false };
  }

  /** Clic con pulsación de CLICK_PRESS_MS (el escritorio ignora < 100 ms). */
  async click(
    x: number,
    y: number,
    options: { button?: MouseButton; double?: boolean } = {},
  ): Promise<void> {
    this.assertInside(x, y);
    const mask = BUTTON_MASK[options.button ?? 'left'];
    this.movePointer(x, y);
    await this.clock.sleep(POINTER_SETTLE_MS);
    const times = options.double ? 2 : 1;
    for (let i = 0; i < times; i++) {
      this.session.pointerEvent(x, y, mask);
      await this.clock.sleep(CLICK_PRESS_MS);
      this.session.pointerEvent(x, y, 0);
      if (i < times - 1) await this.clock.sleep(POINTER_SETTLE_MS);
    }
  }

  /** Rueda del ratón: `amount` muescas hacia arriba o abajo en (x, y). */
  async scroll(
    x: number,
    y: number,
    direction: 'up' | 'down',
    amount = 3,
  ): Promise<void> {
    this.assertInside(x, y);
    if (!Number.isInteger(amount) || amount < 1 || amount > 20) {
      throw new VncError('INVALID_ARGUMENT', 'Scroll fuera de rango (1–20)');
    }
    const mask = direction === 'up' ? WHEEL_UP : WHEEL_DOWN;
    this.movePointer(x, y);
    await this.clock.sleep(POINTER_SETTLE_MS);
    for (let i = 0; i < amount; i++) {
      this.session.pointerEvent(x, y, mask);
      this.session.pointerEvent(x, y, 0);
      await this.clock.sleep(KEY_TAP_MS);
    }
  }

  /**
   * Escribe texto en el foco actual. Con `replace`, selecciona antes todo (Ctrl+A)
   * para no concatenar con el contenido previo.
   */
  async typeText(
    text: string,
    options: { replace?: boolean } = {},
  ): Promise<void> {
    const keys = toCodePoints(text).map(keysymForChar); // valida todo antes de enviar nada
    if (options.replace) await this.pressKeys('ctrl+a');
    for (const keysym of keys) await this.tap(keysym);
  }

  /** Pulsa una combinación ("Enter", "ctrl+a", "shift+tab"…). */
  async pressKeys(combo: string): Promise<void> {
    const { modifiers, key } = parseKeyCombo(combo);
    for (const m of modifiers) {
      this.session.keyEvent(m, true);
      await this.clock.sleep(KEY_TAP_MS);
    }
    await this.tap(key);
    for (const m of [...modifiers].reverse()) {
      this.session.keyEvent(m, false);
      await this.clock.sleep(KEY_TAP_MS);
    }
  }

  /**
   * Tras una acción: espera hasta `changeWaitMs` un cambio significativo respecto a `before`
   * y luego STABLE_MS sin cambios significativos (ADR-0013). No haber cambio no es un fallo:
   * el llamador vuelve a observar y nunca repite una escritura a ciegas (ADR-0007).
   */
  async settle(before: Frame): Promise<SettleResult> {
    const start = this.clock.now();
    const waited = () => Math.round(this.clock.now() - start);
    let frame = before;
    let changed = false;
    while (this.clock.now() - start < this.changeWaitMs) {
      await this.clock.sleep(POLL_MS);
      frame = await this.capture();
      if (isSignificant(diffFrames(before, frame))) {
        changed = true;
        break;
      }
    }
    if (!changed) return { frame, changed, stable: true, waitedMs: waited() };

    let reference = frame;
    let stableSince = this.clock.now();
    const stableDeadline = this.clock.now() + STABLE_MAX_MS;
    while (this.clock.now() < stableDeadline) {
      await this.clock.sleep(POLL_MS);
      frame = await this.capture();
      if (isSignificant(diffFrames(reference, frame))) {
        reference = frame;
        stableSince = this.clock.now();
      } else if (this.clock.now() - stableSince >= STABLE_MS) {
        return { frame, changed, stable: true, waitedMs: waited() };
      }
    }
    return { frame, changed, stable: false, waitedMs: waited() };
  }

  close(): Promise<void> {
    return this.session.close();
  }

  destroy(): void {
    this.session.destroy();
  }

  private movePointer(x: number, y: number): void {
    this.session.pointerEvent(x, y, 0);
  }

  private async tap(keysym: number): Promise<void> {
    this.session.keyEvent(keysym, true);
    await this.clock.sleep(KEY_TAP_MS);
    this.session.keyEvent(keysym, false);
    await this.clock.sleep(KEY_TAP_MS);
  }

  private assertInside(x: number, y: number): void {
    if (
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      x < 0 ||
      y < 0 ||
      x >= this.width ||
      y >= this.height
    ) {
      throw new VncError(
        'INVALID_ARGUMENT',
        `Coordenadas fuera de pantalla (${this.width}×${this.height})`,
      );
    }
  }
}
