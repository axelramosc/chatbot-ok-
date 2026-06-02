# Goal 01 — App Android con push de mensajes nuevos

> ⏸️ **PAUSADO (2026-06-01).** Se retoma más adelante. El foco actual está en features del CRM/bot (ver [02-ava-command.md](02-ava-command.md)).

**Estado:** Pausado · se retomará en un momento posterior
**Owner:** axelramos
**Fecha creación:** 2026-05-27
**Última actualización:** 2026-06-01

---

## Objetivo

Tener una **app Android** que reciba una **notificación push** en tiempo real cada vez que el chatbot existente recibe un mensaje nuevo (independientemente del canal: WhatsApp, Instagram, Messenger).

> Foco exclusivo: **Android**. Desktop queda fuera de scope para este goal — se retomará en un goal posterior si aplica.

## Restricciones duras (no negociables)

1. **El chatbot actual (Next.js + Supabase + canales WhatsApp/Instagram/Messenger) NO se modifica.** Debe seguir funcionando idéntico mientras añadimos esto.
2. **Nada se implementa hasta que un PoC demuestre que el flujo end-to-end funciona.**
3. **Cero acoplamiento** entre el código de la app Android y el código del bot. La única superficie compartida es la base de datos Supabase y, opcionalmente, una Edge Function nueva.
4. **No se desactivan, mueven ni renombran** tablas, columnas, funciones, webhooks ni rutas existentes.

## Por qué este goal y no otro

El usuario es un solo desarrollador sin experiencia previa móvil. El bot ya funciona y genera valor. Tener push en Android es **la pieza de mayor valor inmediato** porque:
- Permite saber al instante cuando hay un mensaje sin tener que mirar el dashboard web.
- Es independiente de cualquier feature futura de UI (no bloquea ni es bloqueado por nada).
- Si esto funciona, el resto de funcionalidades (chat completo en app, responder desde móvil, etc.) son extensiones naturales.

## Resultado esperado

Cuando un cliente envía un mensaje al bot por cualquier canal soportado:

1. El bot lo recibe y persiste como hoy (sin cambios en su flujo actual).
2. Un mecanismo aditivo (trigger DB + Edge Function) detecta el `INSERT` en `messages`.
3. La Edge Function envía un mensaje FCM a los dispositivos registrados.
4. La app Android muestra una notificación nativa del sistema con:
   - Nombre/identificador del contacto.
   - Canal de origen (WA / IG / FB).
   - Preview del texto del mensaje (truncado).
5. Al tocar la notificación, la app abre (en esta primera fase, basta con abrir; el contenido de la pantalla es secundario).

## Arquitectura propuesta (alto nivel)

```
[Cliente WhatsApp/IG/FB]
        │
        ▼
[Webhook Next.js existente]  ──► [Supabase: messages INSERT]   ◄── No tocar
                                          │
                                          ▼  (NUEVO — aditivo)
                              [Trigger Postgres: AFTER INSERT]
                                          │
                                          ▼
                              [Edge Function fcm-push]  ──► Tabla push_devices
                                          │
                                          ▼
                                       [FCM]
                                          │
                                          ▼
                                 [App Android (Flutter)]
                                          │
                                          ▼
                                  Notificación del SO
```

**Componentes nuevos (todos aditivos):**

| Componente             | Dónde vive                                  | Función |
| ---------------------- | ------------------------------------------- | ------- |
| Tabla `push_devices`   | Supabase (nueva tabla)                      | Almacena los FCM tokens registrados por la app. |
| Trigger DB             | Supabase, sobre `messages`                  | Detecta inserts de mensajes entrantes (no salientes) y notifica a la Edge Function. |
| Edge Function `fcm-push` | Supabase Edge Functions                   | Recibe payload del trigger, consulta `push_devices`, envía a FCM via HTTP v1 API. |
| App Android (Flutter)  | `apps/mobile/` en este mismo repo           | Recibe FCM, registra su token en `push_devices`, muestra notificación. |
| Proyecto Firebase      | Externo (Firebase Console)                  | **Solo** para FCM. Gratis. No usamos Auth, Firestore, Crashlytics, ni nada más. |

## Plan de validación (PoC antes de implementar nada serio)

La regla es: **antes de escribir la app de verdad, demostrar que cada eslabón del loop funciona aislado**. Si un eslabón falla, paramos y replanteamos.

### PoC 1 — FCM funciona en una app Flutter vacía
- App Flutter mínima, solo Android.
- Integrar `firebase_messaging`.
- Conseguir el FCM token impreso en logs.
- Enviar un mensaje de prueba desde Firebase Console → ver notificación en el dispositivo.
- **Criterio de éxito:** notificación visible con la app abierta, en background, y con la app cerrada.
- **Si falla:** problema con setup de Firebase / `google-services.json` / firma debug. Solucionar antes de seguir.

### PoC 2 — Edge Function envía a FCM
- Crear Edge Function en Supabase con un endpoint HTTP simple.
- Llamada manual (curl) con un token FCM hardcodeado y un texto.
- La función llama a la FCM HTTP v1 API con credenciales de servicio Firebase.
- **Criterio de éxito:** la notificación llega al dispositivo de la PoC 1.
- **Si falla:** problema con credenciales FCM o con la Edge Function. Aislar.

### PoC 3 — Trigger DB dispara la Edge Function
- Crear tabla `push_devices` con un token de prueba.
- Crear trigger `AFTER INSERT ON messages` que llame a la Edge Function vía `pg_net` o `http`.
- Insertar manualmente un mensaje de prueba en `messages` (con un `channel_message_id` claramente identificable como "test", para borrarlo después).
- **Criterio de éxito:** la notificación llega sin intervención manual.
- **Si falla:** problema con permisos del trigger, con `pg_net`, o con la firma del payload. Aislar.
- **Limpieza obligatoria:** borrar las filas de prueba al terminar.

### PoC 4 — Loop completo con mensaje real
- Con todo lo anterior funcionando, enviar un mensaje real al bot por WhatsApp (canal de pruebas) y confirmar que la notificación llega.
- **Criterio de éxito:** llega la notificación con el contenido correcto, en menos de 5 segundos.
- **Si falla:** debug con logs. Aislar dónde se rompe el loop.

**Solo cuando los 4 PoCs pasen** consideramos validada la arquitectura y avanzamos a implementación real (UI de la app, gestión de múltiples dispositivos, gestión de errores, etc.).

## Riesgos identificados (y mitigaciones)

| Riesgo                                                       | Mitigación |
| ------------------------------------------------------------ | ---------- |
| Romper el bot al añadir el trigger DB                        | El trigger usa `AFTER INSERT` y captura excepciones internas. Nunca puede hacer rollback del insert del mensaje. Probar primero en una rama de Supabase. |
| El trigger duplica notificaciones (mensajes salientes del bot también disparan) | Filtrar en el trigger por `direction = 'inbound'` o equivalente. Documentar el filtro. |
| Costo de FCM                                                 | FCM es gratis sin límites prácticos para este volumen. Sin costo. |
| Costo de Edge Functions                                      | Supabase tiene tier gratuito generoso. Con un mensaje = 1 invocación, queda muy lejos del límite. |
| Latencia mayor a 5s                                          | Si pasa, mover el envío de push directamente al webhook Next.js (acoplamiento opcional, último recurso). |
| App Android cerrada con muchos mensajes acumulados           | FCM agrupa o entrega los últimos. Aceptable en v1. |
| Pérdida de notificaciones si FCM falla                       | En v1, aceptable. En v2 se puede añadir badge persistente o re-sync al abrir la app. |
| Permisos POST_NOTIFICATIONS en Android 13+                   | Solicitar permiso al abrir la app por primera vez. Estándar. |

## Lo que este goal NO incluye

- UI de chat dentro de la app (leer/responder mensajes en la app).
- Soporte desktop (Windows / macOS).
- iOS.
- Multi-tenant / multi-usuario (asumimos un único operador con uno o más dispositivos propios).
- Autenticación con Supabase Auth dentro de la app (la registración del FCM token puede usar un secret compartido en v1; Supabase Auth real entra en un goal posterior).
- Acciones rápidas desde la notificación (responder desde el shade).

## Decisiones tomadas

- **Bundle id Android:** `com.greenlanddeco.chatbot.mobile`.
- **Ubicación del código:** `apps/mobile/` dentro de este mismo repo (monorepo). Aísla bien y mantiene todo el contexto junto.
- **Backend:** **Supabase es el backend único** (Realtime + Auth + DB + Edge Functions). Firebase **NO** se adopta como backend.
- **Push transport:** **FCM (Firebase Cloud Messaging) sí se usa**, pero exclusivamente como transporte de notificación. Huella mínima: un proyecto Firebase con solo FCM activado. Justificación detallada abajo.
- **Cuenta Firebase:** cuenta personal de Google del usuario (axelramosc@gmail.com). Decisión tomada el 2026-05-27. Se podrá transferir a una cuenta dedicada en el futuro si hace falta (Firebase permite añadir co-owners / transferir el proyecto).

## Por qué FCM aunque queremos "todo en Supabase"

En Android no existe un canal de push del SO que no pase por FCM. Es una restricción de Google. Las alternativas son:

1. **Otros servicios (OneSignal, Pusher Beams, Airship):** todos usan FCM por debajo en Android. Suma vendors sin eliminar Firebase.
2. **Foreground Service + Supabase Realtime:** cero Firebase, pero requiere notificación persistente visible, sufre battery killers de fabricantes (Xiaomi, Samsung, Huawei), consume batería, y muere con "force stop". No viable como solución principal.

**Compromiso adoptado:** Firebase se usa **solo como cliente de FCM**. La app Android añade el paquete `firebase_messaging` y un `google-services.json`. **No se usa** Firebase Auth, Firestore, Realtime DB, Storage, Analytics, Crashlytics, ni nada más. La Edge Function de Supabase llama a la HTTP v1 API de FCM con una service account JSON guardada como secret.

Costos: FCM es gratis sin límites prácticos. Sin sorpresas de facturación.

Privacidad: si el contenido de los previews de notificación es sensible, se pueden cifrar los payloads de FCM y descifrarlos en el dispositivo. En v1 se envía el preview en claro (decisión revisable en goals posteriores).

## Preguntas abiertas

_Ninguna pendiente para iniciar PoC 1._

## Próximos pasos

1. Decidir las 3 preguntas abiertas (rápido, no bloqueante).
2. Ejecutar PoC 1 (Flutter + FCM en un proyecto desechable).
3. Ejecutar PoC 2 (Edge Function + FCM HTTP v1).
4. Ejecutar PoC 3 (trigger DB → Edge Function).
5. Ejecutar PoC 4 (mensaje real end-to-end).
6. Reescribir este documento con los aprendizajes de los PoCs y abrir Goal 02 con el plan de implementación real de la app.

## Definición de "hecho" (DoD) de este goal

- [ ] Los 4 PoCs ejecutados y pasados.
- [ ] App Android instalable (debug APK) que muestra notificaciones push reales del bot.
- [ ] Trigger DB y Edge Function desplegados en Supabase **producción** sin afectar el bot existente (verificado por al menos 24h de funcionamiento normal del bot tras el cambio).
- [ ] Documentado en este archivo cómo replicar el setup desde cero (Firebase, Supabase, Flutter).
- [ ] Plan claro de qué viene después (Goal 02).
