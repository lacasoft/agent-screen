# Trampas encontradas (2026-10-31)

- **Escritorio de práctica:** el retraso de pantalla tras una acción varía entre 0,8 y 5,8 s (6 muestras) → espera fija de 8 s, sin calibrar (ADR-0015). La 1.ª update puede traer solo `extendedDesktopSize`. El cursor va dibujado en el framebuffer. El caret parpadea (1×13 px). VNC solo usa los 8 primeros caracteres de la contraseña. La fecha de la app está en la cabecera («Hoy: …»). Al abrir aparece un diálogo que hay que cerrar.
- **OpenRouter:** `require_parameters: true` + un parámetro no soportado = 404 «No endpoints found». `claude-sonnet-5.5` no admite `temperature`, `parallel_tool_calls` ni `tool_choice: "required"`. Catálogo y `supported_parameters` en `https://openrouter.ai/api/v1/models`.
- **`@nestjs/config` 12** valida con Standard Schema: `validationOptions` de Joi (p. ej. `abortEarly`) no compila. Joi 18 lo implementa.
- **`better-sqlite3@13`** compila con node-gyp (no hay g++/make aquí) y npm 11 bloquea su install script → se usa `node:sqlite` (ADR-0014).
- **Jest:** necesita Node ≥ 24.9 para cargar Nest 12/`rfb2` (solo ESM). Cada test recibe una copia de `process.env`, así que `process.loadEnvFile` no le llega: los tests live leen `.env` con `parseEnv`. `drain()` del runner espera a TODAS las tareas activas.
- **WSL:** `mkdirSync` recursivo sobre `/proc` se cuelga. `pkill -f <patrón>` mata la propia shell si el patrón aparece en el comando. No hay Docker hasta activar la integración de Docker Desktop.
- **Git:** `git add -A` arrastró `e1-e5/` (JSON de práctica, locales) y un `.gitignore` del usuario. Commitea con rutas explícitas.
- **Prettier** reformatea en cada cambio: no edites con fragmentos copiados de una versión anterior del archivo.
