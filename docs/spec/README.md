# Specifications

Functional and non-functional requirements, user stories, use cases, and feature spec for Naro.

## Priorities

- **P0** — must ship in Closed Beta
- **P1** — must ship in Open Beta
- **P2** — nice to have, can ship after public release
- **P3** — backlog

## 1. Functional Requirements

### FR-1. Authentication

| ID | Requirement | P | Status |
|---|---|---|---|
| FR-1.1 | Email/password sign-up with bcrypt hashing | P0 | ✅ |
| FR-1.2 | Email/password login with JWT issuance (7-day expiry) | P0 | ✅ |
| FR-1.3 | Google ID-token login (`requestIdToken`) | P0 | ✅ |
| FR-1.4 | Apple ID-token login (iOS required) | P1 | 🔧 backend accepts, JWKS hardening pending |
| FR-1.5 | Account deletion with cascading data removal | P1 | ✅ |
| FR-1.6 | Email verification / resend on sign-up | P2 | 🚧 |

### FR-2. Voice Profile

| ID | Requirement | P | Status |
|---|---|---|---|
| FR-2.1 | Max 2 voice profiles per user | P0 | ✅ |
| FR-2.2 | In-app voice recording (max 30 seconds, requires mic permission) | P0 | ✅ |
| FR-2.3 | Audio file upload with automatic 30-second trim on overflow | P0 | ✅ |
| FR-2.4 | ElevenLabs Instant Voice Clone | P0 | ✅ |
| FR-2.5 | Voice-profile rename and delete | P0 | ✅ |
| FR-2.6 | Read-only listing of family-group members' voice profiles | P1 | ✅ |
| FR-2.7 | Speaker diarization on uploaded files | P2 | ✅ backend / 🚧 UI |
| FR-2.8 | Voice asset storage on Cloudflare R2 | P1 | ✅ |

### FR-3. Alarm

| ID | Requirement | P | Status |
|---|---|---|---|
| FR-3.1 | Create alarm with time (HH:mm), repeat days (0–6), and label | P0 | ✅ |
| FR-3.2 | Edit, delete, and active toggle | P0 | ✅ |
| FR-3.3 | Modes: `alarm_only` / `voice_only` / `alarm_voice` | P0 | ✅ |
| FR-3.4 | Snooze settings (1, 3, 5, 10 minutes) and snooze action | P0 | ✅ |
| FR-3.5 | Vibration pattern: default / strong / none | P1 | ✅ |
| FR-3.6 | Holiday auto-skip (Korean public-holiday calendar, computed locally) | P2 | ✅ |
| FR-3.7 | Alarm copy (reuses cached local audio) | P2 | ✅ |
| FR-3.8 | Rings reliably on Doze, lock screen, and flight mode | P0 | ✅ |
| FR-3.9 | Boot restore through `BootCompletedReceiver` | P0 | ✅ |
| FR-3.10 | Manual server sync of alarm metadata | P1 | ✅ |

### FR-4. TTS & Messaging

| ID | Requirement | P | Status |
|---|---|---|---|
| FR-4.1 | Voice profile + text → TTS audio | P0 | ✅ (ElevenLabs) |
| FR-4.2 | Deterministic cache by (profile, text, language, provider) | P0 | ✅ |
| FR-4.3 | Response returns base64 + R2 key + message id | P0 | ✅ |
| FR-4.4 | Android side caches in app-private storage; ring uses local file | P0 | ✅ |
| FR-4.5 | Public preset messages (categories and languages) | P1 | ✅ |
| FR-4.6 | Message library (received, favorites, category filter) | P2 | ✅ |

### FR-5. Social (friend / family / code)

| ID | Requirement | P | Status |
|---|---|---|---|
| FR-5.1 | Friend request by email, accept/decline/delete | P1 | ✅ |
| FR-5.2 | Family / couple group creation, max 6 members | P0 | ✅ |
| FR-5.3 | 6-digit invite code (10-minute TTL, single-use) | P0 | ✅ |
| FR-5.4 | Code entry → group join / leave / forced removal | P0 | ✅ |
| FR-5.5 | Ownership transfer (owner-only) | P1 | ✅ |
| FR-5.6 | Voucher code `VA-XXXX-XXXX-XXXX` → subscription | P1 | ✅ |
| FR-5.7 | Family alarm (schedule an alarm on another member's device) | P1 | ✅ backend / 🚧 mobile UI |
| FR-5.8 | Family notes (500-character text, same group only) | P2 | ✅ |

### FR-6. Character, Streak, XP

| ID | Requirement | P | Status |
|---|---|---|---|
| FR-6.1 | 4-stage character (egg / chick / chicken / golden chicken) | P1 | ✅ |
| FR-6.2 | XP daily cap of 200; idempotency by client nonce | P1 | ✅ |
| FR-6.3 | Event-based XP map (`alarm_completed=5`, `alarm_snoozed=-5`, `alarm_dismissed=-5`, ...) with no XP/level downgrade below floor | P1 | ✅ |
| FR-6.4 | Wake-up streak with 7 / 30 / 90-day milestones | P1 | ✅ |
| FR-6.5 | Three stat dimensions (`diligence` / `health` / `consistency`) | P2 | ✅ |

### FR-7. Billing & Plan

| ID | Requirement | P | Status |
|---|---|---|---|
| FR-7.1 | Four tiers: free / personal / couple / family | P1 | ✅ |
| FR-7.2 | Checkout stub (mock PG) | P2 | ✅ |
| FR-7.3 | Cron-driven subscription expiry → auto plan downgrade | P1 | ✅ |
| FR-7.4 | Real-payment integration (Toss / Apple IAP / Google Play Billing) | P0 before launch | 🚧 |

### FR-8. Operations & Observability

| ID | Requirement | P | Status |
|---|---|---|---|
| FR-8.1 | Structured logging (method, path, status, duration) | P1 | ✅ |
| FR-8.2 | Sentry error tracking (no-op when DSN unset) | P1 | ✅ |
| FR-8.3 | Migration batches (Workers free-plan subrequest limits) | P1 | ✅ |
| FR-8.4 | `users.last_active_at` auto-update | P2 | ✅ |

## 2. Non-Functional Requirements

### Reliability

- Alarm miss rate must converge to 0%. Verified by a 100-trial run on a physical device (currently Samsung Galaxy A32 / Android 13).
- Alarms must ring on flight mode / weak network.
- Boot restore must re-register all active scheduled alarms.

### Performance

- API p95 < 500 ms on Cloudflare edge.
- App cold start < 3 s on mid-range Android (Pixel 6 / Galaxy A32 baseline).
- Deterministic cache hit → no ElevenLabs call for repeat inputs.

### Security

- Passwords bcrypt-hashed (cost ≥ 10).
- All secrets are Cloudflare Worker secrets — never in the client.
- Rate limit: 60 requests / minute / IP.
- Body limit: 512 KB.
- CORS allowlist enforced.
- Input validation via Zod at every route.
- OWASP Top 10 review before public launch.
- Security response headers (`X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, etc.) on every response.

### Accessibility

- Text contrast ≥ 4.5:1 (WCAG AA).
- All touch targets ≥ 44×44 dp.
- All Compose components have `contentDescription`.
- Dark mode supported across all screens.

### Internationalization

- Korean is the base locale.
- English required at public launch.
- Japanese in Phase 2.

### Compatibility

- Android: `minSdk = 26` (Android 8.0), `targetSdk = 35`.
- iOS: 18+ for AlarmKit (PoC) / 26+ for production AlarmKit features.
- Form factor: 5.5"–6.8" phones. Tablets and foldables are post-launch.

### Cost discipline

- Stay within Cloudflare Workers free-plan daily request budget for non-production traffic.
- Monitor Turso row-read budget weekly.
- ElevenLabs spend gated by per-plan daily TTS caps and deterministic caching.

## 3. User Stories (excerpt)

User stories are written in the form `As a <role>, I want <capability>, so that <value>`.

- **US-A1 (P0)**: As a new user, I want to sign up with email/password and reach the alarm list within one screen, so I can set my first alarm quickly.
- **US-A2 (P0)**: As an Android user, I want one-tap Google sign-in, so I don't have to type credentials.
- **US-B1 (P0)**: As someone who wants my own voice, I want to record up to 30 seconds in-app and get back a ready-to-use voice profile, so I don't need an external recording tool.
- **US-B2 (P0)**: As someone who already has audio files, I want to upload them and get automatic 30-second trim with retry guidance on failure, so I don't lose progress on long files.
- **US-C1 (P0)**: As an alarm creator, I want a single screen with time, days, and label, so I don't switch contexts.
- **US-C2 (P0)**: As a user, I want to choose between three play modes with clear help text so I know what each one does.
- **US-D1 (P0)**: As someone who sleeps deeply, I want my alarm to ring full-screen even on lock screen and Doze.
- **US-D2 (P0)**: As a traveler, I want my alarm to ring on flight mode using only local audio.
- **US-D3 (P0)**: As a snoozer, I want snooze to register the next alarm with exact timing.
- **US-E1 (P0)**: As a family owner, I want to generate a 6-digit invite code (10-minute TTL) and send it via any chat app.
- **US-E2 (P0)**: As an invitee, I want a deep link that fills the code automatically; the code is single-use within 10 minutes.

A longer list with acceptance criteria belongs in the team's issue tracker. This document captures the priority bucket and the must-ship intent.

## 4. Use Case (UC-1: create a voice-only alarm)

- **Actor**: authenticated user
- **Preconditions**: at least one ready voice profile; notifications, exact-alarm, and full-screen-intent permissions granted; microphone permission granted if needed
- **Trigger**: user taps the "+" button in the alarm list
- **Main flow**
  1. App opens `AlarmEditorScreen`.
  2. User picks time, repeat days, and label.
  3. User selects mode = `voice_only`.
  4. User picks audio source = `Voice Profile`.
  5. User selects voice profile and types the message (or picks a preset).
  6. User taps save.
  7. Android calls `POST /api/tts/generate`.
  8. Backend checks the deterministic cache; on miss, calls ElevenLabs and stores the result in R2.
  9. Backend returns base64 + cache key + R2 key + message id.
  10. Android decodes and writes to app-private storage with a stable local cache key.
  11. Room inserts the alarm. `AlarmScheduler` registers the next fire time via `AlarmManager.setAlarmClock`.
- **Alternate flow A**: cache hit. Step 8 returns immediately from R2, no provider call.
- **Alternate flow B**: audio source = `Record/File`. The user records up to 30 seconds or picks an audio file (auto-trimmed). No provider call.
- **Exception flows**
  - No voice profile → redirect to voice-profile creation.
  - `SCHEDULE_EXACT_ALARM` denied → permission gate with deep link.
  - ElevenLabs failure → user message; alarm save is held.
- **Postconditions**: row inserted in `alarms`, OS alarm registered, next fire time visible in the list.

## 5. Feature Spec (selected modules)

### F-01. Android alarm engine

- Source: `apps/android-native/app/src/main/java/com/voicealarm/nativeapp/alarm/*` and `ringing/RingingActivity.kt`
- Inputs: alarm id, next fire time, mode, local audio cache key, vibration pattern, snooze minutes
- Process:
  1. `AlarmScheduler.schedule(...)` calls `AlarmManager.setAlarmClock(...)`.
  2. At fire time, `AlarmReceiver` starts `RingingService` (foreground).
  3. `RingingNotificationFactory` creates a high-importance channel with a full-screen intent.
  4. `RingingActivity` shows over the lock screen as a single, non-resizeable task.
  5. `MediaPlayer` plays the mode-specific audio in a loop.
  6. `Vibrator` repeats the configured pattern.
- Constraints: `SCHEDULE_EXACT_ALARM`, `POST_NOTIFICATIONS`, and `USE_FULL_SCREEN_INTENT` permissions are mandatory.

### F-04. TTS generation + caching

- Source: `packages/backend/src/routes/tts.ts`, `lib/audio-cache.ts`, `lib/voice-provider.ts`
- Cache key: `sha256(voice_profile_id | text | language | provider)`
- Cache hit → R2 GET → base64 response.
- Cache miss → provider chain (Perso direct → ElevenLabs) → mp3 bytes → R2 PUT → `generated_audio` insert → base64 response.
- Provider chain currently falls through Perso (no direct voice-clone TTS API yet) to ElevenLabs.

### F-06. Family invite code

- Source: `packages/backend/src/routes/family.ts`, `lib/invites.ts`
- 6-digit numeric code, unique, 10-minute TTL, single-use.
- States: `pending` / `used` / `revoked` / `expired`. Lazy expiry on read; no batch job.
- Issue: owner only. Revoke: issuer only, `pending` only. Self-invite blocked. Group capacity enforced.

(Other feature modules follow the same shape and live alongside their source code.)

## 6. Constraints

- Alarm ring path: OS-native + local audio only. No push, no server cron, no fetch at ring time.
- External voice-AI calls only on explicit user actions. Automated QA and tests must not trigger them.
- Voice data: shared only inside a user's family/partner group. External download blocked.
- Environment files (`.env`, `.dev.vars`, `local.properties`, signing keys) are never committed.
