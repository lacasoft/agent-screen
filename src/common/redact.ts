export const REDACTED = '***';

/** Longitud efectiva de una contraseña VNC: la autenticación DES solo usa 8 caracteres. */
const VNC_PASSWORD_PREFIX = 8;
/** Secretos más cortos no se buscan: reemplazarlos destrozaría el texto. */
const MIN_SECRET_LENGTH = 3;

/**
 * Redactor central (ADR-0010): sustituye cada secreto por `***` en texto que sale del servicio
 * (resumen, logs). Para contraseñas largas también tapa su prefijo de 8 caracteres, que basta
 * para autenticarse por VNC.
 */
export function redactSecrets(
  text: string,
  secrets: readonly (string | undefined)[],
): string {
  const needles = new Set<string>();
  for (const secret of secrets) {
    if (!secret || secret.length < MIN_SECRET_LENGTH) continue;
    needles.add(secret);
    if (secret.length > VNC_PASSWORD_PREFIX) {
      needles.add(secret.slice(0, VNC_PASSWORD_PREFIX));
    }
  }
  let out = text;
  // Los más largos primero, para no dejar restos de un secreto que contiene a otro.
  for (const needle of [...needles].sort((a, b) => b.length - a.length)) {
    out = out.split(needle).join(REDACTED);
  }
  return out;
}
