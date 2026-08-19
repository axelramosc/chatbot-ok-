---
name: project-conventions
description: Convenciones de código del proyecto Flutter — estilo Dart, lints, naming, estructura feature-first, commits, tests, manejo de errores y logging. Consultar antes de escribir o modificar código.
---

# Project Conventions (Flutter)

Este proyecto es una **app de chat / comunicación** construida con **Flutter** para Android + Windows + macOS. Único desarrollador. Estas convenciones priorizan claridad, herramientas estándar y reducir superficie técnica.

## Cuándo aplicar

- Antes de crear o renombrar cualquier archivo.
- Antes de abrir un PR (formato, lints, tests, mensaje de commit).
- Cuando revises código generado por otro agente.

## Estilo de código

- **Formateador:** `dart format .` (ancho de línea **100** — declarar en `analysis_options.yaml`).
- **Linter:** `package:very_good_analysis` *(recomendado para 1 dev sin experiencia — es más estricto que `flutter_lints` y previene malos hábitos)*. Activado en `analysis_options.yaml`.
- **CI obligatorio:** `dart format --set-exit-if-changed .` + `flutter analyze` deben pasar antes de mergear.
- **Reglas no negociables:**
  - Imports ordenados: dart → flutter → packages externos → relativos del proyecto (separados por línea en blanco).
  - Usar imports relativos dentro de la misma feature; absolutos (`package:app/...`) para cruzar features.
  - Sin `print()` en código de producción — usar el logger (ver más abajo).
  - `const` siempre que sea posible (constructores, widgets, listas).

## Estructura de carpetas (feature-first)

```
lib/
├── main.dart
├── app/                      # Arranque, theming, router, providers globales
│   ├── app.dart
│   ├── router.dart
│   └── theme.dart
├── core/                     # Utilidades transversales (no features)
│   ├── errors/
│   ├── logging/
│   ├── network/
│   └── platform/             # Wrappers de APIs platform-specific (push, share, intents)
├── features/
│   ├── auth/
│   │   ├── data/             # repositories, data sources, dtos
│   │   ├── domain/           # entities, use cases, contratos
│   │   └── presentation/     # widgets, screens, state (providers/notifiers)
│   ├── chat/
│   │   ├── data/
│   │   ├── domain/
│   │   └── presentation/
│   └── ...
└── shared/                   # Widgets reusables, design system, tokens
test/
└── (espejo de lib/)
integration_test/
```

- **Una feature = una carpeta** con sus tres subcapas.
- `shared/` solo para widgets/utilidades **reusados por 2+ features**. Si lo usa una sola feature, vive en esa feature.
- Plataforma-específico va en `core/platform/` con interfaz común y conditional imports cuando aplique.

## Naming conventions

| Elemento                       | Convención                  | Ejemplo                                   |
| ------------------------------ | --------------------------- | ----------------------------------------- |
| Archivos y carpetas            | `snake_case`                | `chat_message.dart`, `send_message_use_case.dart` |
| Clases, enums, typedefs, mixins| `UpperCamelCase`            | `ChatMessage`, `MessageStatus`             |
| Funciones, métodos, variables  | `lowerCamelCase`            | `sendMessage`, `currentUserId`             |
| Constantes (top-level / static)| `lowerCamelCase`            | `defaultPageSize`, `maxRetries`            |
| Privados                       | Prefijo `_`                 | `_chatRepository`, `_buildBubble()`        |
| Tests                          | `<file>_test.dart`          | `chat_message_test.dart`                   |
| Widgets stateful/stateless     | Sufijo opcional `Screen`/`Page` para nivel ruta | `ChatScreen`, `MessageBubble` |

- **Use cases:** verbo + dominio + sufijo `UseCase` → `SendMessageUseCase`, `LoadChatHistoryUseCase`.
- **Repositories:** `Auth` + `Repository` → `AuthRepository` (interface en `domain/`, impl en `data/`).

## Commits (Conventional Commits, en inglés)

Formato: `<type>(<scope>): <subject>` — sujeto en imperativo, minúsculas, sin punto final, ≤ 72 chars.

| Type      | Cuándo                                       |
| --------- | -------------------------------------------- |
| `feat`    | Nueva funcionalidad de usuario               |
| `fix`     | Bug fix                                      |
| `refactor`| Cambio interno sin afectar comportamiento    |
| `chore`   | Tooling, deps, configs, sin código de app    |
| `docs`    | Documentación únicamente                     |
| `test`    | Añadir/ajustar tests                         |
| `build`   | Cambios en build system o Gradle/Xcode/Pubspec |
| `ci`      | Cambios en pipelines de CI                   |
| `perf`    | Mejora de rendimiento                        |

Scope: nombre de feature o área. Ejemplo: `feat(chat): add message read receipts`.

Body opcional explicando el **por qué** del cambio.

## Tests

- **Unit tests:** `package:test` + `package:mocktail` para mocks. Ubicación: `test/` en espejo de `lib/`.
- **Widget tests:** `flutter_test` con `WidgetTester`. Cubrir al menos: render inicial, interacción principal, estados de error/loading.
- **Integration tests:** `package:integration_test`. Solo flujos críticos end-to-end (login → enviar mensaje → recibir respuesta).
- **Naming:**
  ```dart
  group('SendMessageUseCase', () {
    test('returns Success when repository resolves', () { ... });
    test('returns Failure.network when repository throws SocketException', () { ... });
  });
  ```
- **Cobertura:** objetivo razonable 60-70% en `domain/` y `data/`; no perseguir métricas en `presentation/` UI.
- **AAA:** Arrange / Act / Assert separados por línea en blanco dentro del test.

## Manejo de errores

- **Capa de datos:** captura excepciones de red/IO y devuelve `Result<Failure, T>` (sealed class).
- **Sealed classes (Dart 3+):**
  ```dart
  sealed class Failure {
    const Failure();
  }
  final class NetworkFailure extends Failure {}
  final class UnauthorizedFailure extends Failure {}
  final class UnknownFailure extends Failure { final Object cause; const UnknownFailure(this.cause); }
  ```
- **Capa de dominio:** opera sobre `Result`, no lanza excepciones a la presentación.
- **Capa de presentación:** mapea `Failure` → mensaje user-facing. Nunca exponer stack traces al usuario.
- **Prohibido:** `catch` vacíos, `catch (e) { print(e); }` sin manejo real, swallow de errores.

## Logging

- **Librería:** `package:logging` (core, ligero y sin dependencias). Alternativa más rica: `package:talker_flutter` para debug.
- **Configurar en `main.dart`** con un `Logger.root.level` que dependa de build mode:
  - `kDebugMode` → `Level.ALL`.
  - Release → `Level.WARNING` y reportar a crash service.
- **Niveles:** `finest/finer/fine` (verbose), `info`, `warning`, `severe`.
- **Crash reporting:** Sentry o Crashlytics, configurar en `main.dart` con `runZonedGuarded` + `FlutterError.onError`.
- **No loguear:** tokens, contraseñas, contenido de mensajes privados, PII. Si necesitas trazar un mensaje, logea su ID, no su contenido.
