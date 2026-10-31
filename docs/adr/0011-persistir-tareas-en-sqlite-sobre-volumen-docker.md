# ADR-0011: Persistir el estado de las tareas en SQLite sobre un volumen Docker

- Estado: Aceptado · driver reemplazado por ADR-0014 (`node:sqlite`)
- Fecha: 2026-10-31
- Decisores: equipo agent-screen

> Origen: `../system-design-agent-screen/design.md` (*Arquitectura → Persistencia propuesta*, *Fallas → caída del proceso*).

## Contexto
- El servicio corre en Docker, en una sola instancia.
- El estado que hay que guardar es mínimo: una fila `Task` por tarea (`task_id`, `estado`, `resumen` y plazos), con unas pocas escrituras por tarea y lecturas cada 5 s por parte del evaluador.
- El estado debe sobrevivir a un reinicio del contenedor: si no, `GET /tasks/{id}` daría 404 y se perdería la marca `fallida` de las tareas interrumpidas.
- Credenciales y capturas **no** se persisten (ADR-0010).
- Atributos en juego: fiabilidad (recuperabilidad) y mantenibilidad.

## Decisión
- **SQLite** en un fichero sobre un **volumen nombrado de Docker** (`/data/agent-screen.db`, ruta en `DATABASE_PATH`), en modo **WAL** con `busy_timeout`.
- Driver **`better-sqlite3`**: síncrono, sin servidor, con binarios precompilados para Node ≥ 22. Va detrás de un puerto `TaskRepository` en `src/tasks/`, para poder cambiar el almacenamiento sin tocar los casos de uso.
- Migraciones SQL versionadas y reversibles (`up`/`down`), controladas con `PRAGMA user_version`. Se aplican al arrancar, lo cual es seguro porque hay una sola instancia.
- Al arrancar, toda tarea `en_curso` se marca `fallida` («ejecución interrumpida por reinicio») y no se reanuda.
- El `DesktopLease` vive en memoria, no en la BD (ADR-0005).

## Alternativas consideradas
- **Solo en memoria**: lo más simple, pero un reinicio pierde las tareas y el evaluador vería 404.
- **PostgreSQL** (u otra BD en contenedor aparte): un servicio más que operar y vigilar, sin beneficio con una sola instancia y una tabla.
- **Redis + BullMQ** (sugerido por el kit): la cola no aporta nada, porque el worker corre en el mismo proceso y no se reintentan tareas (no reanudar escrituras).
- **TypeORM sobre SQLite**: alinea con el playbook del kit, pero añade un ORM y riesgo de compatibilidad ESM con Nest 12 para una única tabla.
- **`node:sqlite`** (integrado en Node): evita la dependencia nativa, pero aún no es estable.

## Consecuencias
- Positivas: cero servicios extra; sobrevive a reinicios; latencia de lectura despreciable.
- Negativas: `better-sqlite3` es nativo, así que la imagen tiene que ser glibc (`node:24-slim`, no Alpine sin toolchain). Escala solo verticalmente, y el fichero se pierde si se borra el volumen.
- Revisar si hacen falta varias réplicas o varias instancias del servicio: entonces PostgreSQL y lease compartido.
