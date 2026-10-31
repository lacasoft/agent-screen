# ADR-0007: Confirmar escrituras tras estabilización y no reintentar a ciegas

- Estado: Aceptado
- Fecha: 2026-10-31
- Decisores: equipo agent-screen (System Design)

> Origen: `../system-design-agent-screen/design.md` (*Arquitectura → Flujo 8*, *Decisiones*, *Fallas*, *Revisión con IA, hallazgo 3*).

## Contexto
La pantalla puede tardar hasta 1 s en repintarse. Una captura inmediata tras «Guardar» puede mostrar el formulario todavía abierto, lo que lleva a un reintento y a un registro duplicado. Los duplicados invalidan la tarea.

## Decisión
Tras una acción de confirmación, esperar a que la pantalla se estabilice (dos capturas iguales separadas ≥ 1,2 s) y buscar el registro en la lista. Solo se reintenta si está ausente. Ninguna escritura se repite sin comprobar antes su efecto.

## Alternativas consideradas
- Reintentar al ver el formulario abierto, o repetir el clic en «Guardar» tras un timeout: duplicados.

## Consecuencias
- Positivas: evita duplicados y falsos éxitos.
- Negativas: +2–4 s por escritura y posible navegación adicional. No existe garantía transaccional de «exactamente una vez» por VNC.
