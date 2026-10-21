# Product

## Vision

> "Wake up to the voice you want to hear."

AlarmTalk replaces beep-style mechanical alarms with a voice the user picked — recorded, one of the built-in voices, or an AI clone of a voice the user registered (their own, or one they have permission to use, such as a parent's or partner's). The product treats the alarm as an emotional, relational moment, not just a reminder.

## Core Values

| Value | Description |
|---|---|
| Real alarm | OS-native alarm engine. Rings on lock screen, Doze, and offline. No push, no server cron, no fetch at ring time. |
| Voice-first | Three paths to "whose voice wakes you": record, built-in voices, AI clone. (Audio file upload exists only as clone-creation input, not as an alarm sound source.) |
| Relational | A parent's or partner's voice, registered with their permission, wakes the user every day. Voices are never shared with other accounts. |

## Target Users

### Primary

- **Long-distance professionals (20s-30s)** living apart from family or partner. Want parent or partner voice to start the day.
- **Frequent travelers (30s-40s)** who need a reliable alarm that works on flight mode and weak networks.

### Secondary

- **Working parents** waking up school-age children with a parent's voice instead of yelling.
- **Couples in commuting/long-distance relationships** wanting to wake up to their partner's voice.

### Global expansion (after Korea launch stabilization)

- K-pop fans in Southeast Asia (Indonesia, Philippines, Vietnam, Thailand)
- Japanese K-pop / J-pop fans in their 20s-30s
- Overseas Koreans (US, Japan) connecting with family across time zones
- Korean language learners using preset Korean phrases

## Plan Tiers

| Plan | Audience | Monthly price |
|---|---|---:|
| Free | Individual trial | ₩0 |
| Plus (`personal`) | Individual | ₩3,900 |

Prices are confirmed. The Couple and Family plans were removed on 2026-10-20 (owner decision — the group features kept
causing bugs); see [`docs/spec/plan-gates.md`](../spec/plan-gates.md). See [`PRICING.md`](../../PRICING.md) for the margin/cost breakdown.

## Roadmap

### Completed

- **Phase 1**: Android alarm engine (`AlarmManager.setAlarmClock`, full-screen ringing activity, boot restore)
- **Phase 2**: Android local alarm app (Room storage, repeat days, snooze, vibration, modes)
- **Phase 3**: Android audio & voice (in-app recording, TTS caching, airplane-mode playback)
- **Phase 4**: Backend integration (email/Google auth, manual alarm metadata sync, deterministic TTS cache)
- **Phase 5**: Social & sharing (family/couple group joined by an `INV-` voucher code, shared voice profiles) — removed on 2026-10-20 with the Couple/Family plans
- **Phase 6**: Billing (plan tiers, subscription, expiry/downgrade cron; the invite voucher codes went with the Couple/Family plans)
- **Free bucket rotation**: 4 system voices, 20 preset phrases per language (weather 9 + medication 2 + fortune 5 + cheer 3 alarm phrases, plus 1 greeting used only for voice preview) × ko/en/ja pre-rendered as stock clips — 240 clips in all. Free themes are derived from the catalog (`FREE_BUCKET_CATEGORIES` = every stock category except greeting), so message kinds are not gated by plan; the client picks the weather clip by condition, derives the fortune index on-device, and rotates the medication/cheer buckets locally (advance on dismiss, hold on snooze)
- **Paid clone pre-render**: after a kept (promoted) clone, cron pre-renders 21 clips in the app language — greeting 1 / weather 9 (8 conditions + 1 "weather unresolved" notice) / fortune 5 / cheer 3 (renamed from `love` in migration #110; the old id is still accepted on read) / medication 3. Weather snapshots a server index during the 48h prep window and fires offline; fortune is device-deterministic; cheer/medication rotate
- **FCM signals**: data-only pushes for account and billing changes (plan change, payment hold, voice access, account deletion). Family alarm delivery was removed on 2026-10-20. Ringing stays 100% local (`AlarmManager`)
- **Google Play Billing**: subscription purchase code complete (confirm + RTDN); Toss Payments dropped

### After launch — open items

- Real-payment E2E verification on both stores (Google Play and App Store) — see [`docs/qa/dev-test-handoff.md`](../qa/dev-test-handoff.md)
- ⚠ **Prod DB reset was cancelled (2026-08-01)** — beta testers have real data. Schema changes must be in-place, append-only migrations. See `CLAUDE.md` deployment section.
- Physical-device verification of the current dev build (alarm ring paths, bucket rotation, clone pre-render playback)

## Risks

| Risk | Mitigation |
|---|---|
| Per-manufacturer Android background restrictions (Samsung One UI, Xiaomi MIUI, etc.) | In-app permission guide screens; deep links to OS settings; battery-optimization exemption flow |
| Voice-provider pricing volatility | Deterministic TTS caching (same input → same output → same R2 object); monthly direct-input TTS quota (personal 30, KST); bounded clone pre-render manifest (21 clips per clone); ElevenLabs spend monitoring |
| Voice rights disputes | A registered voice is usable only by the account that registered it; in-app legal notice during voice registration; account deletion cascades remove voice data |

## 관련 문서

- [`voice-prompt-design.ko.md`](voice-prompt-design.ko.md) — 알람 문구 생성(Gemini → ElevenLabs v3) 설계 근거. 백엔드 코드 주석이 `§4.x` 로 이 문서를 참조한다.
- [`manual-message-reuse-plan.md`](manual-message-reuse-plan.md) — 직접 입력 문구 보관함(재사용·차감·수명) **기획서**. **일부 구현됨** — §3-1(차감 기준: 폰에 없어서 서버를 부를 때)과 §4(사용 기록)는 2026-09-07 에 들어갔고, 보관함 화면·서버 오디오 무기한 보관은 아직이다. 각 절 머리의 상태 표시를 볼 것.

## Non-negotiable Rules

1. The alarm ring path must use OS-native scheduling and local audio only.
2. Voice cloning and one-off TTS start only from explicit user actions. After the user previews a private draft and explicitly keeps it, that action may authorize one fixed, bounded, durable background job for the documented paid preset manifest. Background workers may not scan for new work or expand the authorized categories, and automated tests always stub paid providers.
3. Voice data is never shared with other accounts. External download is disabled by design.
