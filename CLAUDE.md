# VoiceAlarm Project Context

This repository is being converted from a React Native/Expo prototype into a native alarm product.

Claude and other coding agents must read `AGENTS.md` first, then:

- `docs/native-rebuild/00_GOAL.md`
- `docs/native-rebuild/01_ROADMAP.md`
- `NATIVE_REBUILD_PROMPT.md`

Important:

- `apps/mobile` source has been removed; use `docs/native-rebuild/09_LEGACY_REFERENCE_EXTRACT.md` plus native/backend code for legacy UX, copy, API usage, and design-token references.
- Do not continue the old React Native/Expo alarm runtime.
- Implement the new Android app under `apps/android-native/`.
- Android is implemented first with Kotlin, Jetpack Compose, and native AlarmManager.
- iOS must be validated with a SwiftUI + AlarmKit PoC before full implementation.
- Do not assume Critical Alert entitlement is the default iOS solution.
- Do not use push notifications or server cron for core alarm ringing.

