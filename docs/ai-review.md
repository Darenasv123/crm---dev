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

## Persistencia (Fase 2A)

- **`ai_findings` y `ai_analysis_runs`:** Implementado en `src/lib/ai-review/findings-service.ts` y `src/hooks/use-ai-findings.ts`.
- **`source_references`:** Registro de referencias de documento, página, extracto y nivel de confianza.
- **Decisión humana persistente:** `persistFindingDecision` registra `verification_status`, `review_notes`, `reviewed_by` y `reviewed_at`.
- **Actualización optimista y rollback:** `useUpdateFindingDecision` aplica actualización optimista en UI con rollback automático si falla la red.
- **Aislamiento de modo demostración:** La pantalla `/revision-ia` incluye un alternador "Supabase (Real)" vs "Modo demostración local", garantizando que los datos de prueba no toquen Supabase.
- **Control de alcance:** Ninguna acción de revisión crea clientes o expedientes reales automáticamente en esta fase.

## Controles antes de conectar un modelo

1. Definir clasificación de confidencialidad y base legal de tratamiento.
2. Elegir región, retención y política de entrenamiento del proveedor.
3. Evitar enviar documentos completos cuando baste un fragmento.
4. Registrar versión, coste, errores y trazabilidad.
5. Establecer umbrales de confianza solo como ayuda visual.
6. Probar con documentos ficticios antes de cualquier expediente real.
