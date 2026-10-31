/** Reloj inyectable: permite probar esperas y plazos con tiempo virtual. */
export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => performance.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Reloj de pared (Date.now): el que usan los plazos de tarea (deadlineAt). */
export const wallClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};
