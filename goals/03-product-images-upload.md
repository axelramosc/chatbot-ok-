# Goal 03 — Imágenes de productos en el catálogo y envío por canal

**Estado:** Planificación · PoC pendiente
**Owner:** axelramos
**Fecha creación:** 2026-05-27
**Última actualización:** 2026-05-27
**Sub-agente sugerido:** ninguno especializado — el trabajo es Next.js (App Router) + Supabase Storage + Vercel AI Gateway, todo dentro del stack del propio chatbot. No requiere `android-expert`.

---

## Problema

El catálogo de productos en el módulo "Entrenamiento de Ava" permite gestionar nombre, precio, disponibilidad y descripción, pero la columna `image_url` de la tabla `products` nunca se escribe ni se lee. Los clientes han pedido ver imágenes de los productos durante la conversación con Ava. Hoy eso es imposible: no hay mecanismo de carga, no hay bucket configurado, y ni el AI ni los adapters de canal saben que las imágenes existen.

## Objetivo

1. Que cada producto del catálogo pueda tener **una imagen principal** cargada desde el dashboard de conocimiento (tab "catalog").
2. Que cuando Ava mencione un producto que tiene imagen, el sistema la envíe automáticamente al cliente vía WhatsApp, Instagram o Messenger, acompañando el mensaje de texto.

## Decisión: 1 imagen vs. múltiples

**Decisión MVP: 1 imagen por producto, usando la columna `image_url` existente.**

Justificación: la columna ya existe en `products` y en la interfaz `Product` de `lib/types.ts`. Agregar una tabla `product_images` con relación 1-N añade complejidad de UI (galería, orden, borrado selectivo), lógica de "imagen principal" y un join adicional en el contexto del bot — todo eso para un caso de uso que los clientes no han pedido explícitamente. Si en el futuro se requieren múltiples fotos, la migración a una tabla separada es limpia: se popula `product_images` desde `image_url` y se depreca la columna.

## Restricciones duras

1. **No romper el bot.** Migraciones aditivas. No se modifica el shape de `Product` que ya consume `lib/ai.ts` (`image_url` ya existe como `string | null` — solo se empieza a escribir). No se cambia la firma de `generateResponse` ni el JSON de `AIResponse` de forma retrocompatible: se agrega el campo opcional `images_to_send`.
2. **No binarios en el repo.** Todo fichero de imagen vive en Supabase Storage.
3. **Límite de peso por canal:** WhatsApp Cloud API acepta imágenes vía URL pública de hasta 5 MB. Formatos admitidos: JPEG, PNG, WEBP. El dashboard debe rechazar archivos fuera de esos límites.
4. **Costos de egress de Supabase Storage:** cada imagen enviada a un cliente consume ancho de banda de salida del proyecto Supabase. Monitorear el uso mensual; si escala, evaluar CDN o signed URLs con cache-control largo.
5. **RLS del bucket:** el bucket debe ser de lectura pública (para que WhatsApp/Instagram/Messenger puedan hacer fetch de la URL al entregar el mensaje), pero la escritura debe estar restringida al `service_role` únicamente, nunca a la `anon key`.
6. **PoC end-to-end primero.** No se construye UI pulida ni integración completa de los tres canales hasta que el flujo básico funcione de punta a punta.

## Arquitectura

```
[Dashboard /dashboard/knowledge — tab "catalog"]
       │
       │  (1) usuario selecciona imagen (jpg/png/webp ≤ 5 MB)
       ▼
[POST /api/products/upload-image]   ← API Route con service_role key
       │  recibe multipart/form-data con { productId, file }
       │  valida tipo MIME y tamaño
       │  sube a Supabase Storage: bucket "product-images"
       │  path: {productId}/{timestamp}-{filename}
       │  obtiene URL pública permanente
       │  hace PATCH products SET image_url = <url> WHERE id = productId
       ▼
[Supabase Storage: bucket "product-images" (público)]
[Supabase DB: products.image_url actualizado]

─────────────────────────────────────────────────────────

[Webhook WhatsApp / Instagram / Messenger]
       │
       │  (2) mensaje de cliente entra por /api/webhook/*
       ▼
[lib/channel-router.ts / lib/ai.ts: generateResponse()]
       │  buildProductContext() ya incluye image_url en Product
       │  SYSTEM PROMPT incluye image_url para productos mencionables
       │  AI devuelve JSON extendido:
       │  { message, intent, products_mentioned, images_to_send: string[] }
       │  images_to_send = lista de product IDs con imagen disponible
       ▼
[app/api/send-message/route.ts (o channel-router)]
       │  para cada productId en images_to_send:
       │    lookup image_url en products (ya en memoria del contexto)
       │    llama channel.sendImage(recipientId, imageUrl, caption?)
       ▼
[ChannelClient.sendImage() — WhatsApp / Instagram / Messenger]
       │  WhatsApp: POST messages con type:"image", image:{link, caption}
       │  Instagram / Messenger: POST messages attachment type:"image"
       ▼
[Cliente recibe texto + imagen del producto]
```

## Cambios en base de datos (aditivos)

La tabla `products` ya tiene `image_url text null`. **No se necesita migración de esquema.**

El único cambio de infraestructura es la creación del bucket en Supabase Storage. Se documenta como migración descriptiva en `supabase/migrations/003_product_images.sql` con un comentario que instruye al operador:

```sql
-- 003_product_images.sql
-- No hay DDL adicional: products.image_url (text, nullable) ya existe.
-- Acción manual requerida en Supabase Dashboard / CLI:
--   1. Crear bucket "product-images" con Public = true.
--   2. Política de INSERT/UPDATE/DELETE: solo service_role (sin RLS para anon).
--   3. Política de SELECT (lectura): public (para URLs públicas a canales de mensajería).
-- El bucket NO requiere signed URLs porque las URLs públicas permanentes son
-- las que WhatsApp, Instagram y Messenger fetchean al entregar el attachment.
```

**Decisión bucket público vs. firmado:** bucket **público** con path opaco (`{productId}/{timestamp}-{filename}`). Firmado añade complejidad (expiración, re-firma) sin beneficio real: las imágenes de catálogo son información de marketing, no datos sensibles. La oscuridad del path (UUID de producto + timestamp) es suficiente para no exponer un directorio listable.

## Cambios en código

| Archivo | Tipo | Propósito |
|---|---|---|
| `app/api/products/upload-image/route.ts` | nuevo | Recibe `multipart/form-data {productId, file}`. Valida MIME (image/jpeg, image/png, image/webp) y tamaño (≤ 5 MB). Sube a Storage con `service_role`. Actualiza `products.image_url`. Devuelve `{imageUrl}`. |
| `app/dashboard/knowledge/page.tsx` | modificado | En el tab "catalog", cada fila/card de producto muestra un botón "Subir imagen" (o thumbnail si ya tiene). Al hacer clic, abre file picker, llama a `/api/products/upload-image`, y refresca la fila. Sin formulario extra: inline en la tabla existente. |
| `lib/ai.ts` | modificado | `formatProductEntry()` incluye `image_url` en el contexto del producto (ej. `Imagen: <url o "sin imagen">`). `buildProductContext()` sin cambios de firma. El SYSTEM PROMPT agrega instrucción: si el producto tiene imagen y el cliente muestra interés, incluir su `product_id` en `images_to_send`. |
| `lib/types.ts` | modificado | Extender `AIResponse` con campo opcional: `images_to_send?: string[]` (lista de product IDs). Retrocompatible: si el campo falta, el consumer lo trata como array vacío. |
| `lib/channels/types.ts` | modificado | Agregar método opcional a `ChannelClient`: `sendImage?(recipientId: string, imageUrl: string, caption?: string): Promise<boolean>`. Opcional (`?`) para no romper implementaciones existentes durante el PoC. |
| `lib/whatsapp.ts` | modificado | Implementar `sendImage`: POST a WhatsApp Cloud API con `type: "image"`, `image: { link: imageUrl, caption }`. |
| `lib/channels/instagram.ts` | modificado | Implementar `sendImage`: POST a Graph API con attachment `type: "image"`, `payload: { url: imageUrl }`. |
| `lib/channels/messenger.ts` | modificado | Implementar `sendImage`: POST a Graph API con attachment `type: "image"`, `payload: { url: imageUrl }`. |
| `app/api/send-message/route.ts` | modificado | Después de obtener `AIResponse`, iterar `images_to_send`: para cada product ID, lookup `image_url` del array de productos ya en memoria, llamar `channel.sendImage()` si el método está disponible. |
| `supabase/migrations/003_product_images.sql` | nuevo | Solo comentarios descriptivos (sin DDL). Documenta la creación manual del bucket y sus políticas RLS. |

## Contrato extendido del AI (decisión clave)

El SYSTEM PROMPT instructará a Ava: cuando mencione un producto con imagen disponible y el cliente muestra interés real (intent `interested` o `ready_to_buy`), incluir el `product_id` en `images_to_send`. El servidor valida que cada ID exista en la tabla `products` y tenga `image_url` no nulo antes de llamar a `sendImage`. Así el AI no puede fabricar URLs — solo señala IDs, y el servidor resuelve la URL authoritative desde la BD.

Ejemplo de JSON de respuesta extendida:
```json
{
  "message": "¡El Wall Cladding Nogal es una excelente opción! 🌿 Aquí te mando una foto para que veas el acabado.",
  "intent": "interested",
  "products_mentioned": ["Wall Cladding Coextruido Nogal"],
  "images_to_send": ["uuid-del-producto"]
}
```

## Resultado esperado

1. En el dashboard, el operador abre el tab "catalog", localiza un producto y sube una foto JPG/PNG/WEBP.
2. La imagen queda en Supabase Storage y `products.image_url` apunta a la URL pública.
3. Un cliente pregunta por ese producto vía WhatsApp: Ava responde con texto y envía la imagen automáticamente como mensaje separado en el mismo chat.
4. El mismo flujo funciona en Instagram y Messenger.

## Criterios de aceptación PoC

- [ ] Desde el dashboard, subir una imagen a un producto existente actualiza `products.image_url` en Supabase y la imagen es accesible en la URL pública devuelta.
- [ ] El dashboard muestra un thumbnail del producto que tiene imagen; productos sin imagen muestran el botón de carga.
- [ ] Enviar un mensaje de prueba vía `/api/send-message` (o el webhook de WhatsApp en modo test) a un producto con imagen provoca que el bot envíe primero el texto y luego la imagen como attachment separado.
- [ ] Archivos > 5 MB o con MIME no permitido son rechazados por la API route con error 400 antes de llegar a Storage.
- [ ] Productos sin imagen siguen funcionando exactamente igual que antes (Ava responde solo texto, `images_to_send` ausente o vacío).
- [ ] El bot no se rompe si `images_to_send` llega con un ID cuyo `image_url` es null (degrada a envío solo de texto).

## Fuera de scope

- Múltiples imágenes por producto (galería, ordenamiento, imagen principal).
- Compresión o redimensionamiento automático del lado del servidor.
- Envío proactivo de catálogo visual completo sin que el cliente lo pida.
- Caché CDN para las imágenes de Storage.
- UI de previsualización de imagen dentro del chat del dashboard (CRM).
- Integración con Android / notificaciones push (irrelevante en este goal).
- Configuración de umbral de intent para decidir cuándo enviar imagen (queda fijo en `interested` o `ready_to_buy` inicialmente).
