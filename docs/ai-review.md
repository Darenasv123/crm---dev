# Revisión de información detectada

## Principio

La IA propone; el personal confirma. Ningún hallazgo pendiente modifica clientes, expedientes, partes, documentos, actuaciones o tareas.

## Pantalla actual

`/revision-ia` usa datos ficticios de Derecho de Familia y presenta:

- Izquierda: elementos detectados, pendientes y conflictos.
- Centro: ficha propuesta y decisiones.
- Derecha: documento, página, fragmento y confianza.

Las acciones aprobar, editar, rechazar, marcar conflicto y dejar pendiente funcionan en memoria. Unir clientes, crear cliente, separar expedientes y reasignar documentos están demostradas como comandos sin persistencia.

## Contrato de análisis

`DocumentAnalysisProvider` separa clasificación, entidades, actuaciones y consolidación de carpeta. Todas las respuestas pasan por Zod. `MockDocumentAnalysisProvider` permite probar el flujo; las clases de Gemini y OpenAI no ejecutan llamadas reales.

## Persistencia futura

- Cada ejecución se guarda en `ai_analysis_runs` con versión de instrucción y proveedor.
- Cada propuesta se guarda en `ai_findings`.
- La fuente se registra en `source_references`.
- La decisión humana registra estado, notas, usuario y fecha.
- Solo una operación de confirmación transforma hallazgos aprobados en datos del CRM.

## Controles antes de conectar un modelo

1. Definir clasificación de confidencialidad y base legal de tratamiento.
2. Elegir región, retención y política de entrenamiento del proveedor.
3. Evitar enviar documentos completos cuando baste un fragmento.
4. Registrar versión, coste, errores y trazabilidad.
5. Establecer umbrales de confianza solo como ayuda visual.
6. Probar con documentos ficticios antes de cualquier expediente real.
