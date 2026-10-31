import { Test } from '@nestjs/testing';
import type { RfbSessionOpener } from './rfb-session';
import { FakeClock, FakeSession, makeFrame } from './testing/fakes';
import { RFB_SESSION_OPENER, VncConnector } from './vnc-connector';
import { VncDesktop } from './vnc-desktop';

describe('VncConnector', () => {
  it('abre la sesión con el escritorio de la solicitud y devuelve un VncDesktop', async () => {
    const session = new FakeSession(new FakeClock(), () => makeFrame(100, 80));
    const opener = jest.fn<
      ReturnType<RfbSessionOpener>,
      Parameters<RfbSessionOpener>
    >(() => Promise.resolve(session));
    const moduleRef = await Test.createTestingModule({
      providers: [
        VncConnector,
        { provide: RFB_SESSION_OPENER, useValue: opener },
      ],
    }).compile();

    const target = { url: 'wss://desk.example/websockify', password: 'pw' };
    const signal = new AbortController().signal;
    const desktop = await moduleRef
      .get(VncConnector)
      .connect(target, { signal });

    expect(opener).toHaveBeenCalledWith(target, { signal });
    expect(desktop).toBeInstanceOf(VncDesktop);
    expect(desktop.width).toBe(100);
  });

  it('propaga el error del opener sin envolverlo', async () => {
    const opener: RfbSessionOpener = () => Promise.reject(new Error('boom'));
    const connector = new VncConnector(opener);
    await expect(
      connector.connect({ url: 'wss://x', password: 'p' }),
    ).rejects.toThrow('boom');
  });
});
