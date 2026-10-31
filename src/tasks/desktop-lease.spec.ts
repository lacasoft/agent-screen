import { DesktopLeases, desktopKeyOf } from './desktop-lease';

describe('desktopKeyOf', () => {
  it('normaliza host y barra final, e ignora credenciales, query y fragmento', () => {
    const k = desktopKeyOf('wss://Desk.Example/websockify');
    expect(desktopKeyOf('wss://desk.example/websockify/')).toBe(k);
    expect(desktopKeyOf('wss://u:p@desk.example/websockify?x=1#y')).toBe(k);
    expect(k).toMatch(/^[0-9a-f]{64}$/);
  });

  it('distingue escritorios distintos', () => {
    expect(desktopKeyOf('wss://a.example/websockify')).not.toBe(
      desktopKeyOf('wss://b.example/websockify'),
    );
  });
});

describe('DesktopLeases (ADR-0005)', () => {
  it('una sola tarea activa por escritorio', () => {
    const leases = new DesktopLeases();
    expect(leases.tryAcquire('k', 't1')).toBe(true);
    expect(leases.tryAcquire('k', 't2')).toBe(false);
    expect(leases.tryAcquire('otro', 't2')).toBe(true);
  });

  it('solo libera quien lo tiene', () => {
    const leases = new DesktopLeases();
    leases.tryAcquire('k', 't1');
    leases.release('k', 't2');
    expect(leases.holderOf('k')).toBe('t1');
    leases.release('k', 't1');
    expect(leases.tryAcquire('k', 't2')).toBe(true);
  });
});
