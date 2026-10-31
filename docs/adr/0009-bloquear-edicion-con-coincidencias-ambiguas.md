# ADR-0009: Bloquear la edición cuando hay más de una coincidencia sin dato que las distinga

- Estado: Aceptado
- Fecha: 2026-10-31
- Decisores: equipo agent-screen (System Design)

> Origen: `../system-design-agent-screen/design.md` (*Arquitectura → Flujo 10*, *Decisiones*, *Fallas*, *Revisión con IA, hallazgo 4*; caso E5).

## Contexto
Puede haber homónimos (caso E5, «Ana Torres»). Modificar el registro equivocado es un cambio no autorizado.

## Decisión
El agente registra cuántas coincidencias devuelve la búsqueda. Si son más de una y la instrucción no aporta un dato que las distinga, el `Guard` bloquea la edición y la tarea termina `fallida`, con un resumen que incluye los datos discriminantes vistos en la UI.

## Alternativas consideradas
- Elegir la primera coincidencia: riesgo de modificar el registro equivocado.

## Consecuencias
- Positivas: cero cambios en casos ambiguos.
- Negativas: más `fallida` en casos que una persona habría resuelto.
