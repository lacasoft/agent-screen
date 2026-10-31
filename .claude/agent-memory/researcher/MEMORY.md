# researcher — memoria

- Fuente de requisitos: `../system-design-agent-screen/{brief,design}.md` (fuera del repo); casos E1–E5 descritos en brief §5.
- Node fijado en 24.22.2 (.nvmrc, engines ≥ 24.9). Con Node 22 Jest no carga Nest 12 ESM; el default de nvm aquí sigue en 22.
- `nest build` emite `dist/main.js`; `src/{tasks,agent,vnc,llm}` son módulos Nest vacíos (2026-10-31).
- Env definidas en `.env.example` (AGENT_API_TOKEN, OPENROUTER_API_KEY, LLM_MODEL, DATABASE_PATH); `/health` abierto, 409 si el escritorio está ocupado: decisiones posteriores al design.md.
- Spike rfb2 (2026-10-31): retraso de pantalla ~3,4 s, caret parpadeante 1×13 px, 1.ª update sin píxeles. Herramientas: spikes/{rfb2-spike.mjs,diff.cjs,crop.cjs}.
- E3 en vivo (2026-10-31): sin notas el modelo supone (falso éxito 51) o entra en bucle de paginación; con `nota` + Guard anti-suposición: respuesta 45 en 55 s, 13 pasos, 0,108 créditos. El filtro «Ruiz» también trae «Ruiz e Hijos». `node spikes/run-task.mjs "<instrucción>" <puerto>` reproduce una tarea como el evaluador.
