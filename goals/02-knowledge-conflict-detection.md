# Goal 02 — Detección de conocimiento contradictorio en el entrenamiento de Ava

**Estado:** En implementación · PoC integrado
**Owner:** axelramos
**Fecha creación:** 2026-05-28
**Última actualización:** 2026-05-28
**Sub-agente sugerido:** ninguno especializado — el trabajo es Next.js (App Router) + Supabase + Vercel AI Gateway, todo dentro del stack del propio chatbot. No requiere `android-expert`.

---

## Problema

Cuando el usuario agrega un nuevo `knowledge_fragment` desde el módulo "Entrenamiento de Ava", el sistema lo guarda sin verificar si contradice una FAQ o un fragmento ya activo. Caso real (2026-05-28): se metieron dos veces fragmentos parciales sobre la medida útil del Lambrín, quedó activa una FAQ con el cálculo viejo (0.46 m²/pieza), y el conocimiento nuevo entró sin reemplazarla. El resultado: Ava puede responder con datos contradictorios.

## Objetivo

Cuando el usuario está por guardar un fragmento de conocimiento nuevo, el sistema debe:

1. Detectar fragmentos activos y FAQs activas semánticamente similares al texto entrante.
2. Mostrar los candidatos en conflicto antes de guardar.
3. Permitir al usuario decidir, por cada candidato: **mantener activo**, **desactivar** (queda como histórico) o **eliminar**.
4. Registrar la relación `supersedes_id` (de fragmento nuevo → fragmento anterior) para trazabilidad.

## Restricciones duras

1. **No romper el bot.** El chatbot lee `knowledge_fragments` y `faqs` activos vía `service_role`. Las migraciones son aditivas (nuevas columnas con default NULL, nueva función RPC) y no cambian el shape consumido por `lib/ai.ts`.
2. **Sin hardcodear reglas de negocio en código.** La instrucción de "medida original vs cálculo con 13.5 cm" vive en `knowledge_fragments`, no en el prompt.
3. **PoC end-to-end primero.** Antes de pulir UI/UX, demostrar que: insertar texto → generar embedding → encontrar similares → presentarlos en el dashboard.

## Arquitectura

```
[Dashboard /knowledge]
       │  (1) usuario escribe contenido y presiona "Enviar"
       ▼
[POST /api/knowledge/check-similar]
       │  texto entrante
       │  ─► AI Gateway: openai/text-embedding-3-small (1536 dim)
       │  ─► Supabase RPC: search_similar_knowledge(vector, threshold)
       ▼
   [Modal de conflictos]
       │  usuario decide para cada candidato
       ▼
[POST /api/knowledge/save-fragment]
       │  guarda fragmento con embedding
       │  aplica decisiones: desactivar/eliminar candidatos
       │  setea supersedes_id si aplica
       ▼
   [Supabase: knowledge_fragments]
```

## Cambios en base de datos (aditivos)

1. Extensión `vector` habilitada en Supabase.
2. Columna `embedding vector(1536)` en `knowledge_fragments` y en `faqs` (nullable).
3. Índice `ivfflat` con `vector_cosine_ops` en ambas tablas.
4. Función RPC `search_similar_knowledge(query_embedding vector, match_threshold float, match_count int)` que devuelve filas de ambas tablas con score de similitud.

## Cambios en código

| Archivo | Propósito |
|---|---|
| `lib/embeddings.ts` (nuevo) | Wrapper de `openai/text-embedding-3-small` vía AI Gateway. Función `generateEmbedding(text)`. |
| `app/api/knowledge/check-similar/route.ts` (nuevo) | Recibe `{content, topic?}`, genera embedding, llama al RPC, devuelve candidatos con score. |
| `app/api/knowledge/save-fragment/route.ts` (nuevo) | Recibe `{content, topic, embedding, decisions[]}`, persiste y aplica decisiones en transacción. |
| `scripts/backfill-embeddings.ts` (nuevo) | Una sola pasada: genera embeddings para FAQs y fragmentos existentes. |
| `app/dashboard/knowledge/page.tsx` | Reemplaza el flujo directo de `supabase.from().insert()` por una llamada a `/api/knowledge/check-similar`. Si hay candidatos, abre modal; al confirmar, llama a `/api/knowledge/save-fragment`. |

## Resultado esperado

1. El usuario escribe "El precio del wall cladding subió a $210/pieza".
2. El sistema encuentra una FAQ activa que dice "$199/pieza" y un fragmento anterior con "$185/pieza".
3. Modal muestra ambos candidatos con su score de similitud y acciones.
4. Usuario elige: desactivar fragmento viejo, desactivar la FAQ vieja (o editarla aparte).
5. Se guarda el fragmento nuevo con `supersedes_id` apuntando al fragmento viejo.

## Criterios de aceptación PoC

- [ ] La instrucción "Regla de respuesta sobre medidas vs. cálculo" sigue intacta en `knowledge_fragments` (es la prueba de que el bot puede leer reglas dinámicas sin tocar código).
- [ ] Insertar un texto similar a un fragmento activo dispara el modal de conflictos.
- [ ] Insertar un texto sin similares guarda directo, sin modal.
- [ ] El bot sigue respondiendo correctamente después de los cambios (smoke test en `/api/send-message`).
- [ ] El cálculo de material en respuestas del bot usa 13.5 cm de ancho útil (de la nueva regla en conocimiento).

## Fuera de scope

- Edición/ranking de FAQs por similitud entre sí.
- Re-indexado automático cuando cambia un fragmento (por ahora la edición elimina y recrea).
- UI para configurar el umbral de similitud (queda fijo en 0.75 inicialmente).
