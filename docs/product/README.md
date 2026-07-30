# Product

## Vision

> "Wake up to the voice you want to hear."

AlarmTalk replaces beep-style mechanical alarms with a voice the user picked — recorded, shared by family or partner, or generated from an AI voice clone. The product treats the alarm as an emotional, relational moment, not just a reminder.

## Core Values

| Value | Description |
|---|---|
| Real alarm | OS-native alarm engine. Rings on lock screen, Doze, and offline. No push, no server cron, no fetch at ring time. |
| Voice-first | Three paths to "whose voice wakes you": record, share within a group, AI clone. (Audio file upload exists only as clone-creation input, not as an alarm sound source.) |
| Relational | Family / partner groups share voice profiles and create alarms for each other. |

## Target Users

### Primary

- **Long-distance professionals (20s-30s)** living apart from family or partner. Want parent or partner voice to start the day.
- **Frequent travelers (30s-40s)** who need a reliable alarm that works on flight mode and weak networks.

### Secondary

- **Working parents** waking up school-age children with a parent's voice instead of yelling.
- **Couples in commuting/long-distance relationships** wanting a shared morning ritual.

### Global expansion (after Korea launch stabilization)

- K-pop fans in Southeast Asia (Indonesia, Philippines, Vietnam, Thailand)
- Japanese K-pop / J-pop fans in their 20s-30s
- Overseas Koreans (US, Japan) connecting with family across time zones
- Korean language learners using preset Korean phrases

## Plan Tiers

| Plan | Audience | Monthly price | Members |
|---|---|---:|:---:|
| Free | Individual trial | ₩0 | 1 |
| Personal | Individual | ₩3,900 | 1 |
| Couple | 2 people | ₩6,900 | 2 |
| Family | Family | ₩14,900 | up to 5 |

Prices are confirmed. See [`PRICING.md`](../../PRICING.md) for the margin/cost breakdown.

## Roadmap

### Completed

- **Phase 1**: Android alarm engine (`AlarmManager.setAlarmClock`, full-screen ringing activity, boot restore)
- **Phase 2**: Android local alarm app (Room storage, repeat days, snooze, vibration, modes)
- **Phase 3**: Android audio & voice (in-app recording, TTS caching, airplane-mode playback)
- **Phase 4**: Backend integration (email/Google auth, manual alarm metadata sync, deterministic TTS cache)
- **Phase 5**: Social & sharing (family/couple group joined by an `INV-` voucher code, shared voice profiles)
- **Phase 6**: Billing (plan tiers, subscription, voucher codes, expiry/downgrade cron)
- **Free bucket rotation**: 4 system voices, 11 preset phrases (weather 9 + medication 2) × ko/en/ja pre-rendered as stock clips; the client picks the weather clip by condition and rotates the medication bucket locally (advance on dismiss, hold on snooze)
- **Paid clone pre-render**: after a kept (promoted) clone, cron pre-renders 21 clips in the app language — greeting 1 / weather 9 (8 conditions + 1 "weather unresolved" notice) / fortune 5 / love 3 / medication 3. Weather snapshots a server index during the 48h prep window and fires offline; fortune is device-deterministic; love/medication rotate
- **FCM instant delivery for family alarms**: data-only push on alarm creation plus pull-on-app-resume; used for delivery only — ringing stays 100% local (`AlarmManager`)
- **Google Play Billing**: subscription purchase code complete (confirm + RTDN); Toss Payments dropped

### Before public launch

- Google Play Console external setup, then real-payment E2E verification
- Prod DB reset (hard-breaking changes are OK until then — no back-compat burden)
- Physical-device verification of the current dev build (alarm ring paths, bucket rotation, clone pre-render playback)

## Risks

| Risk | Mitigation |
|---|---|
| Per-manufacturer Android background restrictions (Samsung One UI, Xiaomi MIUI, etc.) | In-app permission guide screens; deep links to OS settings; battery-optimization exemption flow |
| Voice-provider pricing volatility | Deterministic TTS caching (same input → same output → same R2 object); monthly direct-input TTS quota per plan (personal 30 / couple 50 / family 100, KST, shared group pool); bounded clone pre-render manifest (21 clips per clone); ElevenLabs spend monitoring |
| Voice rights disputes | Sharing only inside a user's family/partner group; in-app legal notice during voice registration; account deletion cascades remove voice data |

## 관련 문서

- [`voice-prompt-design.ko.md`](voice-prompt-design.ko.md) — 알람 문구 생성(Gemini → ElevenLabs v3) 설계 근거. 백엔드 코드 주석이 `§4.x` 로 이 문서를 참조한다.

## Non-negotiable Rules

1. The alarm ring path must use OS-native scheduling and local audio only.
2. Voice cloning and one-off TTS start only from explicit user actions. After the user previews a private draft and explicitly keeps it, that action may authorize one fixed, bounded, durable background job for the documented paid preset manifest. Background workers may not scan for new work or expand the authorized categories, and automated tests always stub paid providers.
3. Voice data is only shared inside a user's family/partner group. External download is disabled by design.
