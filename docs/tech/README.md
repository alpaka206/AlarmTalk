# Technical Reference

System architecture, database schema, and HTTP API for AlarmTalk.

> 백엔드 correctness/보안 리뷰에서 나온 결정 필요·권장 항목은 [`backend-findings.ko.md`](backend-findings.ko.md) 참고.

## 1. System Architecture

### High-level

```
┌─────────────────────────────────────────────────────────────────┐
│                           CLIENTS                                │
│  Android (Kotlin/Compose)   iOS PoC (SwiftUI/AlarmKit)  Landing │
└─────────────┬───────────────────────┬──────────────────────┬────┘
              │ HTTPS                  │                      │
              ▼                        ▼                      ▼
┌────────────────────────────────────────────────────────────────┐
│              Cloudflare Workers — voice-alarm-api                │
│ securityHeaders → sentry → logger → rateLimit → bodyLimit      │
│              → cors → auth (for /api/*) → cache                │
│                                                                 │
│ Routes: /auth /user /voice /tts /alarm /friend /family         │
│         /code /billing /library /dub /notes /stats             │
│ Cron:   */5 * * * *  (subscription expiry, account purge, …)   │
└──────────┬──────────────────┬─────────────────┬─────────────────┘
           │                  │                 │
           ▼                  ▼                 ▼
   ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐
   │ Turso libSQL │  │ Cloudflare R2│  │ External APIs        │
   │ domain tables│  │ voice + tts  │  │ ElevenLabs           │
   │ 62 migrations│  │ objects      │  │ Google JWKS          │
   └──────────────┘  └──────────────┘  │ Apple JWKS           │
                                       │ Sentry               │
                                       └──────────────────────┘
```

### Layer boundaries (Android — `apps/android-native`)

| Layer | Package | Responsibility |
|---|---|---|
| UI | `ui/*` | Compose screens, components, theme |
| Domain (alarm) | `alarm/*`, `ringing/*` | AlarmReceiver, Scheduler, RingingService, RingingActivity |
| Data | `data/*` | Room, DAOs, repositories, audio store, sync services |
| Network | `network/*` | Retrofit API clients, session store |
| Sync | `sync/*` | WorkManager workers |
| Core | `core/*` | Logging, environment |

### Layer boundaries (Backend — `packages/backend`)

| Layer | Package | Responsibility |
|---|---|---|
| Entry | `src/index.ts` | Hono app, middleware chain, cron |
| Routes | `src/routes/*` | HTTP endpoints |
| Middleware | `src/middleware/*` | Auth, rate limit, logging, security headers |
| Lib (domain) | `src/lib/*` | Pure functions, DB adapters, external providers |
| Data | `src/data/*` | Seed data (presets) |

### Workspace packages

- `packages/shared` — shared types and Zod schemas
- `packages/ui` — color / type / spacing design tokens
- `packages/voice` — voice-provider interface and adapters

### Alarm-ring path (offline by design)

```
Save alarm
  └─ AlarmRepository.save() → Room
  └─ AlarmScheduler.schedule() → AlarmManager.setAlarmClock(...)

At fire time
  └─ OS calls AlarmReceiver.onReceive()

AlarmReceiver
  └─ startForegroundService(RingingService)

RingingService
  ├─ AlarmAudioStore.loadCachedAudio(alarmId)
  ├─ MediaPlayer.start() (loop)
  ├─ Vibrator.vibrate(pattern, repeat)
  └─ RingingNotificationFactory.create(highImportance, fullScreenIntent)

RingingActivity
  ├─ showWhenLocked / turnScreenOn
  ├─ Dismiss → service stop, enqueue "alarm_completed"
  └─ Snooze → schedule(now + Δ), enqueue "alarm_snoozed"
```

No network call happens on this path. Pre-launch QA verifies this with `adb shell cmd connectivity airplane-mode enable`.

### Manual server sync (when the user taps "Sync now")

```
[Android UI Sync]
  └─ WorkManager.enqueueOneTimeWork(RemoteAlarmSyncWorker)
        └─ AlarmSyncService.pushDirty()
              ├─ POST /api/alarm
              ├─ PATCH /api/alarm/:id
              └─ DELETE /api/alarm/:id
        └─ RemoteAlarmPullSyncService.pull()
              ├─ GET /api/alarm
              └─ reconcile(remote, local) → Room
        └─ Result.success → snackbar
```

### External services

| Service | Role | Coupling |
|---|---|---|
| Cloudflare Workers | API + cron | HTTP, ScheduledEvent |
| Turso libSQL | Primary DB | libSQL HTTP client |
| Cloudflare R2 | Object store (voice / TTS) | Workers binding `VOICE_BUCKET` |
| ElevenLabs | Voice clone + TTS | HTTPS REST |
| Google JWKS | ID token verification | HTTPS |
| Apple JWKS | Sign in with Apple ID token signature verification | HTTPS |
| Sentry | Error capture | toucan-js (server) + Android client SDK (DSN-gated) |

### Failure domains

| Failure | Alarm ring impact | Other impact |
|---|---|---|
| Cloudflare Workers down | None | Sign-in, sync, TTS generation paused |
| Turso down | None | API 500, sync paused |
| R2 down | None (mostly cache-hit locally) | TTS generation fails on miss |
| Voice provider down | None | New TTS generation fails |
| Device-side Room corruption | Possible partial loss | Recoverable through server sync |

### Architecture Decision Records (ADR — summarized)

| Date | Decision | Why |
|---|---|---|
| 2025-12 | Rewrite from React Native/Expo to native | Alarm reliability could not be guaranteed under push/Expo notifications. |
| 2026-02 | Android first | Only Android physical-device testing was available at that time. |
| 2026-03 | ElevenLabs as the active voice provider | Use one proven Instant Voice Clone + TTS provider while keeping deterministic caching to control spend. |
| 2026-04 | 6-digit family invite code + deep-link hybrid | Works without collecting email; can be shared offline by voice; 10-minute TTL mitigates brute force. |
| 2026-05 | Deterministic TTS caching | Same profile + text + language always maps to the same R2 object, eliminating duplicate cost. |

### Deployment

| Target | Command / tool |
|---|---|
| Backend dev | `npm run deploy:dev --workspace=backend` (wrangler) |
| Backend production | `npm run deploy:prod --workspace=backend` (wrangler) |
| Android | `./gradlew :app:bundleRelease` → Play Console internal track |
| iOS | Xcode → TestFlight (macOS workstation) |
| Landing | Static deploy (Cloudflare Pages or any static host) |

Backend secrets are managed as Cloudflare Worker secrets:

- `JWT_SECRET`
- `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`
- `ELEVENLABS_API_KEY`
- `SENTRY_DSN`
- `GOOGLE_CLIENT_ID`, `APPLE_CLIENT_ID`

R2 binding: `VOICE_BUCKET → voice-alarm-voices` in dev and `VOICE_BUCKET → voice-alarm-voices-prod` in production.

Turso must also be split by environment:

- dev Worker `voice-alarm-api-dev` uses a dev-only `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`.
- production Worker `voice-alarm-api` uses a production-only `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`.
- Store local values in ignored files: `packages/backend/.dev.vars.dev` and `packages/backend/.dev.vars.prod`.
- Sync secrets with `npm run secrets:sync:dev --workspace=backend` and `npm run secrets:sync:prod --workspace=backend`.
- After creating a fresh DB, run migrations with `POST /api/init-db`. In production, include `x-init-db-secret`.
- CI deploys and migrates dev from `develop`, and deploys and migrates production from `main`.

Cron: `*/5 * * * *` (5-minute interval) handles subscription expiry and downgrade.

## 2. Database

- **DB**: Turso (libSQL / SQLite)
- **Tables**: domain tables plus the `_migrations` ledger
- **Migrations**: 62, defined in `packages/backend/src/lib/migrations.ts`

### Entity overview

```
                                  users
                                    │
             ┌────────────┬────────────────────────────────────┐
             ▼            ▼                                    ▼
      voice_profiles    alarms (target_user_id=user)       friendships
             │            │                                    │
             ├──── messages ── message_library              gifts
             │            │
             │            └── alarms.voice_profile_id
             │
             └─ voice_uploads ── voice_speakers

users ── push_tokens   notes (sender/receiver)
users ── subscriptions ── plans ── voucher_codes
users ── plan_group_members ── plan_groups ── plan_group_invites
users ── dub_jobs
```

### Tables

| # | Table | Purpose | Key relationships |
|---|---|---|---|
| 1 | `users` | Account, plan, settings | many-to-many |
| 2 | `voice_profiles` | Voice profile (≤ 2 per user) | `users 1:1..2` |
| 3 | `voice_uploads` | Raw uploaded audio | `users 1:N` |
| 4 | `voice_speakers` | Speaker-diarization output | `voice_uploads 1:N` |
| 5 | `messages` | TTS message | `voice_profiles 1:N` |
| 6 | `message_library` | Inbox / saved messages | `users ⊣ messages` |
| 7 | `generated_audio` | Deterministic TTS cache | `messages 1:1` |
| 8 | `alarms` | Alarm metadata | `users ⊣ voice_profiles ⊣ messages` |
| 9 | `friendships` | Friends | `users × users` |
| 10 | `gifts` | Gift messages | `users × users × messages` |
| 11 | `plans` | Plan master (free/personal/family) | seed |
| 12 | `subscriptions` | Subscriptions | `users · plans · plan_groups` |
| 13 | `voucher_codes` | Voucher codes | `plans · users(issuer)` |
| 14 | `plan_groups` | Family/couple group | `users(owner)` |
| 15 | `plan_group_members` | Group membership | `plan_groups · users` |
| 16 | `plan_group_invites` | 6-digit invite codes | `plan_groups · users(issuer/redeemer)` |
| 17 | `push_tokens` | FCM / APNs tokens (legacy, ring path does not use them) | `users · platform` |
| 18 | `notes` | Text notes | `users × users` |

`dub_jobs` also exists for dubbing workflow but is not surfaced in the native app.

### Key constraints

- `voice_profiles` at most 2 per user — enforced at the route layer with COUNT.
- `plan_group_invites.code` UNIQUE, 10-minute TTL, lazy `expired` transition on read.
- Risk-of-rollback flows (subscription, voucher redemption, ownership transfer) use BEGIN/COMMIT through `lib/transactions.ts`.

### Selected DDL

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  google_id TEXT,
  apple_id TEXT,
  email TEXT NOT NULL,
  password_hash TEXT,
  name TEXT,
  picture TEXT,
  plan TEXT NOT NULL DEFAULT 'free',
  daily_tts_count INTEGER DEFAULT 0,
  daily_tts_reset_at TEXT,
  allow_family_alarms INTEGER DEFAULT 0,
  last_active_at TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_users_email ON users(email);
CREATE UNIQUE INDEX idx_users_google_id
  ON users(google_id) WHERE google_id IS NOT NULL;

CREATE TABLE alarms (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  target_user_id TEXT REFERENCES users(id),
  message_id TEXT REFERENCES messages(id),
  time TEXT NOT NULL,                          -- 'HH:mm'
  repeat_days TEXT NOT NULL DEFAULT '[]',      -- '[0,1,2,...]'
  is_active INTEGER NOT NULL DEFAULT 1,
  snooze_minutes INTEGER NOT NULL DEFAULT 5,
  mode TEXT NOT NULL DEFAULT 'tts',            -- 'sound-only' | 'tts'
  wake_mode TEXT NOT NULL DEFAULT 'sound_then_voice',
  voice_profile_id TEXT REFERENCES voice_profiles(id),
  speaker_id TEXT REFERENCES voice_speakers(id),
  vibration_pattern TEXT NOT NULL DEFAULT 'default',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE plan_group_invites (
  id TEXT PRIMARY KEY,
  plan_group_id TEXT NOT NULL REFERENCES plan_groups(id),
  inviter_user_id TEXT NOT NULL REFERENCES users(id),
  code TEXT NOT NULL UNIQUE,                   -- 6 digits
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','used','revoked','expired')),
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  used_by_user_id TEXT REFERENCES users(id),
  used_at TEXT
);
```

### Migrations

Migrations live in `packages/backend/src/lib/migrations.ts` as an ordered array. They are applied via:

```bash
# Apply all
curl -X POST https://<host>/api/init-db

# Apply a range (to stay under Workers free-plan subrequest limits)
curl -X POST "https://<host>/api/init-db?fromId=1&toId=10"
```

| # | Name | Change |
|---|---|---|
| 1 | initial-schema | Core 8 tables |
| 2 | email-password-auth | `users.password_hash`, nullable `google_id` |
| 3 | voice-uploads | `voice_uploads` |
| 4 | voice-speakers | `voice_speakers` |
| 5 | alarm-mode-voice-speaker | `alarms.mode`, `voice_profile_id`, `speaker_id` |
| 6 | plans-and-subscriptions | `plans`, `subscriptions` + seed |
| 7 | voucher-codes | `voucher_codes` |
| 8 | plan-groups | `plan_groups`, `plan_group_members` |
| 9 | plan-group-invites | `plan_group_invites` |
| 10 | user-allow-family-alarms | `users.allow_family_alarms` |
| 14 | push-tokens | `push_tokens` |
| 15 | alarm-vibration-pattern | `alarms.vibration_pattern` |
| 16 | user-last-active | `users.last_active_at` |
| 17 | alarm-wake-mode | `alarms.wake_mode` |
| 18 | notes-table | `notes` |
| 35 | apple-login-users | `users.apple_id` + unique nullable Apple ID index |

### Operations

- DEV / STAGING / PROD point to different Turso databases with different secrets.
- `npm run reset:test-data` cleans test accounts.
- Direct production edits require a PR, merge, and a window not overlapping with `wrangler scheduled` runs.

## 3. HTTP API

- **Base URL** (production): `https://api.alarm-talk.com/api`
- **Auth**: `Authorization: Bearer <JWT | google_id_token | apple_id_token>`
- **Response shape**:
  ```
  200/201: { ...payload }
  4xx/5xx: { error: "CODE", message: "..." }
  ```

### Common error codes

| HTTP | Code | Condition |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Zod validation failed |
| 401 | `UNAUTHORIZED` | Missing / expired / invalid JWT |
| 403 | `FORBIDDEN` | Permission insufficient |
| 404 | `NOT_FOUND` | Resource missing |
| 413 | `BODY_TOO_LARGE` | > 512 KB |
| 429 | `RATE_LIMITED` | > 60 req/min |
| 500 | `INTERNAL_ERROR` | Unhandled server error |

### Middleware chain

`securityHeaders → sentry → logger → rateLimit → bodyLimit → cors → (for /api/*: auth + cache)`

### Route groups

| Prefix | Responsibility |
|---|---|
| `/auth` | Sign up / sign in / me |
| `/user` | Profile, plan, search, account delete |
| `/voice` | Voice profile, upload, diarization |
| `/tts` | TTS generation, presets |
| `/alarm` | Alarm CRUD |
| `/friend` | Friend |
| `/family` | Family group, invites, family alarm |
| `/billing` | Subscription, voucher |
| `/code` | Unified code register (VA-XXX / 6-digit) |
| `/library` | Message library |
| `/notes` | Notes |
| `/gift` | Gift |
| `/dub` | Speaker separation and derived voice tooling |
| `/stats` | Stats |

### Selected endpoints

#### `POST /auth/register`

```json
Req:  { "email": "u@x.com", "password": "********", "name": "Sue", "email_verification_code": "123456" }
Res:  { "token": "...", "user": { "id": "...", "email": "u@x.com", "name": "Sue", "plan": "free" } }
```

Registration requires a current 6-digit email verification code. The code is requested with:

```json
POST /auth/email-code
Req: { "email": "u@x.com" }
Res: { "success": true, "expires_in_seconds": 600 }
```

The client may pre-check the code before submitting the full registration form:

```json
POST /auth/email-code/verify
Req: { "email": "u@x.com", "code": "123456" }
Res: { "success": true }
```

Production delivery uses Resend. Configure `RESEND_API_KEY` and
`AUTH_EMAIL_FROM` as Worker secrets after verifying the sending domain.

#### `POST /auth/apple`

```json
Req:  { "id_token": "<apple identity token>", "email": "u@privaterelay.appleid.com", "name": "Sue" }
Res:  { "token": "...", "user": { "id": "...", "email": "u@privaterelay.appleid.com", "name": "Sue", "plan": "free" } }
```

The backend verifies the Apple token signature against Apple JWKS, checks issuer, audience (`APPLE_CLIENT_ID`), and expiry, links `users.apple_id`, then returns the app JWT used by native clients.

#### `POST /voice/clone` (multipart)

- Body: `audio` (file), `name` (string), `isDraft=true`, relationship/title fields, and app `language`.
- Direct official creation is rejected. The client must create one private draft, request its deterministic preview, wait for playback completion, and then promote it with `PATCH /voice/:id` and `is_draft=false`.
- Draft provider enrollment is limited to three attempts per KST month and one active draft. Promotion is limited to one official registration per KST month; deleting an official voice does not refund that registration.
- Provider: ElevenLabs. Drafts cannot be shared, attached to alarms/gifts, or used for general TTS.

#### `POST /tts/generate`

```json
Req: { "voice_profile_id": "...", "text": "Wake up", "language": "ko" }
Res: {
  "message": { "id": "...", "text": "...", "audio_url": "https://r2/...mp3", "voice_profile_id": "..." },
  "cache_key": "sha256...",
  "r2_key": "tts/sha256....mp3",
  "audio_base64": "..."
}
```

#### `POST /alarm`

```json
{
  "time": "07:30",
  "repeat_days": "1,2,3,4,5",
  "mode": "tts",
  "wake_mode": "voice_only",
  "voice_profile_id": "...",
  "vibration_pattern": "default",
  "message": "Good morning"
}
```

#### `POST /family/invites/:code/accept`

Validates pending status, expiry, capacity, and self-invite block; inserts into `plan_group_members`; marks the invite `used`. All inside a transaction.

#### `POST /code/register`

Auto-detects format:
- `VA-XXXX-XXXX-XXXX` → voucher redemption → subscription insert + plan update.
- 6-digit numeric → family invite accept.

Errors: `INVALID_FORMAT` `EXPIRED` `ALREADY_USED` `NOT_FOUND` `SELF_INVITE` `GROUP_FULL`.

#### `POST /billing/test-codes`

Internal closed-test helper. Authenticated issuer emails from
`TEST_CODE_ISSUER_EMAILS` (defaults to `gyuwon05@gmail.com`) can issue free
test access codes while real Google Play Billing is not connected.

```json
Req: { "plan_key": "personal" | "couple" | "family", "count": 1, "days": 30 }
Res: { "success": true, "first_redeemer_becomes_owner": true, "codes": [...] }
```

For `personal`, codes use `GIFT-XXXX-XXXX-XXXX`. For `couple` and `family`,
codes use `INV-XXXX-XXXX-XXXX`; the first user who registers the code becomes
the owner of the new shared plan group. These bootstrap codes are single-use.

### Public endpoints

- `GET /` — health check (returns DB connectivity).
- `GET /api/tts/presets` — public cache.
- `POST /api/init-db` — migration runner (intended for internal use; gate with IP / secret in production).

### Cron

`*/5 * * * *` — the `scheduled` handler runs subscription expiry/downgrade, account purge, auxiliary alarm push, external audio deletion reconciliation, and explicitly authorized voice-prerender jobs.

Keeping a previewed private draft creates one durable, owner-scoped prerender job. Its fixed manifest is exactly one app language with `greeting` 1, `weather` 8, `fortune` 5, `love` 3, and `medication` 3 clips. Workers may only resume that bounded manifest with its exact claim token; they recheck voice ownership/state and sensitive consents before synthesis and before publication. They never discover users autonomously or add categories beyond this manifest.

> **주의**: 실제 알람 **울림**은 온디바이스(`AlarmManager`/`AlarmKit`)이며 네트워크에 의존하지 않는다. 여기서 보내는 푸시는 가족/대상 알람 알림 등 **보조 경로**다. 단, 현재 정확-분(UTC) 매칭이 5분 주기 cron과 어긋나 일부 알람이 푸시되지 않는 알려진 이슈가 있다 — [`backend-findings.ko.md` F1](backend-findings.ko.md) 참고.

### Change management

When you modify an endpoint:

1. Update the route under `packages/backend/src/routes/`.
2. Update this file's relevant section.
3. Update the corresponding `*Api.kt` under `apps/android-native/app/.../network/`.
4. Add or update Vitest contract tests under `packages/backend/test/`.
5. If iOS uses the endpoint, update `apps/ios-native/` as well.

Breaking changes co-exist with at least one prior minor version.
