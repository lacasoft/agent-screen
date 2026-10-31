---
paths:
  - 'src/**'
  - 'test/**'
  - 'spikes/**'
---

# agent-screen — mapa del código y trampas medidas

Se carga solo al tocar código. Lo general (contratos, invariantes, ADRs) está en `CLAUDE.project.md`.

## Módulos (`src/`)

- `tasks/`: `POST/GET /tasks`. `TasksService` (lease por escritorio → 409), `TaskRunner` (watchdog 270 s, margen 3 s, redacción; orden fijo: ejecutor termina → persistir → liberar lease), `TaskRepository` → `sqlite/` (`node:sqlite`, WAL, migraciones con `PRAGMA user_version`). Puerto `TaskExecutor` (token `TASK_EXECUTOR`) → `ScreenAgent`.
- `agent/`: `ScreenAgent` (observar → LLM → `parseToolCall` → `Guard` → VNC → `settle`). `guard.ts` es política pura: destructivas no pedidas (por `intent` o `reason`), escrituras con < 40 s, `coincidencias = 1` al editar o borrar, un único `reintento` explícito, una línea `respuesta:` y nada de suposiciones en `finish`. `prompt.ts` es genérico: nada de SIGECOM, menús ni valores de E1–E5. `conversation.ts`: últimos 10 turnos completos, los anteriores en una línea, solo la última captura y punto de caché en el sistema. Las `nota` del modelo (máx. 30) se muestran en cada turno.
- `llm/`: puerto `LlmClient` (token `LLM_CLIENT`) → `OpenRouterClient` (fetch nativo; timeout `min(25 s, restante − 5 s)`; 1 reintento ante 429/5xx/red; respaldo por `models`). `actions.ts`: 7 herramientas con JSON Schema cerrado + `parseToolCall`, que valida la forma, no la política.
- `vnc/`: `VncConnector` → `VncDesktop` (click 150 ms, type con `replace` = Ctrl+A, keys, scroll, `settle`) sobre `RfbSession` (`rfb2-session.ts`, el único que toca la red). `frame.ts`: cambio significativo (> 50 px y caja ≥ 3×3). `png.ts`: codificador propio con `node:zlib`.
- `common/`: `BearerAuthGuard` (global; `@Public()` solo en `/health`), `ApiExceptionFilter` (`{code, message, details?}`), `createValidationPipe` (sin devolver valores), `redactSecrets`, `Clock` (`systemClock` para medir; `wallClock` para plazos con `Date.now`).
- `config/`: esquema Joi del env (Standard Schema de `@nestjs/config` 12). `health/`: `GET /health`.

## Tests

- Unit junto al código (`*.spec.ts`), London: `vnc/testing/fakes.ts` (`FakeClock`, `FakeSession`, `makeFrame`) para tiempo virtual y pantalla falsa; LLM guionizado en `agent/screen-agent.spec.ts`.
- E2E (`test/*.e2e-spec.ts`): app completa, SQLite `:memory:` y ejecutor controlable; env en `test/e2e-env.ts`.
- Live (`npm run test:live`): escritorio real (solo lectura) + 1 llamada LLM (~0,005 créditos). Lee `.env` con `test/live-env.ts`, porque Jest da a cada test una copia de `process.env`.
- `spikes/run-task.mjs "<instrucción>" <puerto>` ejecuta una tarea como el evaluador; `spikes/rfb2-spike.mjs reset` hace `POST /__reset`.

## Trampas medidas (no volver a descubrirlas)

- **Escritorio de práctica:** retraso de pantalla variable de 0,8 a 5,8 s (ADR-0015). La 1.ª update puede traer solo `extendedDesktopSize` (hay que esperar rects `pixels`/`copy`). El cursor va dibujado en el framebuffer. El caret parpadea (1×13 px). La autenticación VNC (DES) solo usa los **8 primeros caracteres** de la contraseña, y por eso el redactor tapa también ese prefijo. La fecha de la app está en la cabecera («Hoy: dd/mm/aaaa»).
- **OpenRouter:** con `provider.require_parameters: true` descarta proveedores que no admitan TODO lo enviado (404 «No endpoints found»). Con `claude-sonnet-5.5` no envíes `temperature`, `parallel_tool_calls` ni `tool_choice: "required"`; usa `"auto"`. Consulta `supported_parameters` en `/api/v1/models`.
- **Agente:** sin `nota` el modelo supone cifras (falso éxito en E3) o entra en bucle de paginación. El filtro de E3 «Ruiz» también trae «Ruiz e Hijos».
- **Node/Jest:** Nest 12 es solo ESM; Jest exige Node ≥ 24.9 (`require(esm)`). `rfb2` también es solo ESM y se carga igual desde el CJS compilado.
- **WSL:** `mkdirSync` recursivo sobre `/proc` se cuelga, en lugar de fallar (usa un directorio de solo lectura para probar `EACCES`). `pkill -f <patrón>` puede matar tu propia shell si el patrón aparece en el comando.
- **Prettier** reformatea tras cada cambio: no edites con fragmentos copiados de una versión anterior del archivo.
