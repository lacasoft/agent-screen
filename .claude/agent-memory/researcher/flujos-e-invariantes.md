# Flujos e invariantes (verificado contra el código el 2026-10-31, commit 12e2b5a)

## Flujo de una tarea
1. `POST /tasks` → `TasksController` (200, no 201: `src/tasks/tasks.controller.ts:23`) → `TasksService.create`: lease por huella del escritorio; si está ocupado, 409 `DESKTOP_BUSY` (`src/tasks/tasks.service.ts:47`). Inserta `en_curso` y llama a `TaskRunner.start` sin esperar.
2. `TaskRunner.run`: watchdog de 270 s (`src/tasks/tasks.constants.ts:2`) → aborta la señal → 3 s de margen (`:4`) → persiste igualmente. Orden fijo: persistir (`src/tasks/task-runner.ts:122`) **antes** de liberar el lease (`:126`). Redacta el resumen.
3. Ejecutor real: `TASK_EXECUTOR` → `ScreenAgent` (`src/agent/agent.module.ts:12`), importado por `TasksModule` (`src/tasks/tasks.module.ts:14`).
4. `ScreenAgent.run`: captura → `llm.chat` → `parseToolCall` (forma) → `checkAction` (política) → `perform` → `desktop.settle` → nueva captura. Ante el abort, `destroy()` inmediato (`src/agent/screen-agent.ts:100`), y antes de cada acción se vuelve a comprobar la señal (`:226`).
5. Arranque: todo lo que esté `en_curso` pasa a `fallida` sin reanudarse (`src/tasks/tasks.service.ts:38`).

## Invariantes con cita
- `/health` es abierto (`src/health/health.controller.ts:7`); el resto exige Bearer, comparado con SHA-256 + `timingSafeEqual` (`src/common/bearer-auth.guard.ts:39`).
- El redactor también tapa el prefijo de 8 caracteres de la contraseña, porque VNC (DES) solo usa 8 (`src/common/redact.ts:4`).
- El Guard bloquea escrituras con < 40 s restantes (`src/agent/agent.constants.ts:2`), editar o borrar con `coincidencias !== 1` (`src/agent/guard.ts:99`), un segundo reintento (`:122`), destructivas no pedidas (`:21`) y `finish` con marcas de suposición (`:28`).
- Espera de cambio fija de 8 s (`src/vnc/vnc.constants.ts:25`); cambio significativo > 50 px y caja ≥ 3×3 (`:28`).
- Una captura solo cuenta si la update trae rects `pixels`/`copy` (`src/vnc/rfb2-session.ts:136`).
- OpenRouter con `tool_choice: 'auto'` (`src/llm/openrouter.client.ts:154`); timeout de cada llamada `min(25 s, restante − 5 s)` (`:31`). El sistema lleva `cache_control` (`src/agent/conversation.ts:31`).
- Las notas del modelo se acumulan (`src/agent/screen-agent.ts:194`); el aviso de repetición solo salta si no hubo notas nuevas en la racha (`:245`).
- Con `NODE_ENV=test` no se lee `.env` (`src/app.module.ts:17`).
