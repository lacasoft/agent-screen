import type { Frame } from './frame';

/** Escritorio indicado en cada POST /tasks. La contraseña nunca se loguea ni se persiste. */
export interface DesktopTarget {
  readonly url: string;
  readonly password: string;
}

/** Puerto de bajo nivel hacia un servidor RFB. La implementación real vive en rfb2-session.ts. */
export interface RfbSession {
  readonly width: number;
  readonly height: number;
  readonly closed: boolean;
  /** Captura completa (update no incremental); espera a una update con píxeles. */
  captureFrame(): Promise<Frame>;
  pointerEvent(x: number, y: number, buttonMask: number): void;
  keyEvent(keysym: number, down: boolean): void;
  /** Cierre ordenado con timeout; siempre termina destruyendo el socket. */
  close(): Promise<void>;
  /** Corte inmediato (watchdog). */
  destroy(): void;
}

export type VncErrorCode =
  | 'INVALID_TARGET'
  | 'CONNECT_FAILED'
  | 'AUTH_FAILED'
  | 'TIMEOUT'
  | 'ABORTED'
  | 'CLOSED'
  | 'NO_FRAME'
  | 'INVALID_ARGUMENT';

/** Errores del adaptador. Sus mensajes nunca incluyen la URL completa ni la contraseña. */
export class VncError extends Error {
  constructor(
    readonly code: VncErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'VncError';
  }
}

export type RfbSessionOpener = (
  target: DesktopTarget,
  options?: { signal?: AbortSignal },
) => Promise<RfbSession>;
