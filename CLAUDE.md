# Project Context for Claude Code

This repository is being rewritten from a React Native/Expo prototype into a native voice-alarm app called **AlarmTalk**.

Claude and other coding agents must read `AGENTS.md` first, then:

- `README.md`
- `docs/README.md` (full documentation index)
- `docs/native-rebuild/00_GOAL.md`
- `docs/native-rebuild/01_ROADMAP.md`
- `NATIVE_REBUILD_PROMPT.md`

## Important

- `apps/mobile` source has been removed. Use `docs/native-rebuild/09_LEGACY_REFERENCE_EXTRACT.md` plus the current native and backend code for legacy UX, copy, API usage, and design-token references.
- Do not continue the old React Native / Expo alarm runtime.
- The new Android app lives in `apps/android-native/` (Kotlin, Jetpack Compose, native `AlarmManager`).
- iOS lives in `apps/ios-native/` (SwiftUI + AlarmKit) and must be validated with a PoC before full implementation.
- Do not assume the Critical Alert entitlement is the iOS strategy by default.
- The core alarm-ring path must not depend on push notifications or server cron.

For coding conventions, git workflow, XP rules, and security policy, see `docs/standards/README.md`.
