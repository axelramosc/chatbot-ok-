# Goal 02 — Comando `/ava` en el inbox (órdenes privadas a Ava)

**Estado:** En curso · Fase 1 (PoC texto) implementada, pendiente de validación end-to-end
**Owner:** axelramos
**Fecha creación:** 2026-06-01
**Última actualización:** 2026-06-01

---

## Objetivo

Que el equipo pueda escribir `/ava <instrucción>` en el input del chat del CRM para
darle una **orden privada a Ava** sin que el cliente la vea. Dos usos:

1. **Aclarar contexto:** explicarle a Ava a qué se refiere el cliente.
2. **Ordenar el envío de una foto** (de catálogo o, en Fase 2, una imagen adjunta).

Ava genera y envía **su respuesta al cliente al instante**, tratando la orden como
instrucción de máxima prioridad. **El bot sigue activo** (a diferencia de un mensaje
normal, que lo pausa).

## Decisiones de producto (confirmadas con el owner)

- **Acción:** Ava responde ya, al instante.
- **Estado del bot:** sigue activo; si estaba pausado, `/ava` lo reactiva.
- **Fotos:** catálogo (vía `images_to_send`) **y** subida manual.
- **Visibilidad:** la orden queda como **nota interna** visible solo para el equipo,
  nunca se envía al cliente.

## Diseño (aditivo — Regla #1: no romper el bot)

- `lib/ai.ts` → `generateResponse` admite `adminDirective?` opcional (sin él, el bot se
  comporta igual que siempre). `buildMessageHistory` filtra las notas `[AVA-CMD]`.
- `app/api/ava-command/route.ts` (nuevo) → guarda nota interna, asegura `status:"active"`,
  arma contexto, llama a `generateResponse` con la directiva, manda texto e imágenes.
- `lib/channel-router.ts` → `routeAdminImage` (WhatsApp/Messenger/Instagram).
- `app/dashboard/page.tsx` → rama `/ava` (no pausa) + render de nota interna morada.

## Fases

- **Fase 1 — PoC texto + fotos de catálogo** ✅ implementada. Validar en vivo:
  - `/ava dile que el rústico es el Nogal`
  - `/ava manda la foto del Wall Cladding`
- **Fase 2 — Imagen adjunta manual** ✅ implementada:
  - `app/api/ava-command/upload/route.ts`: sube a `product-images/ava-adhoc/...` (bucket público) y devuelve la URL.
  - Dashboard: botón 📎 + preview de la imagen pendiente + envío con `image_url` vía `/api/ava-command`.
  - El endpoint, al recibir `image_url`, hace que Ava escriba solo un texto breve y envía la imagen por separado (no toca `images_to_send`).

## Criterio de validación (Fase 1)

1. `/ava ...` no aparece nunca en el lado del cliente (verificar en el canal real).
2. La nota interna se ve en el inbox con estilo diferenciado.
3. Ava responde al cliente al instante respetando la orden.
4. El bot queda `active` tras el comando.
5. El flujo normal del bot (sin `/ava`) no cambia en absoluto.
