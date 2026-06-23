# Product

## Vision

> "Wake up to the voice you want to hear."

AlarmTalk replaces beep-style mechanical alarms with a voice the user picked — recorded, uploaded, shared by family or partner, or generated from an AI voice clone. The product treats the alarm as an emotional, relational moment, not just a reminder.

## Core Values

| Value | Description |
|---|---|
| Real alarm | OS-native alarm engine. Rings on lock screen, Doze, and offline. No push, no server cron, no fetch at ring time. |
| Voice-first | Four paths to "whose voice wakes you": record, upload, share within a group, AI clone. |
| Relational | Family / partner groups share voice profiles and create alarms for each other. |
| Growth feedback | Completing alarms grows an in-app character and accumulates a wake-up streak. |

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

## Plan Tiers (hypothesis — to be confirmed before launch)

| Plan | Audience | Limits |
|---|---|---|
| Free | Individual trial | 1 voice profile, 5 TTS/day |
| Personal | Individual | 2 voice profiles, 30 TTS/day |
| Couple | 2 people | Voice sharing, 2 members |
| Family | Family | Voice sharing, up to 5 members |

Exact pricing will be set after PSM (Price Sensitivity Meter) research with target users. Until then, treat any price number as a placeholder.

## Roadmap

### Completed

- **Phase 1**: Android alarm engine (`AlarmManager.setAlarmClock`, full-screen ringing activity, boot restore)
- **Phase 2**: Android local alarm app (Room storage, repeat days, snooze, vibration, modes)
- **Phase 3**: Android audio & voice (in-app recording, file upload with 30-second trim, TTS caching, airplane-mode playback)
- **Phase 4**: Backend integration (email/Google/Apple auth, manual alarm metadata sync, deterministic TTS cache)
- **Phase 5**: Social & sharing (friends, family group with 6-digit invite code, shared voice profiles)
- **Phase 6**: Character, streak & billing stub (4 stages: egg / chick / chicken / golden chicken; XP, affection, milestones)

### In progress

- **Phase 7**: iOS native PoC (SwiftUI + AlarmKit, WidgetKit Live Activity)

### Before public launch

- Real-payment integration (Toss Payments / Google Play Billing / Apple IAP)
- iOS 1.0 release after AlarmKit custom-sound limits are verified on physical devices
- Apple ID-token JWKS hardening on the backend
- Localization for English and Japanese (Korean is the base)

## Risks

| Risk | Mitigation |
|---|---|
| Per-manufacturer Android background restrictions (Samsung One UI, Xiaomi MIUI, etc.) | In-app permission guide screens; deep links to OS settings; battery-optimization exemption flow |
| iOS AlarmKit may not fully support custom sounds in all scenarios | PoC verification on physical iOS 26+ devices before iOS 1.0; fallback as pre/post in-app voice playback if needed |
| ElevenLabs pricing volatility | Deterministic TTS caching (same input → same output → same R2 object); daily TTS cap per plan; contractual fallback to Perso when its direct voice-clone TTS API becomes available |
| Voice rights disputes | Sharing only inside a user's family/partner group; in-app legal notice during voice registration; account deletion cascades remove voice data |

## Non-negotiable Rules

1. The alarm ring path must use OS-native scheduling and local audio only.
2. Voice AI calls (cloning, TTS) only happen on explicit user actions, never from background tasks or automated tests.
3. Voice data is only shared inside a user's family/partner group. External download is disabled by design.
