---
name: architecture
description: Arquitectura del proyecto Flutter — Clean Architecture pragmática, capas presentation/domain/data, gestión de estado con Riverpod, DI vía Riverpod, estrategia multiplataforma para Android/Windows/macOS, y reglas de dependencia entre capas.
---

# Architecture (Flutter)

App **complementaria** al chatbot Next.js existente. **Flutter** con foco actual **solo en Android** (desktop Windows/macOS queda como fase posterior, fuera del scope del Goal 01). No iOS, no web. Único desarrollador → arquitectura **simple pero disciplinada**: lo justo para escalar sin sobre-ingeniería.

**Restricción crítica:** el chatbot Next.js de la raíz del repo NO se modifica. Toda integración con su base de datos Supabase es **aditiva** (tablas, triggers, Edge Functions nuevas). Ver `goals/01-android-push-notifications.md`.

## Cuándo aplicar

- Antes de añadir una feature nueva (carpeta en `lib/features/`).
- Cuando dudes en qué capa colocar una clase.
- Antes de añadir una dependencia entre capas o features.
- Antes de elegir cómo manejar un nuevo tipo de estado.

## Patrón arquitectónico

**Clean Architecture pragmática** con 3 capas por feature: `presentation`, `domain`, `data`.

- **No** abstraer prematuramente: si una feature es trivial (ej. una pantalla "About"), puede tener solo `presentation/` sin `domain/` ni `data/`.
- La regla solo se aplica de manera estricta a features con lógica de negocio o I/O (chat, auth, mensajes, sync).

## Separación de capas

```
features/<feature>/
├── presentation/
│   ├── screens/           # ChatScreen, etc.
│   ├── widgets/           # Componentes propios de la feature
│   ├── controllers/       # AsyncNotifier / Notifier de Riverpod
│   └── state/             # Modelos de UiState (sealed classes)
├── domain/
│   ├── entities/          # Modelos puros (sin imports de Flutter ni paquetes de datos)
│   ├── repositories/      # Interfaces abstractas
│   └── usecases/          # Una clase por caso de uso
└── data/
    ├── dtos/              # Modelos de transporte (json, db rows)
    ├── datasources/       # Remote (API/WS), local (db, prefs)
    ├── mappers/           # DTO ⇄ Entity
    └── repositories/      # Implementación de las interfaces del domain
```

- **Presentation:** UI + estado de UI. Lee/escribe a través de use cases o repositorios expuestos por providers.
- **Domain:** sin dependencias de Flutter ni de paquetes externos. Solo `dart:core` y entidades propias. Esta capa **debe** compilarse como Dart puro.
- **Data:** implementa los contratos del domain. Aquí viven todas las dependencias hacia HTTP, WebSocket, SQLite, Firebase, etc.

## Gestión de estado

**Riverpod 2.x** con generación de código (`riverpod_generator` + `riverpod_annotation`).

**Por qué:**
- DI integrada → no necesitas otro framework (get_it, etc.).
- Testeable sin trucos: cada provider se puede sobrescribir en tests.
- Compile-safe con code-gen.
- Funciona bien para flujos asíncronos típicos de chat (streams de mensajes, paginación, estados de conexión).

**Convenciones:**
- Un controller por pantalla con estado complejo. Para estados triviales usar `StatelessWidget` + `Provider`.
- Modelar UI state como `sealed class`:
  ```dart
  sealed class ChatUiState {}
  final class ChatLoading extends ChatUiState {}
  final class ChatLoaded extends ChatUiState { final List<Message> messages; ... }
  final class ChatError extends ChatUiState { final String message; ... }
  ```
- Side effects (navegación, snackbars, system intents) se disparan desde el controller con `ref.listen` en el widget, no dentro del controller.

## Inyección de dependencias

**Riverpod hace de DI**. Reglas:

- Cada repositorio, datasource o use case se expone como un `Provider`.
- El wiring final (qué impl concreta usa cada interfaz) vive en `lib/app/providers.dart` o junto al provider de la feature.
- En tests, `ProviderContainer(overrides: [...])` para inyectar fakes.
- **Prohibido** instanciar repositorios o datasources directamente desde widgets o controllers — siempre vía `ref.read` / `ref.watch`.

## Estrategia multiplataforma (Android + Windows + macOS)

Flutter cubre la mayoría del código de forma transparente. Para integraciones específicas:

| Capacidad                          | Android                                | Windows / macOS                              | Estrategia                                    |
| ---------------------------------- | -------------------------------------- | -------------------------------------------- | --------------------------------------------- |
| Notificaciones push                | `firebase_messaging` + FCM             | `flutter_local_notifications` + servicio propio o providers desktop | Interfaz `PushService` en `core/platform/`, impl distinta por plataforma. |
| Notificaciones locales             | `flutter_local_notifications`          | `flutter_local_notifications`                | Mismo paquete, mismo código.                  |
| Deep links / App Links             | `app_links`                            | `app_links` (file/url protocols en desktop)  | Mismo paquete; configurar manifests/Info.plist/Windows registry. |
| Share intents                      | `share_plus` + `receive_sharing_intent`| `share_plus` (solo enviar)                   | Recibir share solo en Android; abstraer.      |
| Background work                    | `workmanager` (Android) o foreground service | Servicios desktop o tareas en proceso       | Encapsular en `core/platform/background/`.    |
| Almacenamiento local               | `drift` o `sqflite` + `shared_preferences` → `flutter_secure_storage` para tokens | Mismo               | Sin código específico salvo `path_provider`.  |

- Toda lógica platform-specific va detrás de una **interfaz abstracta** en `core/platform/`.
- Conditional imports (`if (dart.library.io)`) y `Platform.isAndroid` solo en `core/platform/`. **Nunca** en `domain/` ni `presentation/`.

## Reglas de dependencia (qué puede importar qué)

Las dependencias apuntan hacia adentro. El **dominio no depende de nadie**.

| Capa                       | Puede importar                          | NO puede importar                                |
| -------------------------- | --------------------------------------- | ------------------------------------------------ |
| `domain/`                  | Otras entidades del mismo domain, dart:core | Flutter SDK, paquetes de datos, presentation     |
| `data/`                    | El `domain/` de su feature, paquetes de I/O | `presentation/`, `domain/` de otras features     |
| `presentation/`            | El `domain/` de su feature, `shared/`, `core/` | `data/` directamente (siempre vía Riverpod providers) |
| `app/` (wiring)            | Todas las capas para registrar providers | —                                                |
| `core/`                    | dart, flutter, paquetes externos        | Cualquier `features/`                            |
| `shared/`                  | dart, flutter, `core/`                  | Cualquier `features/`                            |
| `features/A` → `features/B`| **Prohibido** importar directamente otra feature | —                                                |

- Comunicación entre features: a través de eventos, navegación, o providers expuestos a nivel app.
- Excepciones a estas reglas deben documentarse aquí con justificación.

## Decisiones tomadas

1. **Backend:** **Supabase** (Realtime + Auth + DB + Edge Functions). Es el backend único.
2. **Auth:** **Supabase Auth**.
3. **Push transport (Android):** **FCM**. Firebase se adopta **solo como transporte de FCM**, con huella mínima. No usamos Firebase Auth, Firestore, ni ningún otro producto Firebase. Justificación en `goals/01-android-push-notifications.md`.

## Decisiones pendientes (no bloqueantes, resolver cuando aplique)

1. **Almacenamiento local Android:** `drift` (SQL tipado, recomendado para historial de mensajes) vs `sqflite` simple vs `isar`. Recomendación inicial: **`drift`**. Decidir cuando empecemos a cachear mensajes localmente.
2. **Crash reporting:** Sentry vs Crashlytics. Recomendación inicial: **Sentry** (no nos amarra más a Firebase). Decidir antes de release a Play Store.
3. **Push en desktop (Windows/macOS):** fuera de scope del Goal 01. Cuando se retome desktop, evaluar `flutter_local_notifications` + WebSocket persistente con system tray.
