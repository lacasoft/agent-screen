# ADR-0004: Ejecutar tareas en segundo plano con un worker cancelable

- Estado: Aceptado
- Fecha: 2026-10-31
- Decisores: equipo agent-screen (System Design)

> Origen: `../system-design-agent-screen/design.md` (*Requisitos no funcionales*, *Decisiones*, *Arquitectura → Flujo 1-2, 12*).

## Contexto
`POST /tasks` debe responder `{"task_id":"…"}` en < 2 s; cada tarea dura hasta 5 min, y el evaluador consulta `GET /tasks/{id}` cada 5 s.

## Decisión
La API valida, registra la tarea `en_curso` y devuelve el `task_id`; un gestor lanza un worker cancelable. El worker cierra VNC **antes** de persistir el estado terminal. Al reiniciar el proceso, las tareas que quedaron `en_curso` se marcan `fallida` sin reanudar escrituras.

## Alternativas consideradas
- Resolver dentro de `POST /tasks`: incumple los 2 s y no permite controlar el plazo.

## Consecuencias
- Positivas: cumple el contrato y permite cancelar.
- Negativas: requiere estado compartido entre la API y el worker (SQLite en volumen Docker, ver ADR-0011).
