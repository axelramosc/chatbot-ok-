# Auditoría de seguridad — chatbot Greenland Deco

Este documento reemplaza a la memoria del subagente `qa-security-auditor`, que quedó
fuera del repo por envejecer mal: listaba como abiertos varios problemas que ya estaban
corregidos. Aquí solo se registra estado **verificado contra el código**, con su fecha.

Al cerrar o abrir un punto, actualiza la tabla en el mismo PR.

## Estado — verificado el 2026-08-18

| # | Hallazgo | Estado | Evidencia |
|---|---|---|---|
| 1 | Rutas `/api/knowledge/*` (`save-fragment`, `check-similar`, `backfill-embeddings`) sin autenticación | ✅ Cerrado | Las tres verifican sesión |
| 2 | `WHATSAPP_VERIFY_TOKEN` con fallback hardcodeado a `"default_verify_token"` | ✅ Cerrado | `app/api/webhook/route.ts:6-7` lee la variable y aborta si falta |
| 3 | Callback de auth podía caer a `SUPABASE_SERVICE_ROLE_KEY`, saltándose RLS | ✅ Cerrado | Ya no existe esa referencia en `app/api/auth/callback/route.ts` |
| 4 | La directiva de admin (`/ava`) se interpola al prompt sin sanitizar | ⚠️ Sin verificar | Riesgo aceptado en su momento por ser herramienta interna tras auth |
| 5 | `image_url` no se valida contra un origen conocido | ⚠️ Sin verificar | — |
| 6 | Respuestas de error filtran mensajes internos de Supabase | ⚠️ Sin verificar | — |
| 7 | `searchProducts` interpolaba entrada cruda en `.or()` | ✅ Cerrado | `lib/database.ts:164` escapa con `safeQuery` |
| 8 | Sin rate limiting en ninguna ruta | 🔓 **Abierto** | No existe `middleware.ts` ni throttling |
| 9 | Sin headers de seguridad (CSP, HSTS, X-Frame-Options) | ✅ Cerrado | Configurados en `next.config.ts` |
| 10 | `.env.local` en disco con secretos de producción | ✅ No aplica a git | Cubierto por `.gitignore` (`.env*`). Rotar solo si el disco se comprometió |

## Único punto abierto

**#8 — Rate limiting.** No hay middleware ni throttling. El riesgo bajó bastante desde
que las rutas de admin y de knowledge quedaron detrás de autenticación: ya no es un
vector anónimo. Queda como exposición a abuso por parte de una sesión válida y como
falta de defensa ante fuerza bruta en el login.

## Regla para rutas nuevas

Toda ruta de API nueva se revisa contra estos cuatro puntos antes de mergear:

1. Verificación de sesión con el patrón de Supabase que ya usan las rutas de admin.
2. Sin fallback a `SERVICE_ROLE_KEY` — si falta el anon key, que falle.
3. Sin tokens por defecto hardcodeados.
4. Errores hacia el cliente sin exponer detalle interno (nombres de tabla, constraints).
