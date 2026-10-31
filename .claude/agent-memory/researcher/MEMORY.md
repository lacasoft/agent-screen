# researcher — memoria (índice)

- Requisitos: `../system-design-agent-screen/{brief,design}.md` (fuera del repo). Contexto del proyecto: `CLAUDE.project.md`; mapa del código: `.claude/rules/implementacion.md`; decisiones: `docs/adr/0001–0015`.
- Estado 2026-10-31: todos los módulos implementados; E1–E5 en vivo 5/5 → [pruebas-en-vivo.md](pruebas-en-vivo.md).
- Flujo de una tarea e invariantes con `archivo:línea` → [flujos-e-invariantes.md](flujos-e-invariantes.md).
- Trampas (escritorio, OpenRouter, Jest, WSL, git) → [trampas.md](trampas.md).
- Node 24.22.2 (`.nvmrc`); el `default` de nvm en esta máquina sigue en 22: usa `nvm use` o `$HOME/.nvm/versions/node/v24.22.2/bin`.
- Herramientas: `spikes/run-case.mjs` (caso completo con `__check`), `spikes/run-task.mjs` (tarea suelta), `spikes/rfb2-spike.mjs reset|observe|move|input`, `spikes/{diff,crop}.cjs` (comparar o recortar capturas sin mirarlas enteras).
