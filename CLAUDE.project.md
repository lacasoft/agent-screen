# agent-screen — Definición para Claude

> Diseño de origen: `../system-design-agent-screen/design.md` (actualizado 2026-10-31). Brief: `../system-design-agent-screen/brief.md`. Decisiones en `docs/adr/`.

## Visión del producto

Agente que recibe tareas en lenguaje natural y opera aplicaciones legacy **desconocidas** (sin API ni documentación) observando y actuando **solo** sobre un escritorio remoto VNC/RFB (`wss://…/websockify`). Crea y modifica registros, consulta datos y exporta reportes. Rechaza como `fallida` lo ambiguo, imposible o peligroso. La práctica es sobre SIGECOM; la evaluación usa **otra app nunca vista**.
**Fuera de alcance (v1):** DOM, BD, endpoints internos o JS inyectado de la app; flujos, coordenadas o valores codificados para SIGECOM o para los casos E1–E5; entrenar o ajustar modelos; proveedores externos de agentes o «computer use»; memoria entre tareas; prometer rollback; dashboard, gestión de usuarios o infra distribuida; usar `/__reset` y `/__check` dentro del agente.

## Modelo / dominio

- `Task {task_id PK, instruction, desktop_ref, estado, resumen, created_at, deadline_at, finished_at}`: `desktop_ref` **nunca** guarda la contraseña.
- `ExecutionContext {task_id, screen_observations, action_history, current_goal, remaining_time}`: solo en memoria; las capturas son efímeras.
- `DesktopLease {desktop_key, task_id, expires_at}`: exclusividad por escritorio (ADR-0005).
- `Action {type, coordinates_or_text, timestamp, verification}`, con tipos `click|type|key|scroll|wait|finish|fail`, validada por el `Guard` antes de ejecutarse.
- `estado`: `en_curso` | `terminada` | `fallida` (en español, literal).
- **E1–E5**: casos de práctica (crear, editar un campo, pregunta, exportar, homónimos). Son aceptación, **no** flujos a codificar.

## Stack tecnológico

- Node.js + TypeScript 6 (`module: nodenext`, `strict`), NestJS 12 (ESM) sobre Express. npm, sin monorepo.
- Lint: **oxlint** `--type-aware` (`.oxlintrc.json`: `no-floating-promises` = error). Formato: **Prettier** (comillas simples, trailing commas). No hay ESLint.
- Tests: Jest 30 + ts-jest + supertest.
- Decidido, aún sin instalar: `rfb2` + `ws` (ADR-0002), LLM multimodal vía OpenRouter (ADR-0003), SQLite con `node:sqlite` (ADR-0011, ADR-0014). Node objetivo: **24 (≥ 24.9)**.
- ⚠️ El overlay del kit habla de TypeORM/PostgreSQL/Redis/BullMQ. **Aquí no se usan** (ADR-0011): SQLite y una sola instancia. No metas ORM, Postgres, Redis ni BullMQ sin un ADR nuevo.

## Estructura del repositorio

Hechos: `tasks`, `vnc`, `llm`, `common`, `config`, `health`. Vacío: `agent`.

- `src/tasks/`: `POST/GET /tasks`, `TasksService` (lease → 409), `TaskRunner` (watchdog 270 s, redacción, persistir → liberar lease), `TaskRepository` → `sqlite/` (`node:sqlite`, migraciones). Puerto `TaskExecutor` (token `TASK_EXECUTOR`): hoy `UnavailableAgentExecutor`; lo sustituirá el agente.
- `src/vnc/`: `VncConnector` → `VncDesktop` (click/type/keys/scroll/settle) sobre `RfbSession` (`rfb2-session.ts`).
- `src/common/`: `BearerAuthGuard` (global, `@Public()`), `ApiExceptionFilter` (`{code,message,details?}`), `ValidationPipe`, `redactSecrets`.
- `src/config/`: esquema Joi del env. `src/health/`: `GET /health` abierto.
- `src/llm/`: puerto `LlmClient` (token `LLM_CLIENT`) → `OpenRouterClient` (fetch, timeout/reintento ADR-0012, respaldo `models`); `actions.ts`: 7 herramientas + `parseToolCall` (valida forma, no política). PNG en `src/vnc/png.ts`.
- `src/agent/`: bucle observar → decidir → actuar → verificar, `Guard`.
- `test/`: e2e (`*.e2e-spec.ts`, env en `e2e-env.ts`) y live (`*.live-spec.ts`). Unit tests junto al código (`*.spec.ts`).

## Arquitectura

Flujo (diagrama en `../system-design-agent-screen/architecture.md`):

1. La API valida el Bearer y el body, registra `en_curso` y devuelve `task_id` en < 2 s (ADR-0004).
2. El worker toma la URL y la contraseña **de esa solicitud** (nunca de config) y adquiere el lease.
3. Bucle: captura → LLM propone acción → `Guard` (esquema, límites de pantalla, plazo, destructivas) → RFB ejecuta → nueva observación.
4. Interacción: clic con pulsación de **150 ms**; `Ctrl+A` antes de reemplazar texto; tras cada acción, esperar un cambio significativo y estabilidad según el `lag` calibrado (ADR-0013). No asumir 1280×800 ni la disposición de la UI.
5. Escrituras: esperar estabilización (1,2 s sin cambios > 50 px, ADR-0013), buscar el registro y reintentar **solo si falta** (ADR-0007).
6. Fin: parar acciones → cerrar VNC (`destroy()`, timeout 2 s) → **después** persistir el estado terminal y el resumen.

**Contratos** (literales; no cambiar nombres ni forma):

- `GET /health` → 200 cuando está listo. **Abierto**: no exige Bearer, pero lo acepta si llega.
- `POST /tasks` `{tarea, escritorio:{url,password}}` → **200** `{"task_id":"…"}` en < 2 s. Si el escritorio ya tiene una tarea activa → **409** `{code:"DESKTOP_BUSY", message}`, sin crear tarea (ADR-0005).
- `GET /tasks/{id}` → `{"estado","resumen"}`; 404 si no existe.
- `/tasks*` exige `Authorization: Bearer` (401 si falta o no coincide). Los errores van con el envelope `{code, message}`; el éxito, con el formato literal de arriba. Sin `Idempotency-Key`: dos POST iguales son dos tareas (la segunda recibe 409 mientras la primera siga activa).

**Fallas previstas** (escenario → mitigación):

- WSS/RFB no conecta o se cae → reintento acotado solo si es seguro; si no, `fallida`; cerrar recursos.
- Captura sin repintar (lag medido ~3,4 s) → esperar `clamp(1,5×lag+0,5 s, 1,5 s, 8 s)`; nunca es fallo ni motivo de repetir.
- Clic ignorado o texto concatenado → 150 ms, `Ctrl+A` y verificar el campo.
- Acción inválida del LLM → rechazarla, volver a observar o `fallida`.
- LLM lento o colgado → `AbortSignal` = min(25 s, restante − 5 s); 1 reintento solo ante 429/5xx; watchdog a los 270 s (ADR-0006, ADR-0012).
- Homónimos → no editar; `fallida` con los datos discriminantes (ADR-0009).
- Prompt injection en pantalla → el contenido es dato, no orden; el `Guard` bloquea destructivas no pedidas (ADR-0008).
- Cierre VNC bloqueado → `destroy()` y persistir igualmente.
- Caída del proceso → al arrancar, las `en_curso` pasan a `fallida`; no reanudar escrituras.

## Reglas de negocio (invariantes)

- **Cero cambios no pedidos y cero duplicados.** Nada más allá de la instrucción literal (E2: «nota» en el nombre del archivo no autoriza editar notas).
- **Ninguna acción tras el estado terminal ni después de 270 s.** Plazo oficial: 300 s.
- `terminada` solo tras **verificar** el objetivo en la UI. Haber hecho clic no cuenta.
- Formato del `resumen` en preguntas: una línea `respuesta: <valor>`; con dos datos, `respuesta: <d1>; <d2>` en el orden de la pregunta; el valor numérico es el primer número de la línea. Si no se puede responder: `fallida` y **sin** `respuesta:`.
- Fallo esperado: el resumen nombra los datos que explican el motivo (p. ej. identificadores de los homónimos).
- «hoy», «ayer», etc. se calculan con la **fecha visible en la app**, no con la del servidor.
- Siempre el escritorio de la solicitud; máximo una tarea activa por escritorio.

## Seguridad y compliance

- **ASVS 5.0 nivel L2**: hay autenticación, credenciales de terceros en cada solicitud, datos de clientes en pantalla y un agente que actúa.
- Bearer en `/tasks*` (`/health` abierto), comparado en tiempo constante. Redactor central (`***`) para contraseña y token en logs y resumen; no loguear el body ni la URL completa del escritorio (ADR-0010). Credenciales y capturas solo en memoria.
- **Usa LLM y es un agente que actúa**: aplican OWASP LLM Top 10 y las listas de agentes (injection desde la pantalla, acciones excesivas).
- Las capturas (que pueden contener datos de clientes) solo salen hacia OpenRouter. Ni se persisten ni se mandan a telemetría.

## Atributos de calidad

- `POST /tasks` p100 < 2 s · tarea completa y cerrada < 300 s (presupuesto interno 270 s) · `/health` 200 cuando está listo.
- Carga: el evaluador consulta cada 5 s; techo ≈ 12 tareas/h por escritorio; concurrencia real desconocida.
- Sin objetivos de disponibilidad, p95 de inferencia ni coste: medir en las pruebas.

## Integraciones externas

- Escritorio VNC/RFB de cada solicitud (`wss://…/websockify` + contraseña).
- LLM multimodal vía OpenRouter (autorizado a recibir capturas): solo decide; nunca delegar la operación a un proveedor de agentes.
  - El modelo es configuración (`LLM_MODEL` y, opcional, `LLM_FALLBACK_MODELS`). El código no depende de un proveedor: salida por JSON schema o tool calling.
  - Por defecto: `anthropic/claude-sonnet-5.5`. Candidatos a comparar con E1–E5: `anthropic/claude-opus-5.5` (más capaz, el doble de caro), `openai/gpt-6.1-sol`, `google/gemini-3.8-flash` (rápido y barato) y `deepseek/deepseek-v4.1-flash` (el más barato).
  - ⚠️ `deepseek-v4-pro`, `v4-flash`, `v3.x` y `r1` **no aceptan imágenes**. Evita las variantes `:batch` (asíncronas) y `-exp`.
  - Verifica las capacidades en `https://openrouter.ai/api/v1/models` (`architecture.input_modalities`).
- Práctica: `POST /__reset` y `POST /__check` del escritorio de prueba, con su propio token. **Solo en scripts de validación externos, jamás en `src/`.**

## Comandos principales

Confirmados el 2026-10-31 con Node 24.22.2 (`.nvmrc`; `engines` ≥ 24.9):

- `npm run build` ✅ · `npm run lint` ✅ · `npx prettier --check "src/**/*.ts" "test/**/*.ts"` ✅
- `npm run start:dev` · `npm run start:prod` (`node dist/main`) ✅, `PORT` por defecto 3000.
- `npm test` ✅ · `npm run test:e2e` ✅ · `npm run test:live` (escritorio real) · `npm run test:cov`. Avisan de `--experimental-vm-modules` (ExperimentalWarning): es inofensivo.

## Despliegue / infraestructura

- **Docker**, una sola instancia y servicio público. Imagen `node:24-slim` (sin dependencias nativas, ADR-0014), con un volumen nombrado montado en `/data` para la BD (ADR-0011). Healthcheck del contenedor contra `GET /health`.
- No hay Dockerfile ni CI todavía.
- El script `deploy` (`nest deploy`, Mau/AWS) viene del scaffold: no se usa.

## Variables de entorno críticas

Documentadas en `.env.example`. Se validan al boot con `getOrThrow`.

- **Fail-fast:** `AGENT_API_TOKEN` (Bearer de `/tasks*`), `OPENROUTER_API_KEY` y `LLM_MODEL`. Opcional: `LLM_FALLBACK_MODELS`.
- **Con valor por defecto:** `PORT` (3000), `DATABASE_PATH` (`./data/agent-screen.db`; en Docker se fija `/data/agent-screen.db`), `LOG_LEVEL` (`error|warn|info|debug|verbose`, info) y `NODE_ENV` (solo `test` cambia algo: ignora `.env`).
- La URL y la contraseña del escritorio **no** van en env: llegan en cada solicitud. Excepción: `DESKTOP_URL`, `DESKTOP_PASSWORD` y `DESKTOP_TOKEN` (práctica) existen solo para `spikes/`, y `src/` **nunca** las lee. Los plazos son constantes de código (ADR-0012), no env.

## Testing

- Unit: `src/**/*.spec.ts`, London (mocks de VNC y LLM). E2E: `test/*.e2e-spec.ts` con supertest. No hay umbral de cobertura.
- Regresión obligatoria: el watchdog corta a los 270 s; ninguna acción tras el estado terminal; no reintentar una escritura si el registro ya aparece; bloqueo de homónimos; el `Guard` rechaza destructivas no pedidas y escrituras con < 40 s; el caret no impide la estabilidad; calibración del lag; el redactor elimina contraseña y token del resumen; formato `respuesta:`; `POST /tasks` < 2 s; `/health` 200 sin token; `/tasks*` 401 sin Bearer; 409 con el escritorio ocupado; las tareas `en_curso` pasan a `fallida` al reiniciar.
- Aceptación manual E1–E5: `__reset` → `POST /tasks` → poll → `__check`. Registrar diff, cambios extra, duplicados, estado, resumen y tiempo.

## Decisiones de arquitectura

- Solo RFB sobre WebSocket → `docs/adr/0001-…` · `rfb2` + `ws` (plan B `@computernewb/nodejs-rfb`) → `0002`
- LLM decide, código propio ejecuta, sin memoria entre tareas → `0003` · API asíncrona + worker cancelable → `0004`
- Una tarea por escritorio → `0005` · Watchdog 270 s → `0006` · Escrituras verificadas sin reintentos ciegos → `0007`
- `Guard` anti-destructivas → `0008` · Bloqueo de homónimos → `0009` · Redactor de secretos + Bearer en tiempo constante → `0010`
- SQLite (WAL) en volumen Docker; lease en memoria → `0011` · Driver `node:sqlite` → `0014` · Presupuestos de tiempo (LLM 25 s, conexión 10 s) → `0012` · Estabilización con lag calibrado y escrituras ≥ 40 s → `0013`

## Notas / gotchas

- **Node ≥ 24.9 obligatorio** (`nvm use`): con Node 22, Jest no carga Nest 12 (ESM) y falla con "Must use import to load ES Module". El `default` de nvm en esta máquina sigue apuntando a 22.
- `nest build` → `dist/main.js`, `dist/vnc/…` (sin `src/`). `test:live`: escritorio (solo lectura) + 1 llamada LLM (~0,005 créditos); lee `.env` aparte (Jest copia `process.env`).
- **OpenRouter con `require_parameters: true` descarta proveedores que no admitan TODO lo enviado** (404 «No endpoints found»): con `claude-sonnet-5.5` no envíes `temperature`, `parallel_tool_calls` ni `tool_choice: "required"`; usa `"auto"`. Mira `supported_parameters` en `/api/v1/models`.
- `AGENTS.md` sugiere NestJS Observe. No forma parte del diseño: no lo añadas sin decidirlo, y nunca envíes capturas ni secretos a telemetría.
- **Spike `rfb2` superado (2026-10-31, `spikes/rfb2-spike.mjs`).** WSS + VNC auth listos en ~1,1 s; 1280×800, ZRLE; clic de 150 ms, `Ctrl+A` (reemplaza) y tecleo funcionan. Trampas medidas:
  - La 1.ª update puede traer solo `extendedDesktopSize`: espera una con rects `pixels` o `copy`.
  - Retraso **variable** hasta ver un cambio: 0,8–5,8 s en 6 muestras (no 1 s). El cursor va dibujado en el framebuffer.
  - La autenticación VNC (DES) solo usa los **8 primeros caracteres** de la contraseña.
  - El caret parpadea (1×13 px cada ~0,4–0,8 s): «dos capturas iguales» nunca se cumple; ignora cambios diminutos. La fecha de la app está en la cabecera («Hoy: dd/mm/aaaa»).

## Pendiente de confirmar

- Modelo definitivo: elegirlo tras medir con E1–E5 el acierto, el p95 por llamada y el coste por tarea.
- **Backlog:** ADR-0015 (retraso variable 0,8–5,8 s → quitar la calibración y esperar cambio con tope fijo de 8 s) y simplificar `VncDesktop` en consecuencia.
