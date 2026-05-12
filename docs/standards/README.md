# Standards

Coding conventions, git workflow, security policy, XP rules, and key architecture decisions.

## 1. Principles

1. **The code in this repository is the source of truth.** When this document disagrees with the code, the code wins. Either fix the code or fix this document — in the same PR.
2. **Identifiers in English, prose in the writer's language.** Variable, function, class, and file names are English. Comments, commit messages, and PR descriptions can be in any language; team default is English.
3. **Small code, smaller tests.** If something needs proof, prove it with a test, not a paragraph of comments.

## 2. Languages and tooling

| Area | Tool / version |
|---|---|
| Backend | TypeScript 6.x · Hono 4.x · Cloudflare Workers (`compatibility_date` ≥ 2024-09-23) |
| Android | Kotlin 2.0.21 · AGP 8.7.3 · JDK 17 · Compose BOM 2024.12.01 · `minSdk = 26` · `targetSdk = 35` |
| iOS | Swift 5.10 · Xcode 16 · AlarmKit (iOS 18+ PoC, iOS 26+ production target) |
| Workspace | npm workspaces · Node 22+ |
| Lint | ESLint 10 + Prettier 3 (TypeScript) · `./gradlew :app:lintDebug` (Android) |

## 3. Folder layout

```
.
├── README.md           # English root README (+ README.ko.md / README.ja.md)
├── AGENTS.md           # AI agent entrypoint
├── CLAUDE.md           # Claude Code instructions
├── NATIVE_REBUILD_PROMPT.md
├── SECURITY.md
├── docs/
│   ├── README.md
│   ├── product/
│   ├── spec/
│   ├── design/
│   ├── tech/
│   ├── standards/      # this file
│   ├── qa/
│   ├── manual/
│   └── native-rebuild/
├── apps/
│   ├── android-native/
│   ├── ios-native/
│   └── landing/
└── packages/
    ├── backend/
    ├── shared/
    ├── ui/
    └── voice/
```

## 4. TypeScript conventions

- `strict: true` is non-negotiable. No `any`; widen to `unknown` and narrow with a type guard.
- Identifiers: `camelCase` for values and functions, `PascalCase` for types and classes, `SCREAMING_SNAKE_CASE` for constants.
- One domain per Hono router file. `packages/backend/src/routes/<domain>.ts`.
- External calls go through `packages/backend/src/lib/<provider>.ts`. Route handlers never call `fetch` directly.
- Validate input with Zod at the route boundary. Schema lives at the top of the route file or in `packages/shared`.
- Use ISO 8601 strings for times. Store in UTC, render in user-local time.

```ts
import { z } from 'zod';

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

app.post('/auth/login', async (c) => {
  const body = Body.parse(await c.req.json());
  // ...
});
```

## 5. Kotlin / Android conventions

- Naming: `camelCase` functions, `PascalCase` classes and composables, `IconName` for icon constants.
- Compose files split into `XxxScreen.kt`, `XxxState.kt`, `XxxComponents.kt` for any non-trivial screen.
- ViewModels expose `StateFlow`. One-shot events go through `Channel`.
- Room DAOs are `suspend` or `Flow`. No `runBlocking`.
- All `AlarmManager` access goes through `alarm/AlarmScheduler.kt`.
- Log via `VoiceAlarmLog.TAG`. No direct `Log.d / Log.w` calls.
- Long-running work uses WorkManager or an explicit Foreground Service.

## 6. Swift / iOS conventions (PoC level)

- SwiftUI first. Wrap UIKit interop in dedicated files.
- All AlarmKit calls live in `AlarmKitViewModel`. Views consume `@Published` state only.
- Shared symbols (e.g. `AlarmSummary`) live in `apps/ios-native/Shared/`.

## 7. Comments, naming, logging

- Comments explain **why**, never what — clear identifiers handle the what.
- `TODO` / `FIXME` must reference an issue id.
- User-facing strings are localized. Backend logs are English and structured (`logStructured('info', { at: 'route.path', ... })`).

## 8. Testing

| Layer | Tool | Command |
|---|---|---|
| Backend | Vitest + in-memory libSQL | `npm run test --workspace=backend` |
| Android unit | JUnit | `./gradlew :app:testDebugUnitTest` |
| Android UI | Compose UI Test (planned) | `./gradlew :app:connectedAndroidTest` |
| Lint (Android) | AGP Lint | `./gradlew :app:lintDebug` |

Physical-device verification: a real Android phone with the Physical Device Checklist in `apps/android-native/README.md`.

External providers (ElevenLabs, Perso, FCM) must be stubbed in tests. Automated tests must not consume paid credits.

## 9. Tone and accessibility

- Korean copy uses friendly polite ("…해 주세요"). English / Japanese mirror the same register.
- Action labels are verbs. Prefer concrete nouns over abstractions ("Set time" beats "Configure").
- Toasts stay within one line.
- See [design/README.md](../design/README.md) §3 for the full UI guide.

## 10. Environment variables and secrets

Never commit:

- `.env`, `.env.*`
- `packages/backend/.dev.vars`
- `apps/android-native/local.properties`
- `service-account*.json`
- `*.keystore`, `*.jks`, `*.p8`

Cloudflare Worker secrets:

- `JWT_SECRET`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`
- `ELEVENLABS_API_KEY`
- `SENTRY_DSN`
- `GOOGLE_OAUTH_CLIENT_ID`, `APPLE_OAUTH_CLIENT_ID`

Android Gradle properties (override via `local.properties` or `-P`):

- `voiceAlarmApiBaseUrl`
- `voiceAlarmGoogleWebClientId`

iOS uses Xcode Build Settings (`INFOPLIST_KEY_*`) for environment-specific values.

## 11. Git workflow

### Branches

```
main      ▣▣▣▣▣▣▣▣   release baseline (develop → main at release time)
develop   ▣▣▣▣▣▣▣▣   integration
feat/*    ▣▣▣○        → develop
fix/*           ▣▣▣○  → develop (or main for hotfix)
chore/*               → develop
docs/*                → develop
refactor/*            → develop
```

| Branch | Purpose | Merges into |
|---|---|---|
| `main` | Production baseline | — (only develop → main at release) |
| `develop` | Daily integration | — |
| `feat/<#issue>-<slug>` | New feature | `develop` |
| `fix/<#issue>-<slug>` | Bug fix | `develop` (or `main` for hotfix) |
| `chore/<slug>` | Tooling, deps | `develop` |
| `docs/<slug>` | Documentation | `develop` |
| `refactor/<slug>` | No behavior change | `develop` |

### Commit messages

- Format: `<type>: <short description>`
- Types: `feat` `fix` `chore` `docs` `refactor` `test` `style`
- ≤ 50 characters when possible. Sentence-style.
- No AI markers, no emojis.

Good:
```
feat: restore alarms after reboot
fix: snooze schedules next alarm at exact minute
docs: rewrite TTS deterministic cache section
chore(deps): bump hono in the production-dependencies group
```

### Pull requests

- Title follows the commit convention; ≤ 70 characters.
- Body uses:
  ```
  ## Summary
  - ...

  ## Test plan
  - [ ] ...
  ```
- Keep one PR to one purpose. Split if > 800 lines diff.
- Require at least one approval.
- Merge style: **merge commits** (no squash). Preserves implementation history.
- Reviewer checklist:
  1. Does the code match the title?
  2. Any network call added to the alarm-ring path?
  3. Tests sufficient?
  4. Permissions / secrets / docs updated together?
  5. Android / iOS / backend contracts in sync?

### Hotfix

- Never push directly to `main`. Always `fix/...` → main PR → merge → merge main back into develop.

### Tags & releases

- Semantic versioning `vMAJOR.MINOR.PATCH`. Alpha track is `v0.x.y`.
- Android `versionName = X.Y.Z`, `versionCode` increments on every build.
- Release notes go to GitHub Releases (features / fixes / known issues).

### Dependencies

- Dependabot opens weekly grouped PRs for dev and production.
- Merge if tests pass and the change is minor/patch. Majors get a human review.
- Review Cloudflare Workers compatibility flags once per quarter.

### Large files

- Anything over 5 MB does not belong in git. Use R2 or GitHub Release assets.
- Android build logs, APKs, keystores are already in `.gitignore`.

## 12. Security policy (summary)

The full external policy is in `SECURITY.md`. The internal rules are:

- HTTPS-only. Mobile clients set `usesCleartextTraffic=false`.
- Passwords bcrypt-hashed (cost ≥ 10).
- JWT HS256, 7-day TTL. `JWT_SECRET` ≥ 32 bytes random.
- All input validated with Zod. Parameterized SQL only.
- Rate limit 60 req/min/IP. Body limit 512 KB.
- Security response headers on every response (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Strict-Transport-Security`, `Cross-Origin-Opener-Policy`, `Cache-Control: no-store` by default).
- R2 bucket is private. Server returns base64 or short-lived signed URLs only.
- Voice data is shared only inside a user's family/partner group. External download is blocked.
- Account deletion cascades to voice, alarms, messages, friends, plan-group membership; R2 objects are queued for deletion.
- Personal data is never logged. Email and similar identifiers are hashed before logging if they appear at all.
- Secret rotation every 90 days. Rotation owner: release engineer + tech lead.

## 13. XP rules (single source of truth)

The numbers below are the source of truth and must match `packages/backend/src/lib/xpRules.ts`. Update both in the same PR.

### Event → XP / affection map

| Event (`XpEvent`) | XP | Affection | Meaning |
|---|---|---|---|
| `alarm_completed` | 10 | 2 | User listened through and dismissed |
| `alarm_snoozed` | 5 | 0 | User snoozed (small reward; no affection) |
| `alarm_dismissed` | 0 | 0 | Force-killed without listening |
| `family_alarm_received` | 10 | 3 | A family-sent alarm successfully played for the recipient |
| `friend_invited` | 50 | 5 | Friend accepted an invite (one-time boost) |

### Daily cap

- `DAILY_XP_CAP = 200` XP.
- Half-grant rule: if the request would push the day's earned XP past 200, only the remaining headroom is granted and the response sets `capped = true`.
- Affection has no cap: it represents a relationship dimension, not a level inflation lever.

### Pure-function contract

`packages/backend/src/lib/xpRules.ts` exposes:

```ts
type XpEvent =
  | 'alarm_completed'
  | 'alarm_snoozed'
  | 'alarm_dismissed'
  | 'family_alarm_received'
  | 'friend_invited';

const DAILY_XP_CAP = 200;

function computeXpForEvent(event: XpEvent): number;
function computeAffectionForEvent(event: XpEvent): number;
function isXpEvent(value: unknown): value is XpEvent;

interface DailyCapResult {
  grantedXp: number;
  capped: boolean;
  remainingCap: number;
}
function applyDailyXpCap(
  earned: number,
  alreadyEarnedToday: number,
  cap?: number,
): DailyCapResult;

interface GrantResult {
  xp: DailyCapResult;
  affection: number;
  event: XpEvent;
}
function computeGrant(
  event: XpEvent,
  alreadyEarnedToday: number,
  cap?: number,
): GrantResult;
```

### Edge-case guarantees

- `earned ≤ 0` or `NaN` → `grantedXp = 0`, `capped = false`. The cap is untouched.
- `alreadyEarnedToday < 0` is treated as 0.
- `cap` defaults to 200; passing 0 makes every grant a no-op (test scenario).
- The runtime guard `isXpEvent` rejects out-of-whitelist event names.

### `POST /api/characters/xp` semantics

Server reads `alreadyEarnedToday` (from `characters.daily_xp` or `character_xp_logs`), runs `computeGrant`, then in a transaction:

1. `UPDATE characters SET xp += grantedXp, affection += affection`
2. `INSERT character_xp_logs` (with `(character_id, client_nonce)` unique constraint)
3. Recompute `level` and `stage` and persist them
4. Respond with the updated character snapshot

## 14. Architecture decisions (selected)

### A1. OS-native alarm scheduling, no push

- **Choice**: `AlarmManager.setAlarmClock` on Android, AlarmKit on iOS.
- **Rejected**: push notifications, server cron.
- **Why**: alarm reliability is the product. Push is unreliable on flight mode, weak networks, Doze, OEM background restrictions.

### A2. Deterministic TTS caching

- **Key**: `sha256(voice_profile_id | text | language | provider)`.
- **Rejected**: random UUID per request.
- **Why**: same input → same output → reuse the same R2 object → no duplicate provider spend.

### A3. Family invite: 6-digit code + deep link

- **Choice**: numeric 6-digit code, 10-minute TTL, single-use. Optional deep link `voicealarm://invite/{code}` + web fallback `https://naro.app/invite/{code}`.
- **Rejected**: email invites, link-only invites.
- **Why**: works without collecting email, can be passed verbally / via any chat app, brute-force resistant given short TTL and a rate limit.
- **Schema**: see `plan_group_invites` in [tech/README.md](../tech/README.md) §2.
- **API**: `POST /api/family/invites` (issue) / `POST /api/family/invites/:code/accept` / `POST /api/family/invites/:code/revoke`.
- **Mitigations**:
  - Brute force: 1,000,000 combinations × 10-minute TTL × pending uniqueness × rate limiting → practically infeasible.
  - Link leakage: single-use means at most one redemption; for many invitees the owner issues multiple codes.
  - Lazy expiry on read avoids a batch job.

### A4. R2 as the canonical voice/TTS store

- **Choice**: Cloudflare R2 with the Workers binding `VOICE_BUCKET`.
- **Why**: free egress, native binding, no external service dependency, fits inside the Workers compute boundary.
