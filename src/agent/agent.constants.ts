/** Escrituras (confirmar/exportar) solo con al menos 40 s restantes (ADR-0013). */
export const WRITE_MIN_REMAINING_MS = 40_000;
/** Tope de pasos (el plazo suele cortar antes: cada paso cuesta 5–15 s). */
export const MAX_STEPS = 60;
/** Respuestas inválidas seguidas (sin herramienta, mal formadas) antes de rendirse. */
export const MAX_INVALID_IN_A_ROW = 3;
/** Bloqueos del Guard seguidos antes de rendirse. */
export const MAX_BLOCKED_IN_A_ROW = 4;
/** Capturas que se mantienen en la conversación (las anteriores se sustituyen por texto). */
export const MAX_IMAGES_IN_CONTEXT = 1;

export const AGENT_CLOCK = Symbol('AGENT_CLOCK');
