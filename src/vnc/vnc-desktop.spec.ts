import { keysymFromChar, keysyms } from 'rfb2';
import { VncError } from './rfb-session';
import { FakeClock, FakeSession, makeFrame } from './testing/fakes';
import { VncDesktop } from './vnc-desktop';
import {
  CHANGE_WAIT_MS,
  CLICK_PRESS_MS,
  STABLE_MAX_MS,
  STABLE_MS,
} from './vnc.constants';

const W = 100;
const H = 80;
const LAG = 3_400; // medido en el spike (ADR-0013)
const textBlock = { x: 10, y: 10, w: 20, h: 8 }; // 160 px: significativo
const caret = { x: 31, y: 10, w: 1, h: 13 }; // 13 px: no significativo

function setup(
  screen: (now: number) => ReturnType<typeof makeFrame>,
  captureCostMs = 0,
) {
  const clock = new FakeClock();
  const session = new FakeSession(clock, screen, W, H, captureCostMs);
  return { clock, session, desktop: new VncDesktop(session, clock) };
}
const blank = () => makeFrame(W, H);

describe('VncDesktop', () => {
  describe('click', () => {
    it('mueve, pulsa y suelta con ≥ 150 ms de pulsación (el escritorio ignora < 100 ms)', async () => {
      const { session, desktop } = setup(blank);
      await desktop.click(40, 30);
      const [move, down, up] = session.events;
      expect(move).toMatchObject({ kind: 'pointer', x: 40, y: 30, mask: 0 });
      expect(down).toMatchObject({ kind: 'pointer', x: 40, y: 30, mask: 1 });
      expect(up).toMatchObject({ kind: 'pointer', x: 40, y: 30, mask: 0 });
      expect(up.at - down.at).toBeGreaterThanOrEqual(CLICK_PRESS_MS);
    });

    it('doble clic y botón derecho', async () => {
      const { session, desktop } = setup(blank);
      await desktop.click(1, 1, { double: true, button: 'right' });
      expect(
        session.events.filter((e) => e.kind === 'pointer' && e.mask === 4),
      ).toHaveLength(2);
    });

    it.each([
      [-1, 0],
      [W, 0],
      [0, H],
      [1.5, 2],
    ])('rechaza (%p, %p) fuera de pantalla sin enviar nada', async (x, y) => {
      const { session, desktop } = setup(blank);
      await expect(desktop.click(x, y)).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
      });
      expect(session.events).toHaveLength(0);
    });

    it('con la sesión cerrada falla con CLOSED y no envía nada', async () => {
      const { session, desktop } = setup(blank);
      session.destroy();
      await expect(desktop.click(1, 1)).rejects.toBeInstanceOf(VncError);
      await expect(desktop.click(1, 1)).rejects.toMatchObject({
        code: 'CLOSED',
      });
      expect(session.events).toHaveLength(0);
    });
  });

  describe('teclado', () => {
    const keys = (s: FakeSession) =>
      s.events.flatMap((e) =>
        e.kind === 'key' ? [[e.keysym, e.down] as const] : [],
      );

    it('typeText con replace: Ctrl+A antes del texto, para no concatenar', async () => {
      const { session, desktop } = setup(blank);
      await desktop.typeText('ñ1', { replace: true });
      const a = keysymFromChar('a');
      expect(keys(session)).toEqual([
        [keysyms.ControlLeft, true],
        [a, true],
        [a, false],
        [keysyms.ControlLeft, false],
        [keysymFromChar('ñ'), true],
        [keysymFromChar('ñ'), false],
        [keysymFromChar('1'), true],
        [keysymFromChar('1'), false],
      ]);
    });

    it('typeText sin replace no selecciona nada', async () => {
      const { session, desktop } = setup(blank);
      await desktop.typeText('x');
      expect(keys(session)).toEqual([
        [keysymFromChar('x'), true],
        [keysymFromChar('x'), false],
      ]);
    });

    it('pressKeys suelta los modificadores en orden inverso', async () => {
      const { session, desktop } = setup(blank);
      await desktop.pressKeys('ctrl+shift+tab');
      expect(keys(session)).toEqual([
        [keysyms.ControlLeft, true],
        [keysyms.ShiftLeft, true],
        [keysyms.Tab, true],
        [keysyms.Tab, false],
        [keysyms.ShiftLeft, false],
        [keysyms.ControlLeft, false],
      ]);
    });

    it('una combinación inválida no envía nada', async () => {
      const { session, desktop } = setup(blank);
      await expect(desktop.pressKeys('ctrl+nope')).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
      });
      expect(session.events).toHaveLength(0);
    });
  });

  describe('settle (ADR-0013)', () => {
    it('espera al cambio retrasado (~3,4 s) y se estabiliza pese al caret parpadeante', async () => {
      const { desktop } = setup((now) => {
        if (now < LAG) return blank();
        const blinkOn = Math.floor(now / 500) % 2 === 0;
        return makeFrame(W, H, blinkOn ? [textBlock, caret] : [textBlock]);
      });
      const before = await desktop.capture();
      const r = await desktop.settle(before);
      expect(r.changed).toBe(true);
      expect(r.stable).toBe(true);
      expect(r.waitedMs).toBeGreaterThanOrEqual(LAG + STABLE_MS);
      expect(r.waitedMs).toBeLessThan(LAG + STABLE_MS + 1_000);
      expect(r.frame.rgba[(textBlock.y * W + textBlock.x) * 4]).toBe(0); // el texto ya está
    });

    it('sin cambio: termina en changeWaitMs con changed=false y sin enviar eventos', async () => {
      const { session, desktop } = setup(blank);
      const r = await desktop.settle(await desktop.capture());
      expect(r).toMatchObject({ changed: false, stable: true });
      expect(r.waitedMs).toBeGreaterThanOrEqual(desktop.changeWaitMs);
      expect(r.waitedMs).toBeLessThan(desktop.changeWaitMs + 500);
      expect(session.events).toHaveLength(0);
    });

    it('pantalla que nunca se estabiliza: devuelve stable=false dentro del tope', async () => {
      const { desktop } = setup((now) =>
        makeFrame(W, H, [
          { ...textBlock, x: 10 + (Math.floor(now / 250) % 5) * 10 },
        ]),
      );
      const r = await desktop.settle(makeFrame(W, H));
      expect(r).toMatchObject({ changed: true, stable: false });
      expect(r.waitedMs).toBeLessThanOrEqual(
        desktop.changeWaitMs + STABLE_MAX_MS + 500,
      );
    });

    it('el coste de cada captura cuenta dentro de los plazos', async () => {
      const { session, desktop } = setup(blank, 400); // ~0,4 s por captura completa (spike)
      const r = await desktop.settle(await desktop.capture());
      expect(r.waitedMs).toBeLessThan(desktop.changeWaitMs + 1_000);
      expect(session.captures).toBeLessThan(15);
    });
  });

  describe('espera fija de cambio (ADR-0015)', () => {
    it('es de 8 s', () => {
      expect(setup(blank).desktop.changeWaitMs).toBe(CHANGE_WAIT_MS);
      expect(CHANGE_WAIT_MS).toBe(8_000);
    });

    it.each([800, 5_800, 7_500])(
      'detecta un cambio que llega a los %p ms (retrasos medidos: 0,8–5,8 s)',
      async (delay) => {
        const { desktop } = setup((now) =>
          now >= delay ? makeFrame(W, H, [textBlock]) : blank(),
        );
        const r = await desktop.settle(await desktop.capture());
        expect(r).toMatchObject({ changed: true, stable: true });
        expect(r.waitedMs).toBeGreaterThanOrEqual(delay + STABLE_MS);
      },
    );

    it('un cambio pasado el tope no se espera: changed=false sin enviar eventos', async () => {
      const { session, desktop } = setup((now) =>
        now >= 9_000 ? makeFrame(W, H, [textBlock]) : blank(),
      );
      const r = await desktop.settle(await desktop.capture());
      expect(r.changed).toBe(false);
      expect(r.waitedMs).toBeGreaterThanOrEqual(CHANGE_WAIT_MS);
      expect(r.waitedMs).toBeLessThan(CHANGE_WAIT_MS + 500);
      expect(session.events).toHaveLength(0);
    });
  });
});
