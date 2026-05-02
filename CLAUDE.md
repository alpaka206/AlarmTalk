# VoiceAlarm Project Context

This repository is being converted from a React Native/Expo prototype into a native alarm product.

Claude and other coding agents must read `AGENTS.md` first, then:

- `docs/native-rebuild/00_GOAL.md`
- `docs/native-rebuild/01_ROADMAP.md`
- `NATIVE_REBUILD_PROMPT.md`

Important:

- Keep `apps/mobile` as a legacy reference for UX, flows, copy, API usage, and design tokens.
- Do not continue the old React Native/Expo alarm runtime.
- Implement the new Android app under `apps/android-native/`.
- Android is implemented first with Kotlin, Jetpack Compose, and native AlarmManager.
- iOS must be validated with a SwiftUI + AlarmKit PoC before full implementation.
- Do not assume Critical Alert entitlement is the default iOS solution.
- Do not use push notifications or server cron for core alarm ringing.

