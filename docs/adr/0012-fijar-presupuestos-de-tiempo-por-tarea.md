# ADR-0012: Fijar los presupuestos de tiempo de cada tarea

- Estado: Aceptado · estabilización y umbral de escrituras reemplazados por ADR-0013
- Fecha: 2026-10-31
- Decisores: equipo agent-screen

> Origen: `../system-design-agent-screen/design.md` (*Escala → presupuesto 270 s*, *Arquitectura → Flujo 7-8, 12*). Completa ADR-0006, que dejó «~20 s» como supuesto y el timeout del LLM sin valor.

## Contexto
- Límite oficial: 300 s por tarea; cualquier acción posterior cuenta como cambio ajeno.
- El watchdog corta a los 270 s (ADR-0006).
- Una escritura no está terminada hasta que se verifica (ADR-0007): estabilización (≥ 1,2 s entre dos capturas iguales; repintado de hasta 1 s) más, al menos, una llamada al LLM para leer la lista.
- Una llamada a un modelo multimodal grande con una captura tarda del orden de 5–20 s, con colas largas.
- Atributos en juego: fiabilidad (no actuar fuera de plazo) frente a eficacia (no abortar tareas viables).

## Decisión
Valores fijos, como constantes de código en un único módulo; no son variables de entorno. «Restante» se mide hasta el watchdog (270 s desde que se acepta la tarea).

| Parámetro | Valor | Regla |
|---|---|---|
| Watchdog | 270 s | Destruye el socket VNC; la tarea acaba `fallida` (ADR-0006) |
| Timeout por llamada al LLM | `min(25 s, restante − 5 s)` | Si sale < 5 s, no se llama: cierre `fallida` por tiempo |
| Reintento del LLM | 1 vez, solo ante 429/5xx/timeout de red, con backoff de 1 s ± jitter | Solo si sigue habiendo ≥ 10 s de timeout posible |
| Umbral del `Guard` para escrituras | **30 s restantes** | Menos de eso, se rechaza cualquier acción que confirme o guarde (25 s de una verificación con el LLM + 5 s de estabilización) |
| Conexión WSS + handshake RFB | 10 s | Un reintento solo si aún no se ha ejecutado ninguna acción |
| Pulsación de clic | 150 ms | Mayor que el mínimo de 100 ms |
| Estabilización | 2 capturas iguales separadas ≥ 1,2 s; espera máxima de 5 s | Pasados los 5 s se vuelve a observar, sin dar la escritura por hecha |
| Cierre VNC | `destroy()` con 2 s | El estado terminal se persiste igualmente |

## Alternativas consideradas
- ~20 s de umbral para escrituras (el supuesto del diseño): no cabe una verificación si el LLM tarda más de ~15 s, y quedaría una escritura sin verificar o una acción tardía.
- Timeouts configurables por env: abre la puerta a saltarse los límites del contrato por error de configuración.
- Sin timeout por llamada, confiando solo en el watchdog: una llamada colgada consume todo el plazo.

## Consecuencias
- Positivas: toda escritura deja tiempo para verificarla, y ninguna llamada puede pasar del watchdog.
- Negativas: las tareas que lleguen tarde a la escritura fallan aunque quizás habrían cabido. 25 s puede cortar respuestas lentas pero válidas.
- Revisar con las métricas de E1–E5: si el p95 de la llamada al LLM es menor de 10 s, bajar el timeout a 15 s y el umbral a 20 s.
