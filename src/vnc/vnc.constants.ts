// Tiempos y umbrales del adaptador VNC. Son constantes de código, no env (ADR-0012, ADR-0013).

/** Pulsación del clic: el escritorio ignora clics de menos de 100 ms. */
export const CLICK_PRESS_MS = 150;
/** Pausa tras mover el puntero antes de pulsar. */
export const POINTER_SETTLE_MS = 50;
/** Pausa entre pulsar y soltar una tecla, y entre teclas. */
export const KEY_TAP_MS = 30;

/** Conexión WSS + handshake RFB (ADR-0012). */
export const CONNECT_TIMEOUT_MS = 10_000;
/** `close()` ordenado antes de `destroy()` (ADR-0006). */
export const CLOSE_TIMEOUT_MS = 2_000;
/** Máximo para recibir una update con píxeles. */
export const FRAME_TIMEOUT_MS = 5_000;

/** Intervalo entre capturas mientras se espera un cambio o estabilidad. */
export const POLL_MS = 250;
/** Tiempo sin cambios significativos para dar la pantalla por estable (ADR-0013). */
export const STABLE_MS = 1_200;
/** Máximo de la fase de estabilización, tras el primer cambio. */
export const STABLE_MAX_MS = 5_000;

/** Espera máxima de un cambio significativo tras una acción: retraso medido 0,8–5,8 s (ADR-0015). */
export const CHANGE_WAIT_MS = 8_000;

/** Cambio significativo: más de N píxeles y caja con ambos lados > 2 px (ADR-0013). */
export const SIGNIFICANT_MIN_PIXELS = 50;
export const SIGNIFICANT_MIN_SIDE_PX = 3;
