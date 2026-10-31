# ADR-0013: Estabilizar la pantalla ignorando cambios mínimos y calibrando la latencia

- Estado: Aceptado
- Fecha: 2026-10-31
- Decisores: equipo agent-screen

> Reemplaza la regla de estabilización de ADR-0007 («dos capturas iguales separadas ≥ 1,2 s») y los valores de estabilización y umbral de escrituras de ADR-0012. El resto de ambos sigue vigente.

## Contexto
Spike de `rfb2` contra el escritorio de práctica (2026-10-31, `spikes/rfb2-spike.mjs`):
- La pantalla tarda **~3,4 s** en reflejar una acción (3419 y 3397 ms en dos muestras), no el «hasta 1 s» del brief. Una captura anterior a ese plazo muestra el estado viejo, que es el riesgo de duplicado de ADR-0007.
- El caret de texto parpadea (1×13 px, cada ~0,4–0,8 s) y el puntero va dibujado en el framebuffer. Dos capturas completas **nunca** son idénticas con un campo enfocado: la regla de ADR-0007 no se cumple.
- Cada captura completa (update no incremental, ZRLE) cuesta ~0,4 s.
- La app de evaluación y su escritorio pueden tener otra latencia.

## Decisión
1. **Cambio significativo**: una diferencia entre capturas cuenta si afecta a > 50 px **y** su caja mide > 2 px de ancho **y** de alto. Se ignoran el caret y los parpadeos finos.
2. **Calibración por sesión**: al conectar, antes de la primera acción, el agente mueve el puntero a una esquina neutra y mide cuánto tarda el framebuffer en mostrarlo. Ese es el `lag`. Si la calibración no da resultado en 8 s, se usa `lag = 3,5 s`.
3. **Espera tras cada acción**: hasta `clamp(1,5 × lag + 0,5 s, 1,5 s, 8 s)` a que aparezca un cambio significativo. Después hace falta **1,2 s sin cambios significativos** para dar la pantalla por estable.
4. **Sin cambio dentro de la espera**: no es «fallo» ni da pie a repetir. Se vuelve a observar, y en escrituras se aplica ADR-0007 (buscar el registro antes de cualquier reintento).
5. **Umbral del `Guard` para escrituras**: **40 s restantes**, en lugar de 30. La verificación necesita la espera de cambio (≤ 8 s), la estabilización (1,2 s) y una llamada al LLM (≤ 25 s), con margen.

## Alternativas consideradas
- Mantener «dos capturas idénticas»: nunca se cumple con el caret.
- Espera fija de 1 s (el brief): se ve el estado viejo y se reintentan escrituras.
- Espera fija de 6 s sin calibrar: desperdicia tiempo en escritorios rápidos y se queda corta en otros más lentos.
- Comparar solo la zona de la acción: el efecto de un clic puede aparecer en cualquier parte (diálogos, listas).

## Consecuencias
- Positivas: no se confunde la pantalla vieja con un fallo, se tolera el caret y la espera se adapta a cada escritorio.
- Negativas: con un `lag` de ~3,4 s, cada paso cuesta ≥ 5–6 s más la inferencia, lo que da del orden de 30 pasos en 270 s. Esto obliga a agrupar acciones (p. ej. varios campos antes de observar) cuando sea seguro. La calibración consume ~4 s por tarea.
- Revisar si las updates incrementales (más baratas que la captura completa de ~0,4 s) cambian las mediciones, o si la latencia de evaluación es muy distinta.
