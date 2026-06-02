@AGENTS.md

# Proyecto

Este repo contiene **dos cosas** que conviven:

1. **Chatbot Next.js existente y en producción** (raíz del repo: `app/`, `lib/`, `supabase/`). Multicanal: WhatsApp, Instagram, Messenger. Persistencia en Supabase.
2. **App Android (Flutter)** — ⏸️ **pausada**, se retoma más adelante. Ver [goals/01-android-push-notifications.md](goals/01-android-push-notifications.md).

**Goal activo:** [goals/02-ava-command.md](goals/02-ava-command.md) — comando `/ava` en el inbox del CRM.

## Regla #1 — No romper el bot

El chatbot actual está en producción y **no se modifica** mientras se construye la app Android. Toda integración debe ser **aditiva** (nuevas tablas, nuevas Edge Functions, nuevos triggers) y nunca debe poder hacer rollback de operaciones del bot.

## Estructura relevante para Claude Code

```
.claude/
├── agents/            # Subagentes especializados (android-expert, etc.)
└── skills/            # Convenciones y arquitectura del proyecto
    ├── project-conventions/SKILL.md
    └── architecture/SKILL.md
goals/                 # Objetivos del proyecto (uno por archivo, numerados)
```

## Reglas obligatorias antes de escribir o modificar código

1. **Lee siempre los skills antes de proponer código:**
   - `.claude/skills/project-conventions/SKILL.md` para estilo, naming, tests, commits, logging.
   - `.claude/skills/architecture/SKILL.md` para capas, gestión de estado, DI, reglas de dependencia.
2. Si un skill tiene placeholders, **pregunta antes de inventar** convenciones.
3. Para tareas Android (UI nativa, Gradle, permisos, Play Store, CI/CD Android, performance, debugging de plataforma), delega o consulta al subagente `android-expert` (`.claude/agents/android-expert.md`).
4. Mantén los skills actualizados: cuando se tome una decisión arquitectónica o de convención, actualiza el SKILL.md correspondiente en el mismo PR.
5. **Antes de implementar cualquier feature nueva, lee el goal activo en `goals/`** y respeta su scope. Si una tarea queda fuera del goal, pregunta antes de ejecutarla.
6. **Validar antes de implementar:** para features no triviales, primero hacer un PoC pequeño que demuestre el flujo end-to-end. No se construye UI ni infraestructura completa hasta que el PoC pase.
