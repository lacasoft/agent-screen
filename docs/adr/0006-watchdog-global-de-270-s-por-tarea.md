# ADR-0006: Watchdog global de 270 s que destruye el socket VNC

- Estado: Aceptado
- Fecha: 2026-10-31
- Decisores: equipo agent-screen (System Design)

> Origen: `../system-design-agent-screen/design.md` (*Arquitectura → Flujo 7*, *Decisiones*, *Revisión con IA, hallazgos 1-2*).

## Contexto
Límite oficial de 5 min; cualquier acción posterior cuenta como cambio ajeno. Una llamada al LLM o una acción VNC colgadas pueden superar el límite si solo se confía en el bucle del agente.

## Decisión
- Un watchdog por tarea destruye el socket VNC a los **270 s** pase lo que pase, y la tarea termina `fallida` por tiempo agotado.
- Cada llamada al LLM lleva un `AbortSignal` con timeout = min(fijo, restante − margen).
- El `Guard` rechaza escrituras con menos de ~20 s restantes (supuesto).
- El cierre VNC usa `destroy()` con timeout de 2 s, y el estado terminal se persiste igualmente.

## Alternativas consideradas
- Confiar solo en el bucle del agente para parar: no garantiza el corte.

## Consecuencias
- Positivas: ninguna acción después del límite; el evaluador nunca queda viendo `en_curso`.
- Negativas: puede abortar tareas casi terminadas; la sesión VNC puede quedar mal cerrada.
