# ADR-0014: Usar `node:sqlite` (integrado en Node) como driver de SQLite

- Estado: Aceptado
- Fecha: 2026-10-31
- Decisores: equipo agent-screen

> Reemplaza la elección de driver de ADR-0011 (`better-sqlite3`). El resto de ADR-0011 sigue vigente: SQLite en WAL sobre un volumen Docker, puerto `TaskRepository`, migraciones con `PRAGMA user_version` y lease en memoria.

## Contexto
- `better-sqlite3@13` ya no trae binarios: su script de instalación compila con `node-gyp`, lo que exige `g++` y `make` (ausentes en la máquina de desarrollo y en `node:24-slim`).
- `better-sqlite3@12` descarga un binario precompilado de GitHub durante la instalación.
- npm 11 bloquea los scripts de instalación hasta aprobarlos explícitamente, y ejecutar código nativo descargado al instalar es superficie de cadena de suministro.
- ADR-0011 descartó `node:sqlite` por «aún no estable». En Node 24.22.2 (`.nvmrc`) funciona sin `ExperimentalWarning`; se comprobó creando una tabla en memoria.

## Decisión
Usar `node:sqlite` (`DatabaseSync`), con la misma configuración: WAL, `busy_timeout` y `PRAGMA user_version`. Su uso queda confinado al adaptador de `TaskRepository` en `src/tasks/`.

## Alternativas consideradas
- `better-sqlite3@13`: obliga a tener una toolchain de compilación en dev y en la imagen (multi-stage).
- `better-sqlite3@12`: hay que aprobar un script de instalación que descarga un binario. Funciona, pero añade dependencia de red al construir y código nativo de terceros.

## Consecuencias
- Positivas: cero dependencias nativas y cero scripts de instalación; la imagen `node:24-slim` vale tal cual. Ya no hace falta exigir glibc por el driver.
- Negativas: API más joven y con menos ayudas que `better-sqlite3` (sin `transaction()` de alto nivel: las transacciones van con `BEGIN`/`COMMIT` explícitos).
- Revisar si `node:sqlite` cambia su API en una versión mayor de Node: el adaptador es el único punto a tocar.
