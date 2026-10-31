# ADR-0003: Decidir con un LLM multimodal y ejecutar con código determinista propio

- Estado: Aceptado
- Fecha: 2026-10-31
- Decisores: equipo agent-screen (System Design)

> Origen: `../system-design-agent-screen/design.md` (*Decisiones*, *Arquitectura → Flujo 4-6*, *Escala → supuestos*).

## Contexto
La app de evaluación es desconocida, así que no se pueden pregrabar flujos. Los requisitos prohíben delegar la automatización a proveedores externos de agentes («computer use» o equivalentes).

## Decisión
Un modelo multimodal vía OpenRouter (autorizado a recibir las capturas) interpreta la pantalla y propone una acción acotada (`click`, `type`, `key`, `scroll`, `wait`, `finish`, `fail`). La orquestación, la validación (`Guard`) y la ejecución por RFB son código propio. Se vuelve a observar y verificar tras cada acción significativa. El contexto es temporal por tarea: nada de memoria ni conocimiento ligado a SIGECOM entre tareas.

## Alternativas consideradas
- Secuencias, coordenadas o selectores pregrabados para SIGECOM: no generalizan a la app oculta.
- Proveedor externo de automatización o agente: prohibido por los requisitos.
- Ejecutar cadenas largas sin observar: más falsos éxitos.

## Consecuencias
- Positivas: generaliza; el control queda en nuestro código.
- Negativas: más coste y latencia de inferencia; hay que desarrollar la orquestación; la interfaz se redescubre en cada tarea.
