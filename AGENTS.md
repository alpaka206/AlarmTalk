# Agent Instructions

This repository is being converted from a React Native/Expo prototype into a native alarm product.

Read these files before making product or architecture changes:

- `docs/native-rebuild/00_GOAL.md`
- `docs/native-rebuild/01_ROADMAP.md`
- `NATIVE_REBUILD_PROMPT.md`

## Current Direction

- Android first: Kotlin + Jetpack Compose + native AlarmManager.
- iOS later: SwiftUI + AlarmKit feasibility PoC first.
- Backend reuse: keep the existing Cloudflare Workers + Hono + Turso backend as the source of API/domain reference.
- Do not rebuild the old React Native alarm runtime.

## Non-negotiable Alarm Rules

- Voice Alarm is a real alarm app, not a notification/reminder app.
- Core alarm ringing must not depend on push notifications, server cron, or live network access.
- At ring time, use local database state and local audio files only.
- Android must use OS-native alarm mechanisms and be tested on a physical device.
- iOS must not be assumed equivalent to Android until AlarmKit is proven with a PoC.
- Do not default to Critical Alert entitlement as the iOS strategy before AlarmKit limitations are documented.

## Work Order

1. Android alarm engine PoC.
2. Android local alarm CRUD and storage.
3. Android audio/voice local caching.
4. Backend sync.
5. Social voice sharing.
6. Character, streak, and billing.
7. iOS AlarmKit PoC and native implementation.

Do not start login, social, character, or billing work until the Android alarm engine is verified on a real device.

## Git Hygiene

- Use normal merge commits or regular incremental commits.
- Do not squash the implementation history unless the user explicitly asks for it.
- Prefer PRs into `develop`.
- Keep env files, generated native build outputs, logs, device dumps, local recordings, and test artifacts out of git.

