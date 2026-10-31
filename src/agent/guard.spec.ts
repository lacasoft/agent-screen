import type { AgentAction } from '../llm/actions';
import { checkAction, type GuardContext } from './guard';

const ctx = (over: Partial<GuardContext> = {}): GuardContext => ({
  instruction:
    'Registra al cliente Papelería Los Andes, NIT 901234567, ciudad Pereira.',
  remainingMs: 200_000,
  commits: [],
  ...over,
});
const click = (
  over: Partial<Extract<AgentAction, { type: 'click' }>> = {},
): AgentAction => ({
  type: 'click',
  x: 1,
  y: 1,
  button: 'left',
  double: false,
  intent: 'navegar',
  reason: 'abrir menú',
  ...over,
});

describe('Guard', () => {
  it('permite navegar, escribir, scroll y wait', () => {
    expect(checkAction(click(), ctx()).allowed).toBe(true);
    expect(
      checkAction(
        { type: 'type', text: 'x', replace: true, reason: 'r' },
        ctx(),
      ).allowed,
    ).toBe(true);
    expect(
      checkAction({ type: 'wait', ms: 500, reason: 'r' }, ctx()).allowed,
    ).toBe(true);
  });

  describe('acciones destructivas (ADR-0008)', () => {
    it('bloquea eliminar si la instrucción no lo pide', () => {
      expect(
        checkAction(
          click({ intent: 'eliminar', reason: 'quitar duplicado' }),
          ctx(),
        ),
      ).toMatchObject({
        allowed: false,
      });
    });

    it('bloquea aunque el modelo la etiquete como navegar (lo delata el reason)', () => {
      expect(
        checkAction(
          click({ intent: 'navegar', reason: 'clic en el botón Eliminar' }),
          ctx(),
        ).allowed,
      ).toBe(false);
      expect(
        checkAction(
          click({
            intent: 'confirmar',
            registro: 'nuevo',
            reason: 'anular la factura',
          }),
          ctx(),
        ).allowed,
      ).toBe(false);
    });

    it('no confunde filtrar por un estado "Anulada" con anular', () => {
      expect(
        checkAction(click({ reason: 'filtrar por estado Anulada' }), ctx())
          .allowed,
      ).toBe(true);
    });

    it.each([
      'Elimina el cliente CL-0099.',
      'Anula la factura FV-10159.',
      'Da de baja al proveedor X.',
    ])('permite eliminar si la instrucción lo pide: %s', (instruction) => {
      const del = click({
        intent: 'eliminar',
        coincidencias: 1,
        reason: 'eliminar',
      });
      expect(checkAction(del, ctx({ instruction })).allowed).toBe(true);
      // Borrar también exige identificación única (homónimos, ADR-0009).
      const ambiguous = click({
        intent: 'eliminar',
        coincidencias: 2,
        reason: 'eliminar',
      });
      expect(checkAction(ambiguous, ctx({ instruction })).allowed).toBe(false);
    });
  });

  describe('plazo de escrituras (ADR-0013)', () => {
    it('bloquea confirmar y exportar con < 40 s restantes', () => {
      const late = ctx({ remainingMs: 39_999 });
      expect(
        checkAction(
          click({ intent: 'confirmar', registro: 'nuevo', reason: 'guardar' }),
          late,
        ).allowed,
      ).toBe(false);
      expect(
        checkAction(click({ intent: 'exportar', reason: 'exportar' }), late)
          .allowed,
      ).toBe(false);
      expect(checkAction(click({ intent: 'navegar' }), late).allowed).toBe(
        true,
      );
    });

    it('permite con 40 s justos', () => {
      expect(
        checkAction(
          click({ intent: 'confirmar', registro: 'nuevo', reason: 'guardar' }),
          ctx({ remainingMs: 40_000 }),
        ).allowed,
      ).toBe(true);
    });
  });

  describe('homónimos (ADR-0009)', () => {
    const edit = (coincidencias?: number) =>
      click({
        intent: 'confirmar',
        registro: 'existente',
        coincidencias,
        reason: 'guardar',
      });

    it('editar un existente exige exactamente 1 coincidencia', () => {
      expect(checkAction(edit(1), ctx())).toEqual({
        allowed: true,
        commit: { kind: 'editar', reintento: false },
      });
      expect(checkAction(edit(2), ctx())).toMatchObject({
        allowed: false,
        reason: expect.stringContaining('2 registros'),
      });
      expect(checkAction(edit(0), ctx()).allowed).toBe(false);
      expect(checkAction(edit(undefined), ctx()).allowed).toBe(false);
    });

    it('confirmar sin decir si el registro es nuevo o existente se bloquea', () => {
      expect(
        checkAction(click({ intent: 'confirmar', reason: 'guardar' }), ctx())
          .allowed,
      ).toBe(false);
    });
  });

  describe('sin reintentos ciegos (ADR-0007)', () => {
    const create = (reintento?: boolean) =>
      click({
        intent: 'confirmar',
        registro: 'nuevo',
        reintento,
        reason: 'guardar',
      });

    it('la primera alta se permite y se registra', () => {
      expect(checkAction(create(), ctx())).toEqual({
        allowed: true,
        commit: { kind: 'crear', reintento: false },
      });
    });

    it('una segunda alta exige reintento=true, y solo una vez', () => {
      const once = ctx({ commits: [{ kind: 'crear', reintento: false }] });
      expect(checkAction(create(), once).allowed).toBe(false);
      expect(checkAction(create(true), once)).toEqual({
        allowed: true,
        commit: { kind: 'crear', reintento: true },
      });
      const twice = ctx({
        commits: [
          { kind: 'crear', reintento: false },
          { kind: 'crear', reintento: true },
        ],
      });
      expect(checkAction(create(true), twice).allowed).toBe(false);
    });

    it('lo mismo para exportar', () => {
      const exp = click({ intent: 'exportar', reason: 'exportar reporte' });
      expect(
        checkAction(
          exp,
          ctx({ commits: [{ kind: 'exportar', reintento: false }] }),
        ).allowed,
      ).toBe(false);
    });
  });

  describe('formato del resumen', () => {
    it('finish admite una línea respuesta (con dos datos separados por ;)', () => {
      expect(
        checkAction(
          { type: 'finish', resumen: 'Consultado.\nrespuesta: 45; 12' },
          ctx(),
        ).allowed,
      ).toBe(true);
      expect(
        checkAction(
          { type: 'finish', resumen: 'respuesta: 45\nrespuesta: 12' },
          ctx(),
        ).allowed,
      ).toBe(false);
    });

    it('fail no lleva línea respuesta', () => {
      expect(
        checkAction(
          { type: 'fail', resumen: 'Dos clientes: 52345678 y 1019876543' },
          ctx(),
        ).allowed,
      ).toBe(true);
      expect(
        checkAction(
          { type: 'fail', resumen: 'No encontrado.\nrespuesta: 0' },
          ctx(),
        ).allowed,
      ).toBe(false);
    });
  });
});

describe('Guard: nada de suposiciones en finish (falso éxito de E3)', () => {
  const finish = (resumen: string) =>
    checkAction({ type: 'finish', resumen }, ctx());

  it.each([
    'respuesta: 51\nLas páginas 1 y 2 no las conté: asumo 20 filas cada una.',
    'respuesta: 45\nSupongo que no hay más páginas.',
    'respuesta: 40\nTotal aproximado según la barra.',
    'respuesta: 12\nProbablemente sean 12.',
    'respuesta: 30\nDebería haber 30 por página.',
    'respuesta: 20\nHay unos 20 registros.',
  ])('bloquea: %s', (resumen) => {
    expect(finish(resumen)).toMatchObject({
      allowed: false,
      reason: expect.stringContaining('suposición'),
    });
  });

  it.each([
    'respuesta: 45\nFiltro Cliente = Ferretería Ruiz y Estado = Vencida; el contador muestra 45.',
    'respuesta: 45\nTres páginas: 20 + 20 + 5 filas, todas vistas.',
    'Cliente creado y verificado en la lista con NIT 901234567.',
  ])('permite: %s', (resumen) => {
    expect(finish(resumen).allowed).toBe(true);
  });

  it('no aplica a fail (explicar lo que no se pudo verificar es correcto)', () => {
    expect(
      checkAction(
        { type: 'fail', resumen: 'No pude contar: asumo que hay más páginas.' },
        ctx(),
      ).allowed,
    ).toBe(true);
  });
});
