// Test contra el escritorio de práctica real. SOLO LECTURA: conecta, captura y mueve el puntero.
// Requiere DESKTOP_URL y DESKTOP_PASSWORD (en .env). Sin ellas, se omite. `npm run test:live`.
import { diffFrames, isSignificant } from '../src/vnc/frame';
import { openRfb2Session } from '../src/vnc/rfb2-session';
import { VncDesktop } from '../src/vnc/vnc-desktop';
import { liveEnv } from './live-env';

const env = liveEnv();
const url = env.DESKTOP_URL ?? '';
const password = env.DESKTOP_PASSWORD ?? '';
const live = url && password ? describe : describe.skip;

live('VNC en vivo (escritorio de práctica)', () => {
  let desktop: VncDesktop | undefined;

  afterEach(async () => {
    await desktop?.close();
    desktop = undefined;
  });

  it('conecta, captura con píxeles y settle sin acción no ve cambios', async () => {
    const t0 = performance.now();
    desktop = new VncDesktop(await openRfb2Session({ url, password }));
    const connectMs = Math.round(performance.now() - t0);
    const frame = await desktop.capture();
    expect(frame.width).toBe(desktop.width);
    expect(frame.rgba.length).toBe(frame.width * frame.height * 4);
    const lit = frame.rgba.some((v, i) => i % 4 !== 3 && v !== 0);
    expect(lit).toBe(true);

    console.log(
      `conexión ${connectMs} ms · ${frame.width}×${frame.height} · espera de cambio ${desktop.changeWaitMs} ms`,
    );

    // Sin acciones: settle no debe ver cambios (el caret no cuenta).
    const before = await desktop.capture();
    const r = await desktop.settle(before);
    console.log(`settle sin acción: changed=${r.changed} en ${r.waitedMs} ms`);
    expect(isSignificant(diffFrames(before, r.frame))).toBe(r.changed);
  });

  it('una contraseña errónea falla con AUTH_FAILED sin filtrar secretos', async () => {
    // La autenticación VNC (DES) solo usa los 8 primeros caracteres: se altera el primero.
    const wrong = `${password[0] === 'x' ? 'y' : 'x'}${password.slice(1)}`;
    const result = await openRfb2Session({ url, password: wrong }).then(
      async (s) => {
        await s.close(); // no debería conectar; si conecta, no se deja abierta
        return 'conectó';
      },
      (e: unknown) => e,
    );
    expect(result).toMatchObject({ name: 'VncError', code: 'AUTH_FAILED' });
    const err = result as Error;
    const msg = String((err as Error).message);
    expect(msg).not.toContain(password);
    expect(msg).not.toContain(url);
  });

  it('tras destroy() no se puede actuar (watchdog, ADR-0006)', async () => {
    desktop = new VncDesktop(await openRfb2Session({ url, password }));
    desktop.destroy();
    await expect(desktop.click(10, 10)).rejects.toMatchObject({
      code: 'CLOSED',
    });
    await expect(desktop.capture()).rejects.toMatchObject({ code: 'CLOSED' });
  });
});
