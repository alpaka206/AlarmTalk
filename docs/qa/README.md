# QA

Test plan, test cases, test scenarios, bug-report template, and QA report shape for Naro.

## 1. Goal

Drive the "alarm did not ring" rate to zero on real devices. Everything else is secondary.

## 2. Scope

| Layer | Tool | Owner |
|---|---|---|
| Backend unit / contract | Vitest + in-memory libSQL | Developer |
| Android unit | JUnit | Developer |
| Android instrumented | Compose UI Test (planned) | Developer |
| Manual physical-device QA | `apps/android-native/README.md` checklist | QA |
| Performance / load | k6 (planned) | Ops |
| Security | OWASP ZAP active scan + manual review | Ops |
| Acceptance | Closed Beta interviews | Product |

Out of scope this round: iOS production verification (PoC level only).

## 3. Entry / exit criteria

### Entry

- `develop` branch passes typecheck, lint, and tests.
- All Closed Beta P0 features merged.
- Staging API deployed; staging Turso DB seeded.
- At least two physical test devices available.

### Exit (Closed Beta)

- 0 open P0.
- ≤ 3 open P1, each with a documented workaround.
- 100 alarm trials on the verified physical device → 100 rings, 0 misses.
- API p95 < 500 ms on staging.

## 4. Test schedule (per release)

| D-day | Action |
|---|---|
| D-14 | Test data prep, scenario freeze |
| D-10 | Add new test cases, seed staging |
| D-7 | Start QA — checklist on physical devices |
| D-5 | Internal bug bash |
| D-3 | UAT closes, remaining P0/P1 reviewed |
| D-1 | Release candidate frozen; verify secrets / API keys |
| D-day | Release |

## 5. Test cases

ID rule: `TC-<area>-<###>`. Each case has preconditions / steps / expected / priority.

### Alarm (ALM)

| ID | Title | Steps | Expected | P |
|---|---|---|---|---|
| TC-ALM-001 | Alarm 1 minute from now | "+" → time = now+1 min → save | Rings at the exact minute; RingingActivity shown | P0 |
| TC-ALM-002 | Weekday repeat | Select Mon–Fri → save | Next fire time is computed for the next weekday | P0 |
| TC-ALM-003 | Rings on lock screen | Lock device before fire time | Screen wakes; RingingActivity appears over lock screen | P0 |
| TC-ALM-004 | Flight mode | Enable airplane mode → wait | Plays from local cache; no network calls in logcat | P0 |
| TC-ALM-005 | Doze / idle | `adb shell dumpsys deviceidle force-idle` | Rings on time | P0 |
| TC-ALM-006 | Snooze (5 min) | Tap snooze | Next alarm registered exactly 5 minutes later | P0 |
| TC-ALM-007 | Dismiss | Tap dismiss | Service stops; one-shot → inactive; repeat → next day registered | P0 |
| TC-ALM-008 | Boot restore | Schedule alarm → reboot | All active alarms reappear in `dumpsys alarm` | P0 |
| TC-ALM-009 | Holiday off | Toggle holiday-off → schedule alarm on a holiday | Alarm skips the holiday | P2 |
| TC-ALM-010 | Copy alarm | Swipe → copy | Reuses cached local audio; no provider call | P2 |
| TC-ALM-011 | Swipe delete | Swipe left → confirm | Removed from list, Room, and AlarmManager | P1 |
| TC-ALM-012 | Toggle ON/OFF | Tap card switch | OFF cancels OS alarm; ON re-registers | P0 |

### Voice profile (VOC)

| ID | Title | Steps | Expected | P |
|---|---|---|---|---|
| TC-VOC-001 | 30-second record | Record → stop within 30 s | Profile transitions to `ready` | P0 |
| TC-VOC-002 | File upload over 30 s | Upload 1-minute file | Auto-trimmed to first 30 s; succeeds | P0 |
| TC-VOC-003 | 2-profile limit | Try to create a 3rd profile | `VOICE_LIMIT_REACHED` shown; recording is blocked | P1 |
| TC-VOC-004 | Family share | Owner creates profile | Member sees it in shared voices (read-only) | P1 |
| TC-VOC-005 | Mic denied | Deny mic permission → tap record | Permission guide + system settings deep link | P0 |
| TC-VOC-006 | Rename | Edit name → save | List refreshes; PATCH 200 | P1 |

### TTS / content (TTS)

| ID | Title | Steps | Expected | P |
|---|---|---|---|---|
| TC-TTS-001 | Same input → cache hit | Save the same (profile, text, lang) twice | First saves with provider; second only reads R2 | P0 |
| TC-TTS-002 | Preset message | Pick category + language | Fields auto-fill; save succeeds | P1 |
| TC-TTS-003 | Daily cap | Approach `daily_tts_count` limit | Server returns cap message; UI shows guidance | P1 |
| TC-TTS-004 | Voice-only ring | Let voice-only alarm fire | Local file plays; no fetch | P0 |
| TC-TTS-005 | Very long text | Try near upper limit | Server returns 400 with reason | P2 |

### Auth (AUTH)

| ID | Title | Steps | Expected | P |
|---|---|---|---|---|
| TC-AUTH-001 | Email login success | Valid credentials | 200, JWT stored in SessionStore | P0 |
| TC-AUTH-002 | Wrong password | Invalid credentials | 401, generic message (no field leak) | P0 |
| TC-AUTH-003 | Google sign-in | Provide Google ID token | Account created/linked, signed in | P0 |
| TC-AUTH-004 | JWT expired | Token > 7 days old | 401; app prompts re-sign-in | P1 |
| TC-AUTH-005 | Account delete | DELETE /api/user/me | Cascading delete; R2 voice objects queued | P1 |

### Family / code (FAM)

| ID | Title | Steps | Expected | P |
|---|---|---|---|---|
| TC-FAM-001 | Invite accept | Owner issues code → member redeems | Member inserted; status `used`; shared voices appear | P0 |
| TC-FAM-002 | Expired code | Redeem after 10 minutes | `EXPIRED` error | P1 |
| TC-FAM-003 | Group full | 7th member tries to join | `GROUP_FULL` error | P1 |
| TC-FAM-004 | Self invite | Owner redeems own code | `SELF_INVITE` error | P2 |
| TC-FAM-005 | Group leave | Member leaves | Shared voices revoked instantly | P1 |
| TC-FAM-006 | Ownership transfer | Owner transfers to member | Plan / subscription follows | P1 |

### Billing (BILL)

| ID | Title | Steps | Expected | P |
|---|---|---|---|---|
| TC-BILL-001 | Voucher redemption | Enter `VA-XXXX-XXXX-XXXX` | Subscription created; plan upgraded | P1 |
| TC-BILL-002 | Expiry tick | Force expiry → cron tick | Status `expired`; plan = free | P1 |
| TC-BILL-003 | Invalid format | Mix letters and digits | `INVALID_FORMAT` error | P2 |

### Character (CHA)

| ID | Title | Steps | Expected | P |
|---|---|---|---|---|
| TC-CHA-001 | On-time dismiss event | Let alarm finish, dismiss on time, then allow auto sync | +5 XP, +2 affection (within cap) | P1 |
| TC-CHA-002 | Daily cap reached | Earn 200 XP, then more | `grantedXp = 0`, `capped = true`, affection still increases | P1 |
| TC-CHA-002B | Missed/snoozed event | Snooze or miss the on-time path | -5 XP, but XP does not go below 0 and level does not decrease | P1 |
| TC-CHA-003 | Streak +1 | Dismiss yesterday and today | `current_streak += 1`; date updated | P1 |
| TC-CHA-004 | Streak break | Skip a day | Streak resets to 1 on next dismiss; `longest_streak` preserved | P1 |
| TC-CHA-005 | Stage transition | Cross level threshold | Stage advances; animation shown | P2 |

### Sync (SYNC)

| ID | Title | Steps | Expected | P |
|---|---|---|---|---|
| TC-SYNC-001 | Sync now | Edit 3 local alarms → sync | 3 rows synced; matches on server | P1 |
| TC-SYNC-002 | Cross-device reflect | Device A edit → Device B sync | Room on device B reflects changes | P1 |
| TC-SYNC-003 | Ring during outage | Disable network during ring | Local alarm rings; queued sync resumes later | P0 |

### Security (SEC)

| ID | Title | Steps | Expected | P |
|---|---|---|---|---|
| TC-SEC-001 | Rate limit | 80 requests in 1 minute | 429, `RATE_LIMITED` | P1 |
| TC-SEC-002 | Body too large | 600 KB body | 413 | P1 |
| TC-SEC-003 | Key in client | `grep` client builds for keys | No API key strings present | P0 |
| TC-SEC-004 | HTTPS only | Attempt http:// | Redirected to https:// | P0 |

### Accessibility (A11Y)

| ID | Title | Expected | P |
|---|---|---|---|
| TC-A11Y-001 | TalkBack | Every card/button has spoken label | P1 |
| TC-A11Y-002 | Font scale 200% | Layout does not break | P2 |
| TC-A11Y-003 | Dark mode | Contrast ≥ 4.5:1; tokens consistent | P1 |

### Internationalization (I18N)

| ID | Title | Expected | P |
|---|---|---|---|
| TC-I18N-001 | Switch to English | Every screen translated; layout stable | P1 |
| TC-I18N-002 | Per-language fonts | Pretendard / Noto fallbacks render | P2 |

## 6. Test scenarios (end-to-end manual)

### TS-1. New user onboarding to first ring

1. Fresh install → email sign-up (8+ char password).
2. Grant notification, exact alarm, full-screen permissions.
3. Voice tab → "+ New voice" → record 15 s, name it.
4. Alarm tab → "+ New alarm" → time = now+2 min, voice profile + a preset message, save.
5. Lock the device, wait.
6. Expected: alarm rings full-screen; dismiss; +5 XP event queues locally and syncs automatically after sign-in/network is available.

### TS-2. Family share and partner alarm

1. Owner has a `family` or `couple` plan and one voice profile.
2. Owner: People → Family → "Make invite code". Six digits, 10-minute TTL.
3. Member (Device B) signs in → Account → "Register code" → enters 6 digits.
4. Member: New alarm → mode = voice → audio source = voice profile → shared voices tab → pick owner profile → save.
5. Expected: alarm fires from owner's voice on Member's device using local cache only.

### TS-3. Server outage resilience

1. Pre-condition: user has 3 alarms scheduled.
2. Take staging Workers offline.
3. App start → list load fails (banner shown).
4. Alarm fires at scheduled time. Expected: rings normally; user can dismiss.
5. Bring Workers back. Tap "Sync now". Expected: queues flush; banner clears.

### TS-4. Subscription cycle

1. Redeem a voucher → Personal plan active.
2. Manipulate next payment date to past (staging tool).
3. Wait for the 1-minute cron tick.
4. Expected: plan drops to free.
5. Redeem another voucher → Personal active again.

### TS-5. Account deletion

1. Account → Account deletion → confirm.
2. Expected: API returns 200; cascading delete completes; R2 voice queued for deletion.
3. Re-register the same email → succeeds with a clean slate.

### TS-6. Boot restore (per device)

1. Schedule a one-shot alarm at now+10 min.
2. Reboot the device.
3. `adb shell dumpsys alarm | grep voicealarm`.
4. Expected: the alarm is re-registered. Logs show `Restore receiver invoked`, `Boot restore complete`.

### TS-7. Brute-force invite code

1. Script 100 invalid 6-digit attempts in under a minute against the staging endpoint.
2. Expected: rate-limited after 60; logs show `RATE_LIMITED` entries.

### TS-8. Bulk delete / unselect

1. Create 10 alarms, edit / delete them in sequence.
2. Expected: no leaks; OS alarm count matches the active subset.

### TS-9. Long-running character

1. Seed a QA account with 200 days of streak / XP history.
2. Verify list, level, stage, milestones render consistently.
3. Verify the server response from `/api/characters/me` matches the rendered values.

### TS-10. International UAT

1. Switch UI to English; set device timezone JST.
2. Create alarm; observe local-time rendering.
3. Expected: layout intact; times rendered in the user-local timezone.

## 7. Bug report template

```markdown
## Summary
<one line>

## Environment
- App version: vX.Y.Z (build N)
- Device: <manufacturer / model / OS version>
- Server: production / staging
- Network: Wi-Fi / cellular / airplane mode
- Account: <test account email>
- Time: <ISO 8601 + timezone>

## Steps to reproduce
1. ...
2. ...

## Actual result
<screenshot / log snippet>

## Expected result
<...>

## Logs / artifacts
```
adb logcat | grep VoiceAlarm
...
```

## Impact
- Affected users:
- Workaround:

## Attachments
- screenshots / screen recording
- HAR / access logs / query results

## Meta
- Labels: `area:android`, `type:bug`, `priority:p?`
- Assignee:
```

### Priority

| P | Trigger | Action |
|---|---|---|
| P0 | Alarm miss, data loss, security issue | Hotfix immediately, hold release |
| P1 | Core flow broken (sign-in, sync) | Next release blocker |
| P2 | UX defects, recoverable issues | Within a few releases |
| P3 | Suggestions, polish | Backlog |

### Suggested labels

- `area:android`, `area:ios`, `area:backend`, `area:landing`
- `type:bug`, `type:flaky`, `type:regression`
- `priority:p0` … `priority:p3`
- `status:investigating`, `status:fixed`, `status:waiting-info`
- `device:<short-name>`

### Artifact collection commands (Android)

```bash
adb logcat -c
adb logcat | grep VoiceAlarm > logcat.txt
adb shell dumpsys alarm | grep voicealarm > alarms_dump.txt
adb bugreport bugreport_$(date +%Y%m%d_%H%M%S).zip
```

## 8. QA report shape (per release)

A QA report records what was tested, what passed, and what is left.

```markdown
## QA Report — <release name / date>

### Coverage
- Manual test cases run: N / N
- Automated tests:
  - Backend (vitest): <count> files
  - Android unit: <count> files
  - Android instrumented: <count> files

### Verified facts
- Alarm rings on device <X> / Android <Y>: <100/100>
- API p95 (staging): <ms>
- TTS deterministic cache hit rate: <%>

### Open issues
- P0: <count>
- P1: <count>
- P2: <count>

### Notes
- ...

### Decision
- Ship / hold / partial
```

### Sources of verified test counts in this repo

```bash
find packages/backend/test -name "*.test.ts" | wc -l
find apps/android-native -path "*/test/*" -name "*.kt" | wc -l
find apps/android-native -path "*/androidTest/*" -name "*.kt" | wc -l
```

Any concrete number in a QA report should be reproducible by running these commands or by repeating the Physical Device Checklist in `apps/android-native/README.md`.
