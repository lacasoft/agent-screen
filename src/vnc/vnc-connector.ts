import { Inject, Injectable } from '@nestjs/common';
import type { DesktopTarget, RfbSessionOpener } from './rfb-session';
import { VncDesktop } from './vnc-desktop';

export const RFB_SESSION_OPENER = Symbol('RFB_SESSION_OPENER');

/** Punto de entrada del módulo: abre el escritorio indicado en cada tarea. */
@Injectable()
export class VncConnector {
  constructor(
    @Inject(RFB_SESSION_OPENER) private readonly openSession: RfbSessionOpener,
  ) {}

  async connect(
    target: DesktopTarget,
    options: { signal?: AbortSignal } = {},
  ): Promise<VncDesktop> {
    const session = await this.openSession(target, options);
    return new VncDesktop(session);
  }
}
