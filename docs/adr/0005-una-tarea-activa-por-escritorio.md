# ADR-0005: Una sola tarea activa por escritorio

- Estado: Aceptado
- Fecha: 2026-10-31
- Decisores: equipo agent-screen (System Design)

> Origen: `../system-design-agent-screen/design.md` (*Escala → supuestos*, *API y modelo de datos → DesktopLease*, *Decisiones*).

## Contexto
Dos tareas sobre el mismo framebuffer se interfieren y producen cambios ajenos, que cuentan como acción destructiva.

## Decisión
Exclusividad por escritorio mediante `DesktopLease {desktop_key, task_id, expires_at}`. La `desktop_key` no expone la contraseña y no aparece en logs.

## Alternativas consideradas
- Varias tareas sobre el mismo escritorio: interferencia.

## Consecuencias
- Positivas: aislamiento.
- Negativas: limita el throughput (techo ≈ 12 tareas/h por escritorio). Un `POST /tasks` sobre un escritorio con tarea activa responde **409 Conflict** (`{code: "DESKTOP_BUSY", message}`) sin crear tarea.
- Con una sola instancia el lease vive en memoria (un `Map` en el proceso); al reiniciar no queda ninguno activo, porque las tareas `en_curso` pasan a `fallida`. Si algún día hay varias réplicas, el lease tiene que pasar a almacenamiento compartido.
