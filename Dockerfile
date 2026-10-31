# syntax=docker/dockerfile:1
# agent-screen · imagen de producción (ADR-0011, ADR-0014): Node 24 slim, sin dependencias nativas.

ARG NODE_VERSION=24.22.2

# --- build: compila TypeScript con todas las dependencias ---
FROM node:${NODE_VERSION}-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# --- deps: solo dependencias de producción ---
FROM node:${NODE_VERSION}-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# --- runtime ---
FROM node:${NODE_VERSION}-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/data/agent-screen.db \
    LOG_LEVEL=info
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
# Volumen de la BD SQLite (WAL): debe ser escribible por el usuario sin privilegios.
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
USER node
EXPOSE 3000
# GET /health es abierto (no necesita el token).
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
# Nest registra SIGTERM (enableShutdownHooks): las tareas activas se abortan y se cierran como fallida.
CMD ["node", "dist/main.js"]
