# ADR-0010: Redactor central de secretos y comparación del Bearer en tiempo constante

- Estado: Aceptado
- Fecha: 2026-10-31
- Decisores: equipo agent-screen (System Design)

> Origen: `../system-design-agent-screen/design.md` (*Arquitectura → Flujo 11*, *Decisiones*, *Revisión con IA, hallazgo 6*).

## Contexto
El resumen nunca debe incluir contraseñas ni secretos (criterio de aceptación 10). Cada solicitud trae la contraseña del escritorio, y todas las rutas salvo `GET /health` (abierta) exigen Bearer.

## Decisión
- Un redactor central sustituye por `***` la contraseña y el token en logs y en el `resumen`.
- No se loguea el body ni la URL completa del escritorio.
- Las credenciales viven solo en memoria durante la tarea.
- El Bearer se compara en tiempo constante.

## Alternativas consideradas
- Confiar en no loguear por descuido.

## Consecuencias
- Positivas: elimina una causa de suspenso y una fuga.
- Negativas: ninguna relevante.
