# ADR-0002: Usar `rfb2` sobre `ws` como cliente RFB

- Estado: Aceptado
- Fecha: 2026-10-31
- Decisores: equipo agent-screen (System Design)

> Origen: `../system-design-agent-screen/design.md` (*Decisiones*, *Revisión con IA → Por validar*).

## Contexto
ADR-0001 exige un cliente RFB en Node que funcione sobre WebSocket (`wss://…/websockify`), con framebuffer, ratón (pulsación ≥100 ms) y teclado (`Ctrl+A`).

## Decisión
Usar `rfb2` sobre un stream dúplex obtenido con `ws` + `createWebSocketStream`. Queda condicionada a un spike de 30–60 min contra el escritorio real: conectar por `wss://`, guardar una captura PNG, clic de 150 ms, `Ctrl+A` y escribir texto.

## Alternativas consideradas
- `@computernewb/nodejs-rfb`: solo TCP, sin WebSocket. Es el **plan B** con un adaptador de transporte.
- `vnc-rfb-client`: sin mantenimiento desde 2022.
- noVNC: pensada para navegador.
- Cliente propio: coste alto para el plazo disponible.

## Consecuencias
- Positivas: acepta stream dúplex, framebuffer con `toRgba()`, eventos de entrada, encodings habituales y tipos TS.
- Negativas: exige Node ≥ 22.12 y tiene poco historial de uso.
- Revisar si el spike falla: pasar al plan B.
