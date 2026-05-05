# Voice Alarm Native Rebuild

Voice Alarm is being rebuilt as a native Android/iOS alarm app.

The legacy React Native/Expo app source has been removed. Preserved UX, copy, API, and design-token references live in `docs/native-rebuild/09_LEGACY_REFERENCE_EXTRACT.md`. Do not rebuild or extend the old React Native alarm runtime.

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
- Android native local configuration via ignored Gradle/local property files when needed
- iOS native env will be added when `apps/ios-native/` is created

Do not commit secrets.

## Useful Commands

```bash
npm run backend
npm run typecheck
npm test
cd apps/android-native && ./gradlew.bat :app:assembleDebug
```
