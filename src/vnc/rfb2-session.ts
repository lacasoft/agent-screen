import { connect, Framebuffer, RfbError, type RfbClient } from 'rfb2';
import WebSocket, { createWebSocketStream } from 'ws';
import { type Clock, systemClock } from './clock';
import type { Frame } from './frame';
import {
  type DesktopTarget,
  type RfbSession,
  type RfbSessionOpener,
  VncError,
} from './rfb-session';
import {
  CLOSE_TIMEOUT_MS,
  CONNECT_TIMEOUT_MS,
  FRAME_TIMEOUT_MS,
} from './vnc.constants';

/**
 * Abre una sesión RFB sobre WebSocket (websockify) con rfb2 (ADR-0002).
 * Ningún error incluye la URL completa ni la contraseña (ADR-0010).
 */
export const openRfb2Session: RfbSessionOpener = async (
  target: DesktopTarget,
  options: { signal?: AbortSignal } = {},
) => {
  const url = parseTarget(target);
  const { signal } = options;
  if (signal?.aborted) throw new VncError('ABORTED', 'Conexión cancelada');

  const ws = new WebSocket(url, ['binary'], {
    handshakeTimeout: CONNECT_TIMEOUT_MS,
  });
  const onAbort = () => ws.terminate();
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', () =>
        reject(
          new VncError(
            'CONNECT_FAILED',
            `No se pudo abrir el WebSocket con ${url.host}`,
          ),
        ),
      );
      ws.once('close', () =>
        reject(
          signal?.aborted
            ? new VncError('ABORTED', 'Conexión cancelada')
            : new VncError(
                'CONNECT_FAILED',
                `WebSocket cerrado por ${url.host}`,
              ),
        ),
      );
    });

    const client = await connect({
      stream: createWebSocketStream(ws),
      password: target.password,
      timeout: CONNECT_TIMEOUT_MS,
      shared: true,
      signal,
    });
    return new Rfb2Session(client, ws);
  } catch (error) {
    ws.terminate();
    throw toVncError(error);
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
};

export class Rfb2Session implements RfbSession {
  private readonly framebuffer: Framebuffer;
  private isClosed = false;
  private readonly closedPromise: Promise<never>;

  constructor(
    private readonly client: RfbClient,
    private readonly ws: WebSocket,
    private readonly clock: Clock = systemClock,
  ) {
    this.framebuffer = Framebuffer.attach(client);
    let rejectClosed!: (e: Error) => void;
    this.closedPromise = new Promise<never>((_, reject) => {
      rejectClosed = reject;
    });
    this.closedPromise.catch(() => undefined); // evita unhandled rejection si nadie espera
    const markClosed = () => {
      if (this.isClosed) return;
      this.isClosed = true;
      rejectClosed(new VncError('CLOSED', 'La sesión VNC se cerró'));
    };
    client.on('close', markClosed);
    client.on('error', () => undefined); // los errores tras el handshake terminan en 'close'
    ws.on('close', markClosed);
  }

  get width(): number {
    return this.client.width;
  }

  get height(): number {
    return this.client.height;
  }

  get closed(): boolean {
    return this.isClosed;
  }

  async captureFrame(): Promise<Frame> {
    this.assertOpen();
    const deadline = this.clock.now() + FRAME_TIMEOUT_MS;
    // Algunas updates solo traen pseudo-rects (extendedDesktopSize): se espera a una con píxeles.
    for (;;) {
      const left = deadline - this.clock.now();
      if (left <= 0) {
        throw new VncError('NO_FRAME', 'Sin píxeles del escritorio a tiempo');
      }
      const next = this.client.nextUpdate();
      this.client.requestUpdate(false);
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new VncError('NO_FRAME', 'Sin píxeles del escritorio a tiempo'),
            ),
          left,
        );
      });
      try {
        const update = await Promise.race([next, timeout, this.closedPromise]);
        if (
          update.rects.some((r) => r.type === 'pixels' || r.type === 'copy')
        ) {
          return {
            width: this.framebuffer.width,
            height: this.framebuffer.height,
            rgba: new Uint8Array(this.framebuffer.toRgba()),
            capturedAt: this.clock.now(),
          };
        }
      } finally {
        clearTimeout(timer);
      }
    }
  }

  pointerEvent(x: number, y: number, buttonMask: number): void {
    this.assertOpen();
    this.client.pointerEvent(x, y, buttonMask);
  }

  keyEvent(keysym: number, down: boolean): void {
    this.assertOpen();
    this.client.keyEvent(keysym, down);
  }

  async close(): Promise<void> {
    if (!this.isClosed) {
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        this.client.close().catch(() => undefined),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, CLOSE_TIMEOUT_MS);
        }),
      ]);
      clearTimeout(timer);
    }
    this.destroy();
  }

  destroy(): void {
    this.isClosed = true;
    this.client.destroy();
    this.ws.terminate();
  }

  private assertOpen(): void {
    if (this.isClosed) {
      throw new VncError('CLOSED', 'La sesión VNC está cerrada');
    }
  }
}

function parseTarget(target: DesktopTarget): URL {
  let url: URL;
  try {
    url = new URL(target.url);
  } catch {
    throw new VncError('INVALID_TARGET', 'URL de escritorio inválida');
  }
  if (url.protocol !== 'wss:' && url.protocol !== 'ws:') {
    throw new VncError(
      'INVALID_TARGET',
      'La URL del escritorio debe ser ws(s)://',
    );
  }
  if (!target.password) {
    throw new VncError('INVALID_TARGET', 'Falta la contraseña del escritorio');
  }
  return url;
}

function toVncError(error: unknown): VncError {
  if (error instanceof VncError) return error;
  if (error instanceof RfbError) {
    switch (error.code) {
      case 'AUTH_FAILED':
      case 'AUTH_REQUIRED':
        return new VncError(
          'AUTH_FAILED',
          'El escritorio rechazó la contraseña',
        );
      case 'TIMEOUT':
        return new VncError(
          'TIMEOUT',
          'El handshake RFB superó el tiempo límite',
        );
      case 'ABORTED':
        return new VncError('ABORTED', 'Conexión cancelada');
      default:
        return new VncError('CONNECT_FAILED', `Fallo RFB (${error.code})`);
    }
  }
  return new VncError('CONNECT_FAILED', 'Fallo inesperado al conectar');
}
