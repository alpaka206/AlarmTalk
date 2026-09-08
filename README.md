# AlarmTalk

> [English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md)

**AlarmTalk** is an OS-native voice alarm app. At the scheduled time, it rings a real alarm using a voice the user picked — a recorded one, a voice shared by family or a partner, or a voice cloned by AI.

## Why a "real" alarm

Most voice-alarm apps depend on push notifications or server cron, which can silently fail on flight mode, Doze, or weak networks. AlarmTalk rings from the OS-native alarm scheduler and plays only locally cached audio, so the ring path never needs the network.

## Status

- **Version**: `v1.2.5` (versionCode 25) — live on Google Play
- **Android** — the shipping client; core alarm engine verified on physical devices:
  - Free tier: system voices with pre-rendered alarm preset clips, rotated locally on each dismiss (bucket rotation)
  - Paid tier: AI-cloned voice presets pre-rendered server-side after an explicit "keep", played fully offline at ring time — offline (flight-mode) ring pending device QA
  - Family alarms delivered to members instantly via FCM data push (the ring itself stays local — see rule #1) — background delivery pending device QA
  - Google Play Billing: live — monthly subscriptions only (Personal / Couple / Family)
- **Backend**: Cloudflare Workers + Hono + Turso — CI auto-deploys with DB migrations (`develop` → dev, `main` → prod)

The SwiftUI iOS client (`apps/ios-native`) was revived on 2026-08-06 and lives in this repository, but it is not on the App Store yet and its CI workflow has not been restored. Build it with XcodeGen (`project.yml` → `AlarmTalkNative.xcodeproj`); see [`docs/ios/`](docs/ios/).

## Stack

| Layer | Stack |
|---|---|
| Android | Kotlin 2.0 · Jetpack Compose · Material 3 · Room · DataStore · Retrofit · WorkManager · `AlarmManager.setAlarmClock` |
| Backend | TypeScript 7 · Hono 4 · Cloudflare Workers · Zod · Vitest |
| Database | Turso (libSQL / SQLite) |
| Storage | Cloudflare R2 (deterministic TTS cache) |
| Voice AI | ElevenLabs — Instant Voice Clone + TTS |
| Auth | JWT (HS256, 365d TTL · rolls on each launch once under 90d left) · email code · Google ID token · Apple ID token |
| Landing | Next.js (App Router) + next-intl + Tailwind v4 (`apps/landing`) |

## Repository Layout

```
.
├── apps/
│   ├── android-native/   Kotlin + Jetpack Compose Android app
│   ├── ios-native/       SwiftUI iOS app (XcodeGen; not yet released)
│   └── landing/          Next.js landing page (static export)
├── packages/
│   ├── backend/          Cloudflare Workers + Hono API
│   ├── shared/           Shared types and Zod schemas
│   └── voice/            Voice-provider abstraction
└── docs/                 Project documentation
```

## Quick Start

### Backend

```bash
cd packages/backend
npm install
npm run dev        # wrangler dev --env dev --env-file .dev.vars.dev
npm test           # vitest
npm run deploy     # wrangler deploy --env production (CI deploys automatically on push)
```

Set up local secrets in ignored files: `packages/backend/.dev.vars.dev` and `packages/backend/.dev.vars.prod`. The authoritative list is the `Env` interface in `packages/backend/src/types.ts`; see [`docs/ops/environments.md`](docs/ops/environments.md) for how they differ per environment.

### Android

The app has `dev`/`prod` product flavors; the `dev` flavor (`com.alarmtalk.app.dev`) targets the dev backend.

```bash
cd apps/android-native
./gradlew :app:assembleDevDebug
./gradlew :app:testDevDebugUnitTest
./gradlew :app:installDevDebug
```

If the Android SDK is not auto-detected, create an ignored `apps/android-native/local.properties` with `sdk.dir=...`.

## Non-negotiable Rules

1. The alarm-ring path must use **OS-native scheduling and local audio only**. No push, no server cron, no fetch at ring time.
2. Voice cloning and one-off TTS start only from explicit user actions. After the user previews a private draft and explicitly keeps it, that single action may authorize one fixed, bounded, durable background job to render the documented preset manifest. No autonomous scans or unbounded AI work are allowed, and automated tests always stub paid providers.
3. Voice data is only shared inside a user's family/partner group. External download is disabled by design.

## Documentation

See [`docs/README.md`](docs/README.md) for the full documentation index.

## Security

See [`SECURITY.md`](SECURITY.md) for vulnerability reporting and the supported version policy.

## License

MIT — see [`LICENSE`](LICENSE).
