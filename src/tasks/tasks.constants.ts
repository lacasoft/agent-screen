/** Watchdog global por tarea (ADR-0006): a los 270 s se aborta y se corta el VNC. */
export const TASK_DEADLINE_MS = 270_000;
/** Tras abortar, cuánto se espera a que el ejecutor cierre VNC antes de persistir igualmente. */
export const EXECUTOR_GRACE_MS = 3_000;

export const RESUMEN_EN_CURSO = 'Ejecutando tarea.';
export const RESUMEN_TIEMPO_AGOTADO =
  'Tiempo agotado: se detuvo toda interacción con el escritorio antes del límite de 5 minutos.';
export const RESUMEN_ERROR_INTERNO =
  'La tarea falló por un error interno; se detuvo toda interacción con el escritorio.';
export const RESUMEN_INTERRUMPIDA =
  'Ejecución interrumpida por un reinicio del servicio; no se reanudó para evitar cambios duplicados.';

export const TASK_REPOSITORY = Symbol('TASK_REPOSITORY');
export const TASK_EXECUTOR = Symbol('TASK_EXECUTOR');
export const TASK_CLOCK = Symbol('TASK_CLOCK');
