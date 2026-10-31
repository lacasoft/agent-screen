import { REDACTED, redactSecrets } from './redact';

describe('redactSecrets (ADR-0010)', () => {
  it('sustituye cada aparición de cada secreto', () => {
    expect(redactSecrets('pw=s3cret y otra s3cret', ['s3cret'])).toBe(
      `pw=${REDACTED} y otra ${REDACTED}`,
    );
  });

  it('tapa el prefijo de 8 caracteres de contraseñas largas (VNC solo usa 8)', () => {
    const pw = 'abcdefgh-largo';
    expect(redactSecrets(`entera ${pw} y prefijo abcdefgh`, [pw])).toBe(
      `entera ${REDACTED} y prefijo ${REDACTED}`,
    );
  });

  it('ignora secretos vacíos, indefinidos o de menos de 3 caracteres', () => {
    expect(redactSecrets('a ab abc', ['', undefined, 'ab'])).toBe('a ab abc');
  });

  it('un secreto que contiene a otro no deja restos', () => {
    expect(redactSecrets('token-largo-123', ['token-largo-123', 'largo'])).toBe(
      REDACTED,
    );
  });
});
