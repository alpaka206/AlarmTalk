# Voice Alarm Native Rebuild

Voice Alarm is being rebuilt as a native Android/iOS alarm app.

The existing React Native/Expo app remains in `apps/mobile` as a legacy reference. Use it for UX flow, screen behavior, copy, API usage, and design-token reference. Do not extend its alarm runtime.

Legacy mobile references that must survive before deleting `apps/mobile` are extracted in `docs/native-rebuild/09_LEGACY_REFERENCE_EXTRACT.md`.

## Read First

- `AGENTS.md`
- `NATIVE_REBUILD_PROMPT.md`
- `docs/native-rebuild/00_GOAL.md`
- `docs/native-rebuild/01_ROADMAP.md`

## Direction

- Android first: Kotlin, Jetpack Compose, AlarmManager, local audio.
- iOS later: SwiftUI + AlarmKit PoC before full parity work.
- Backend reuse: Cloudflare Workers + Hono + Turso.

## Core Rule

Voice Alarm is not a push notification app. The alarm must ring from local OS scheduling and local audio. Server cron and push notifications are not allowed in the core alarm path.

## Local Secrets

Create/fill local env files only on your machine:

- `packages/backend/.dev.vars`
- `apps/mobile/.env` for the legacy Expo app if needed
- Android native env will be added when `apps/android-native/` is created
- iOS native env will be added when `apps/ios-native/` is created

Do not commit secrets.

## Useful Commands

```bash
npm run backend
npm run typecheck
npm test
```

Android commands will be added after the native project is created.
