# ADR-0008: El Guard bloquea acciones destructivas que la tarea no menciona

- Estado: Aceptado
- Fecha: 2026-10-31
- Decisores: equipo agent-screen (System Design)

> Origen: `../system-design-agent-screen/design.md` (*Arquitectura → Flujo 9*, *Decisiones*, *Revisión con IA, hallazgo 5*).

## Contexto
El contenido de la pantalla puede incluir instrucciones (prompt injection). No se toleran cambios no autorizados (`lista_blanca: []`).

## Decisión
El prompt de sistema fija la tarea del solicitante como única fuente de órdenes; el contenido de la app se trata como datos. Además, el `Guard` (código, no prompt) bloquea las acciones destructivas (eliminar, vaciar…) que la instrucción original no menciona.

## Alternativas consideradas
- Confiar solo en el prompt: insuficiente frente a la inyección.

## Consecuencias
- Positivas: defensa en profundidad.
- Negativas: posibles falsos bloqueos visibles.
