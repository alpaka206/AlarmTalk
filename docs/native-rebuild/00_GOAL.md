# Voice Alarm Native Rebuild Goal

Voice Alarm is being rebuilt as a native Android/iOS alarm product.

The completion target is not "the app compiles." The target is that the core MVP features actually work on real devices:

- normal alarm
- voice alarm
- original recorded audio alarm
- voice profile registration
- direct recording
- file upload with 30-second crop/limit
- Perso.ai voice cloning
- TTS message generation
- preset/random message themes
- alarm only / voice only / alarm + voice play modes
- repeat weekdays
- snooze
- vibration
- login and account flow
- backend sync
- local audio caching
- invite-code based family/partner connection
- shared partner/family voice selection
- character growth, streak, and XP
- subscription/plan limits

Non-negotiable behavior:

- This is a real alarm app, not a notification/reminder app.
- Core alarm ringing must not depend on push notifications or server cron.
- Alarm ringing must be driven by OS-native alarm mechanisms and local audio.
- At ring time, the app must use local database state and local audio only, with no network fetch requirement.
- Android is implemented first with Kotlin and Jetpack Compose.
- iOS is implemented later with SwiftUI, but an AlarmKit feasibility PoC must happen early.
- Do not assume iOS can exactly copy Android until AlarmKit behavior is documented.

Historical legacy stack captured in the reference extract:

- Mobile reference: React Native, Expo SDK 54, expo-router
- Backend: Cloudflare Workers, Hono, Turso/libSQL
- Storage: Cloudflare R2 for voice files
- Voice AI: Perso.ai primary, ElevenLabs secondary
- Auth: app-issued JWT + email/password with bcrypt
- Push: FCM/APNs through expo-notifications and server-side token management
- Monitoring: Sentry mobile and backend
- Billing: stubbed entitlement/code-based plan flow
- Font: Pretendard
- Tests: Vitest, Jest, Maestro

Use `docs/native-rebuild/09_LEGACY_REFERENCE_EXTRACT.md`, `packages/ui`, native code, and backend contracts as references for UX, copy, API behavior, and design tokens. The old `apps/mobile` source has been removed and must not be rebuilt as an alarm runtime.
