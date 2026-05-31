# Agent Instructions

This repository is being rewritten from a React Native/Expo prototype into a native voice-alarm app.

Coding agents must read these files before making product or architecture changes:

- `README.md`
- `docs/README.md` — full documentation index
- `docs/product/README.md`
- `docs/spec/README.md`
- `docs/tech/README.md`
- `docs/standards/README.md`

## Current Direction

- **Android first**: Kotlin + Jetpack Compose + native `AlarmManager`.
- **iOS later**: SwiftUI + AlarmKit. Run a feasibility PoC first; do not assume Critical Alert entitlement is the answer until AlarmKit limits are documented on physical iOS 26+ devices.
- **Backend reuse**: keep the existing Cloudflare Workers + Hono + Turso backend as the API and domain reference.
- **Legacy app reference**: the old `apps/mobile` source has been removed. Use the current native app, backend code, and docs as references. Do not rebuild or extend the old React Native alarm runtime.

## Non-negotiable Alarm Rules

- AlarmTalk is a real alarm app, not a notification/reminder app.
- The core alarm-ring path must not depend on push notifications, server cron, or live network access.
- At ring time, the app uses local database state and local audio files only.
- Android must use OS-native alarm mechanisms and be verified on a physical device.
- iOS must not be assumed equivalent to Android until AlarmKit is proven with a PoC.
- Do not default to Critical Alert entitlement as the iOS strategy before AlarmKit limitations are documented.

## Work Order

1. Android alarm engine PoC
2. Android local alarm CRUD and storage
3. Android audio/voice local caching
4. Backend sync
5. Social voice sharing
6. Character, streak, and billing
7. iOS AlarmKit PoC and native implementation

Do not weaken the verified Android alarm engine while extending login, social, character, or billing features.

## Git Hygiene

- Use normal merge commits or regular incremental commits.
- Do not squash the implementation history unless explicitly asked.
- Prefer PRs into `develop`.
- Keep env files, generated native build outputs, logs, device dumps, local recordings, and test artifacts out of git.

See `docs/standards/README.md` for the full coding, git, and security conventions.
