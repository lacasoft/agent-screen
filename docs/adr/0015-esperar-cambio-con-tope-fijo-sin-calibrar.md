# ADR-0015: Esperar el cambio de pantalla con un tope fijo de 8 s, sin calibrar

- Estado: Aceptado
- Fecha: 2026-10-31
- Decisores: equipo agent-screen

> Reemplaza la calibración por sesión de ADR-0013 (puntos 2 y 3: medir el `lag` al conectar y esperar `clamp(1,5 × lag + 0,5 s, 1,5 s, 8 s)`). El resto de ADR-0013 sigue vigente: definición de cambio significativo (> 50 px y caja ≥ 3×3), 1,2 s de estabilidad, sin cambio no es fallo, y umbral de 40 s para escrituras.

## Contexto
Seis mediciones del retraso de pantalla tras una acción, en el escritorio de práctica (2026-10-31): 3,4 · 3,4 · 5,4 · 5,8 · 0,8 · 5,3 s. El retraso no es una latencia fija sino variable: a veces la pantalla se congela varios segundos y luego se pone al día. Una medición al empezar la tarea no predice la siguiente acción. Con una calibración de 0,8 s el agente esperaría solo 1,7 s y tomaría por «sin cambio» acciones que sí tuvieron efecto, con riesgo de repetir escrituras (ADR-0007).

En la ejecución de E3 en vivo, el agente no calibraba (usaba el valor por defecto, 5,75 s de espera) y resolvió la tarea: la espera solo se paga entera cuando la acción no cambia la pantalla.

## Decisión
- Tras cada acción, esperar hasta **8 s** (`CHANGE_WAIT_MS`) a que aparezca un cambio significativo; en cuanto aparece, se pasa a la fase de estabilidad (1,2 s sin cambios significativos, máx. 5 s).
- Se elimina `VncDesktop.calibrate()` y el estado de `lag`.

## Alternativas consideradas
- Calibrar por sesión (ADR-0013): no predice un retraso que varía en cada acción.
- Recalibrar en cada acción: no es posible sin una acción de prueba extra por paso.
- Tope menor (p. ej. 6 s): se queda corto frente al máximo medido (5,8 s) sin margen.

## Consecuencias
- Positivas: una regla simple y conservadora; no confunde un retraso largo con «sin efecto».
- Negativas: las acciones que no cambian la pantalla cuestan 8 s (antes 5,75 s). Se mitiga con el prompt (no navegar sin motivo) y agrupando acciones seguras.
- Revisar si la app de evaluación muestra retrasos > 8 s o mucho menores de forma sistemática.
