# AlarmTalk

> [English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md)

**AlarmTalk** is an OS-native voice alarm app. At the scheduled time, it rings a real alarm using a voice the user picked — a recorded one, an uploaded clip, a voice shared by family or a partner, or a voice cloned by AI.

## Why a "real" alarm

Most voice-alarm apps depend on push notifications or server cron, which can silently fail on flight mode, Doze, or weak networks. AlarmTalk rings from the OS-native alarm scheduler and plays only locally cached audio, so the ring path never needs the network.

## Status

- **Version**: `v0.1.0` (Closed Beta preparation)
- **Branch**: `develop`
- **Android**: Phase 1–6 implemented, verified on a physical device
- **iOS**: AlarmKit (iOS 26+) PoC in progress
- **Backend**: Cloudflare Workers + Hono + Turso, deployed

## Stack

| Layer | Stack |
|---|---|
| Android | Kotlin 2.0 · Jetpack Compose · Material 3 · Room · DataStore · Retrofit · WorkManager · `AlarmManager.setAlarmClock` |
| iOS (PoC) | Swift · SwiftUI · AlarmKit · ActivityKit (Live Activity) |
| Backend | TypeScript 6 · Hono 4 · Cloudflare Workers · Zod · Vitest |
| Database | Turso (libSQL / SQLite) |
| Storage | Cloudflare R2 (deterministic TTS cache) |
| Voice AI | ElevenLabs Instant Voice Clone + TTS |
| Auth | JWT (HS256, 7d) · Google ID token · Apple ID token |
| Landing | Static HTML + Tailwind CDN + Iconify (`apps/landing`) |

## Repository Layout

```
.
├── apps/
│   ├── android-native/   Kotlin + Jetpack Compose Android app
│   ├── ios-native/       SwiftUI + AlarmKit PoC
│   └── landing/          Static landing page
├── packages/
│   ├── backend/          Cloudflare Workers + Hono API
│   ├── shared/           Shared types and Zod schemas
│   ├── ui/               Design tokens
│   └── voice/            Voice-provider abstraction
└── docs/                 Project documentation
```

## Quick Start

### Backend

```bash
cd packages/backend
npm install
npm run dev        # wrangler dev
npm test           # vitest
npm run deploy     # wrangler deploy
```

Set up secrets locally in `packages/backend/.dev.vars` (never commit). See [`docs/tech/`](docs/tech/README.md) for the full list.

### Android

```bash
cd apps/android-native
./gradlew :app:assembleDebug
./gradlew :app:testDebugUnitTest
./gradlew :app:installDebug
```

If the Android SDK is not auto-detected, create an ignored `apps/android-native/local.properties` with `sdk.dir=...`.

### iOS (macOS only)

```bash
cd apps/ios-native
brew install xcodegen
xcodegen generate
open VoiceAlarmNative.xcodeproj
```

## Non-negotiable Rules

1. The alarm-ring path must use **OS-native scheduling and local audio only**. No push, no server cron, no fetch at ring time.
2. Voice AI calls (cloning, TTS) only happen on explicit user actions, never from background tasks or automated tests.
3. Voice data is only shared inside a user's family/partner group. External download is disabled by design.

## Documentation

See [`docs/README.md`](docs/README.md) for the full documentation index.

## Security

See [`SECURITY.md`](SECURITY.md) for vulnerability reporting and the supported version policy.

## License

MIT — see [`LICENSE`](LICENSE).
