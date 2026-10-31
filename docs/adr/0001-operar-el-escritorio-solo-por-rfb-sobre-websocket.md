# ADR-0001: Operar el escritorio solo por RFB sobre WebSocket

- Estado: Aceptado
- Fecha: 2026-10-31
- Decisores: equipo agent-screen (System Design)

> Origen: `../system-design-agent-screen/design.md` (secciones *Requisitos*, *Fuera de alcance*, *Decisiones*).

## Contexto
Las apps legacy no tienen API, documentación ni red exterior; el único acceso es un escritorio remoto en `wss://…/websockify` (VNC/RFB). La evaluación usa una aplicación nunca vista y prohíbe depender del DOM o de APIs internas.

## Decisión
El agente observa y actúa exclusivamente mediante el protocolo RFB sobre WebSocket: framebuffer para ver, eventos de ratón y teclado para actuar. Siempre con la URL y contraseña recibidas en cada `POST /tasks`.

## Alternativas consideradas
- Playwright/DOM o scripts de la app: incumple la regla de interfaz única y no existe acceso a la red de la app.

## Consecuencias
- Positivas: cumple el contrato; funciona con cualquier app que se vea en el escritorio.
- Negativas: hay que gestionar capturas, repintados (hasta 1 s), clics ≥100 ms y concatenación de texto.
- Revisar solo si los requisitos llegan a autorizar otra interfaz.
