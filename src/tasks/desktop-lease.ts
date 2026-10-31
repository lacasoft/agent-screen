import { createHash } from 'node:crypto';

/**
 * Huella del escritorio: SHA-256 de protocolo + host + ruta (sin credenciales, query ni fragmento).
 * Nunca se loguea la URL completa (ADR-0010).
 */
export function desktopKeyOf(url: string): string {
  const u = new URL(url);
  const normalized = `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, '')}`;
  return createHash('sha256').update(normalized).digest('hex');
}

/** Exclusividad por escritorio en memoria: una sola instancia (ADR-0005). */
export class DesktopLeases {
  private readonly holders = new Map<string, string>();

  /** true si se adquirió; false si el escritorio ya tiene una tarea activa. */
  tryAcquire(desktopKey: string, taskId: string): boolean {
    if (this.holders.has(desktopKey)) return false;
    this.holders.set(desktopKey, taskId);
    return true;
  }

  /** Solo libera quien lo tiene. */
  release(desktopKey: string, taskId: string): void {
    if (this.holders.get(desktopKey) === taskId)
      this.holders.delete(desktopKey);
  }

  holderOf(desktopKey: string): string | undefined {
    return this.holders.get(desktopKey);
  }
}
