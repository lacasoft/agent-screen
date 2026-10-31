// Test contra el escritorio de práctica real. SOLO LECTURA: conecta, captura y mueve el puntero.
// Requiere DESKTOP_URL y DESKTOP_PASSWORD (en .env). Sin ellas, se omite. `npm run test:live`.
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { diffFrames, isSignificant } from '../src/vnc/frame';
import { openRfb2Session } from '../src/vnc/rfb2-session';
import { VncDesktop } from '../src/vnc/vnc-desktop';

// Jest da a cada test una copia de process.env: se lee .env aparte (sin imprimir nada).
function fromDotEnv(): Record<string, string | undefined> {
  try {
    return parseEnv(readFileSync(`${__dirname}/../.env`, 'utf8'));
  } catch {
    return {};
  }
}
const env = { ...fromDotEnv(), ...process.env };
const url = env.DESKTOP_URL ?? '';
const password = env.DESKTOP_PASSWORD ?? '';
const live = url && password ? describe : describe.skip;

live('VNC en vivo (escritorio de práctica)', () => {
  let desktop: VncDesktop | undefined;

  afterEach(async () => {
    await desktop?.close();
    desktop = undefined;
  });

  it('conecta, captura con píxeles y calibra el lag', async () => {
    const t0 = performance.now();
    desktop = new VncDesktop(await openRfb2Session({ url, password }));
    const connectMs = Math.round(performance.now() - t0);
    const frame = await desktop.capture();
    expect(frame.width).toBe(desktop.width);
    expect(frame.rgba.length).toBe(frame.width * frame.height * 4);
    const lit = frame.rgba.some((v, i) => i % 4 !== 3 && v !== 0);
    expect(lit).toBe(true);

    const cal = await desktop.calibrate();
    console.log(
      `conexión ${connectMs} ms · ${frame.width}×${frame.height} · lag ${cal.lagMs} ms (medido: ${cal.measured}) · espera de cambio ${desktop.changeWaitMs} ms`,
    );
    expect(cal.lagMs).toBeGreaterThan(0);

    // Tras calibrar, sin acciones: settle no debe ver cambios (el caret no cuenta).
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
