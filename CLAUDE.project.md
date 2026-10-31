# agent-screen — Definición para Claude

> Diseño de origen: `../system-design-agent-screen/design.md` (actualizado 2026-10-31). Brief: `../system-design-agent-screen/brief.md`. Decisiones en `docs/adr/`. Mapa del código y trampas técnicas: `.claude/rules/implementacion.md` (se carga al tocar `src/`, `test/` o `spikes/`).

## Visión del producto

Agente que recibe tareas en lenguaje natural y opera aplicaciones legacy **desconocidas** (sin API ni documentación) observando y actuando **solo** sobre un escritorio remoto VNC/RFB (`wss://…/websockify`). Crea y modifica registros, consulta datos y exporta reportes. Rechaza como `fallida` lo ambiguo, imposible o peligroso. La práctica es sobre SIGECOM; la evaluación usa **otra app nunca vista**.
**Fuera de alcance (v1):** DOM, BD, endpoints internos o JS inyectado de la app; flujos, coordenadas o valores codificados para SIGECOM o para E1–E5; entrenar o ajustar modelos; proveedores externos de agentes o «computer use»; memoria entre tareas; prometer rollback; dashboard, gestión de usuarios o infra distribuida; usar `/__reset` y `/__check` dentro del agente.

## Modelo / dominio

- `Task {id, instruction, desktopKey, estado, resumen, createdAt, deadlineAt, finishedAt}`. `desktopKey` = SHA-256 de protocolo + host + ruta: **nunca** la contraseña.
- `estado`: `en_curso` | `terminada` | `fallida`, literal en español.
- Lease por escritorio: en memoria, una tarea activa por `desktopKey` (ADR-0005).
- Acción del modelo: `click|type|key|scroll|wait|finish|fail`. `click`/`key` declaran `intent` (`navegar|escribir|confirmar|exportar|eliminar`) y, al confirmar, `registro`, `coincidencias` y `reintento`. Las acciones no terminales admiten una `nota` (dato leído que se conserva).
- **E1–E5**: casos de práctica (crear, editar un campo, pregunta, exportar, homónimos). Son aceptación, **no** flujos a codificar.

## Stack tecnológico

- Node.js **24** (`.nvmrc` 24.22.2; `engines` ≥ 24.9) + TypeScript 6 (`nodenext`, `strict`), NestJS 12 (ESM) sobre Express. npm, sin monorepo.
- `rfb2` + `ws` (ADR-0002); LLM multimodal vía OpenRouter con `fetch` nativo (ADR-0003); SQLite con `node:sqlite` (ADR-0011, ADR-0014); config con `@nestjs/config` + Joi; DTOs con `class-validator`.
- Lint: **oxlint** `--type-aware` (`no-floating-promises` = error). Formato: **Prettier**. No hay ESLint. Tests: Jest 30 + ts-jest + supertest.
- ⚠️ El overlay del kit habla de TypeORM/PostgreSQL/Redis/BullMQ. **Aquí no se usan** (ADR-0011): SQLite y una sola instancia. No metas ORM, Postgres, Redis ni BullMQ sin un ADR nuevo.

## Arquitectura

`src/`: `tasks` (API, runner, SQLite) → `agent` (bucle + `Guard`) → `vnc` (escritorio) y `llm` (OpenRouter). Más `common`, `config` y `health`. Diagrama: `../system-design-agent-screen/architecture.md`.

1. La API valida el Bearer y el body, registra `en_curso` y devuelve `task_id` en < 2 s (ADR-0004).
2. El runner adquiere el lease y lanza el agente con la URL y la contraseña **de esa solicitud** (nunca de config). Watchdog: 270 s (ADR-0006).
3. Bucle: captura → LLM propone una acción → validación de forma → `Guard` (política) → VNC → esperar cambio (≤ 8 s, ADR-0015) y estabilidad (1,2 s, ADR-0013) → nueva captura.
4. Interacción: clic de **150 ms**; `Ctrl+A` antes de reemplazar texto. No asumir 1280×800 ni la disposición de la UI.
5. Escrituras: verificar en pantalla; reintentar **solo si falta**, y una vez (ADR-0007).
6. Fin: el agente cierra VNC (`destroy()` si hay abort) → el runner persiste el estado terminal redactado → libera el lease.

**Contratos** (literales; no cambiar nombres ni forma):

- `GET /health` → 200 `{"status":"ok"}`. **Abierto**: no exige Bearer.
- `POST /tasks` `{tarea, escritorio:{url,password}}` → **200** `{"task_id":"…"}` en < 2 s. Escritorio con tarea activa → **409** `DESKTOP_BUSY`, sin crear tarea.
- `GET /tasks/{id}` → `{"estado","resumen"}`; 404 `TASK_NOT_FOUND`.
- `/tasks*` exige `Authorization: Bearer` (401 si falta o no coincide). Errores con el envelope `{code, message, details?}`. Sin `Idempotency-Key`.

**Fallas previstas** (escenario → mitigación):

- WSS/RFB no conecta → `fallida` con el código (`AUTH_FAILED`, `CONNECT_FAILED`…), sin cambios.
- Pantalla con retraso → esperar hasta 8 s; sin cambio no es fallo ni motivo para repetir.
- Acción inválida del LLM → `RECHAZADA` y vuelve al modelo; 3 seguidas → `fallida`.
- LLM lento o colgado → timeout por llamada y 1 reintento (ADR-0012); watchdog a los 270 s.
- Homónimos → `Guard` exige `coincidencias = 1`; si no, `fail` con los datos discriminantes (ADR-0009).
- Prompt injection en pantalla → la tarea es la única fuente de órdenes; el `Guard` bloquea destructivas no pedidas (ADR-0008).
- Cifras supuestas → el `Guard` bloquea `finish` con marcas de suposición; las `nota` evitan perder lo leído.
- Caída del proceso → al arrancar, las `en_curso` pasan a `fallida`; no se reanuda nada.

## Reglas de negocio (invariantes)

- **Cero cambios no pedidos y cero duplicados.** Nada más allá de la instrucción literal (E2: «nota» en el nombre del archivo no autoriza editar notas).
- **Ninguna acción tras el estado terminal ni después de 270 s.** Plazo oficial: 300 s.
- `terminada` solo tras **verificar** en la UI. Haber hecho clic no cuenta. Ningún dato supuesto.
- Formato del `resumen` en preguntas: una línea `respuesta: <valor>`; con dos datos, `respuesta: <d1>; <d2>` en el orden de la pregunta; el valor numérico es el primer número de la línea. Si no se puede responder: `fallida` y **sin** `respuesta:`.
- Fallo esperado: el resumen nombra los datos que explican el motivo (p. ej. identificadores de los homónimos).
- «hoy», «ayer», etc. se calculan con la **fecha visible en la app**, no con la del servidor.
- Siempre el escritorio de la solicitud; máximo una tarea activa por escritorio.

## Seguridad y compliance

- **ASVS 5.0 nivel L2**: hay autenticación, credenciales de terceros en cada solicitud, datos de clientes en pantalla y un agente que actúa.
- Bearer comparado en tiempo constante (SHA-256 + `timingSafeEqual`). Redactor central (`***`) para la contraseña (también su prefijo VNC de 8) y el token, en resumen y logs. No se loguea el body ni la URL completa (ADR-0010). Credenciales y capturas solo en memoria.
- **Usa LLM y es un agente que actúa**: aplican OWASP LLM Top 10 y las listas de agentes (injection desde la pantalla, acciones excesivas). La contraseña nunca va al modelo.
- Las capturas (pueden contener datos de clientes) solo salen hacia OpenRouter. Ni se persisten ni se mandan a telemetría.

## Atributos de calidad

- `POST /tasks` < 2 s (medido: 17 ms) · tarea cerrada < 300 s (presupuesto 270 s) · `/health` 200 cuando está listo.
- **E1–E5 en vivo (2026-10-31, `claude-sonnet-5.5`): 5/5 aprobados** (`__check` + criterios del agente). 45–80 s y 9–19 pasos por tarea; 0,54 créditos en total (0,06–0,16 por tarea); 56–64 % de los tokens desde caché.
- Carga: el evaluador consulta cada 5 s; techo ≈ 12 tareas/h por escritorio. Sin objetivos de disponibilidad ni de coste: medir con E1–E5.

## Integraciones externas

- Escritorio VNC/RFB de cada solicitud (`wss://…/websockify` + contraseña).
- OpenRouter (autorizado a recibir capturas): solo decide; nunca delegar la operación a un proveedor de agentes. Modelo en `LLM_MODEL` (por defecto `anthropic/claude-sonnet-5.5`) y respaldo opcional en `LLM_FALLBACK_MODELS`. Candidatos con imagen: `claude-opus-5.5`, `gpt-6.1-sol`, `gemini-3.8-flash`, `deepseek-v4.1-flash`. ⚠️ El resto de DeepSeek (`v4-pro`, `v4-flash`, `v3.x`, `r1`) no acepta imágenes; evita `:batch` y `-exp`.
- Práctica: `POST /__reset` y `POST /__check` del escritorio de prueba, con su propio token. **Solo en scripts de validación externos, jamás en `src/`.**

## Comandos principales

Confirmados el 2026-10-31 con Node 24.22.2:

- `npm run build` · `npm run lint` · `npx prettier --check "src/**/*.ts" "test/**/*.ts"`
- `npm run start:dev` · `npm run start:prod` (`node dist/main`), puerto 3000.
- `npm test` · `npm run test:e2e` · `npm run test:live` (escritorio real + 1 llamada LLM) · `npm run test:cov`. El aviso `ExperimentalWarning` de `--experimental-vm-modules` es inofensivo.
- `docker compose up --build`: requiere Docker; en este WSL falta activar la integración de Docker Desktop.

## Despliegue / infraestructura

- **Docker**, una sola instancia y servicio público. `Dockerfile` multi-etapa `node:24.22.2-slim` (build / deps `--omit=dev` / runtime), usuario `node`, `VOLUME /data`, `HEALTHCHECK` contra `/health`. `compose.yaml` con volumen `agent-data`, `init` y `env_file: .env`.
- `SIGTERM` → Nest aborta las tareas activas (quedan `fallida`) y cierra la BD. Sale con 143: es lo normal en Nest.
- Sin CI todavía. El script `deploy` (`nest deploy`, Mau/AWS) viene del scaffold y no se usa.

## Variables de entorno críticas

Documentadas en `.env.example`; validadas al boot con Joi.

- **Fail-fast:** `AGENT_API_TOKEN` (≥ 16 caracteres), `OPENROUTER_API_KEY` y `LLM_MODEL`. Opcional: `LLM_FALLBACK_MODELS`.
- **Con valor por defecto:** `PORT` (3000), `DATABASE_PATH` (`./data/agent-screen.db`; la imagen fija `/data/agent-screen.db`), `LOG_LEVEL` (`error|warn|info|debug|verbose`; `debug` registra cada paso del agente) y `NODE_ENV` (solo `test` cambia algo: ignora `.env`).
- La URL y la contraseña del escritorio **no** van en env: llegan en cada solicitud. `DESKTOP_URL`, `DESKTOP_PASSWORD` y `DESKTOP_TOKEN` son solo para `spikes/` y tests live; `src/` **nunca** las lee. Los plazos son constantes de código (ADR-0012, ADR-0015).

## Testing

- Unit junto al código (London: VNC, LLM y reloj simulados) · e2e con la app completa · live contra el escritorio y OpenRouter. Sin umbral de cobertura.
- Regresión obligatoria: watchdog a 270 s y nada tras el abort; no reintentar una escritura si el registro aparece; homónimos (`coincidencias = 1`); destructivas no pedidas; escrituras con < 40 s; suposiciones en `finish`; caret ignorado al estabilizar; redacción de contraseña y token; formato `respuesta:`; `/health` sin token; 401; 409; `en_curso` → `fallida` al reiniciar.
- Aceptación E1–E5: `node spikes/run-case.mjs e1-e5/E<n>-….json <puerto>` (hace `__reset` → `POST /tasks` → poll cada 5 s → `__check` → criterios del agente). Los JSON viven en `e1-e5/` (local, ignorado por git).

## Decisiones de arquitectura

- Solo RFB sobre WebSocket → `docs/adr/0001-…` · `rfb2` + `ws` → `0002` · LLM decide, código propio ejecuta → `0003` · API asíncrona + worker cancelable → `0004`
- Una tarea por escritorio → `0005` · Watchdog 270 s → `0006` · Escrituras verificadas sin reintentos ciegos → `0007` · `Guard` anti-destructivas → `0008`
- Homónimos → `0009` · Redactor + Bearer en tiempo constante → `0010` · SQLite en volumen → `0011` · Presupuestos de tiempo → `0012`
- Cambio significativo + estabilidad + escrituras ≥ 40 s → `0013` · Driver `node:sqlite` → `0014` · Espera fija de 8 s sin calibrar → `0015`

## Notas / gotchas

- **Node ≥ 24.9 obligatorio** (`nvm use`): con Node 22, Jest falla con "Must use import to load ES Module". El `default` de nvm en esta máquina sigue en 22.
- `AGENTS.md` sugiere NestJS Observe. No forma parte del diseño: no lo añadas sin decidirlo, y nunca envíes capturas ni secretos a telemetría.
- El `.env` local también lleva `DESKTOP_*` de práctica, y `compose.yaml` lo carga entero en el contenedor (la app no las lee). En producción, pasa solo las variables de la app.

## Pendiente de confirmar

- Modelo: `claude-sonnet-5.5` aprueba E1–E5 con una ejecución por caso. Falta medir la variabilidad (varias ejecuciones) y comparar con algún candidato más barato.
- La app de evaluación es otra: E1–E5 no garantizan generalizar.
