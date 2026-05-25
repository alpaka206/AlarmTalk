# iOS Android Parity Port (#368)

## Ground Rules

- Android source is the reference and must not be modified in this branch.
- iOS ring-time behavior must use local alarm records and local audio only.
- Network calls are allowed only during explicit foreground user actions such as login, sync, voice upload, TTS generation, or message sending.
- Windows workspace cannot run `xcodebuild`, Swift compiler, iOS simulator, or physical-device install. Those checks stay as required macOS/Xcode QA items before release.

## Current Baseline

| Area | Android Reference | iOS Current State | Gap |
| --- | --- | --- | --- |
| Auth | Email, Google login, session restore, profile update/delete, latest state gating | Apple + email login, Keychain restore, profile update/delete | Google is Android-only; iOS should keep Apple as platform equivalent. Need copy/status parity review. |
| Permissions | Exact alarm, notification, full-screen intent, battery guidance | AlarmKit + microphone gate | Platform-specific parity acceptable. Need final AlarmKit physical-device proof. |
| Alarm list | Local + remote alarms, sender labels, disabled/deleted voice handling | Local store + AlarmKit + remote sync | Need latest Android display copy and received-alarm metadata parity audit. |
| Alarm editor | Time wheel, repeat, holiday, snooze, vibration, play mode, voice picker, random prompt weather/fortune, shared voice setup preview | Time wheel, repeat, holiday, snooze, vibration, play mode, prepared voice flow, basic random prompt | Missing Android-level random prompt settings panes, weather/fortune inputs, shared voice selection/setup preview. |
| Alarm ring | AlarmManager full-screen service, local audio, volume ramp, snooze/dismiss, XP event | AlarmKit schedule, local sound staging, in-app voice fallback, App Intents | iOS AlarmKit limitations need device proof; volume-ramp parity is limited by AlarmKit/system sound behavior. |
| Voice creation | Record/upload, crop, speaker separation, clone, relationship/listener, slots, delete cascade | Voice recorder/upload/speaker separation/clone/profile management | Need latest Android shared voice card/modal copy/design and preview parity. |
| Shared voices | Family shared voices, viewer relationship/listener, no relation on card, preview before selection | Family voices and viewer info update | Missing `needs_viewer_info`, simplified card copy, modal preview/design parity. |
| Messages | Received/sent note flow, voice note audio availability, read after listen, timestamp with time | Received notes and send note/TTS note primitives | Need UI parity for message composer and voice audio freshness/read behavior. |
| Members/share code | Current group, share code refresh, one-member modal, owner/member permissions | MemberManagementView + vouchers | Need latest Android wording, refresh-on-open, member permission audit. |
| Billing | Plan cards, voucher/redeem/cancel/change, feature gates | StoreKit2 UI + backend voucher primitives | Platform-specific purchase path OK; need Android copy/gate parity where not IAP-specific. |
| Settings | Theme, nickname, weather, fortune, quiet time, account, permissions | Account, billing, people, growth, quiet time, permission section | Missing theme/nickname/weather/fortune modal parity. |
| Character/streak | XP queue and character card | CharacterEventStore and GrowthPanel | Need home/settings display parity audit. |

## Implementation Order

1. Shared voice and voice picker parity.
2. Dynamic prompt settings parity: random context, weather, fortune, request payload, local persistence.
3. Message UI and voice note audio freshness parity.
4. Member/share-code/billing/settings modal parity.
5. Alarm list/editor/ring QA pass against Android.
6. iOS-only AlarmKit limitation documentation and macOS QA checklist.

## Verification Plan

| Check | Environment | Status |
| --- | --- | --- |
| Android files unchanged | Windows git diff path filter | Passed: no `apps/android-native` diff in PR |
| Backend/DB unchanged and not deployed | Windows git diff path filter | Passed: no backend/db/migrations diff; no deploy performed |
| Backend tests/typecheck if API contracts touched | GitHub Actions | Passed: CI lint/typecheck/test + CodeQL |
| Swift compile/test | macOS + Xcode | Blocked in current Windows workspace |
| XcodeGen project generation | macOS + xcodegen | Blocked in current Windows workspace |
| Physical iPhone AlarmKit schedule/ring/snooze/dismiss | iOS 26+ device | Blocked in current Windows workspace |
| Screen-by-screen manual QA vs Android | Human/device | Static audit complete for core API/UI flows; device visual QA still required |

## Static Audit Notes

- `TtsGenerateResponse.remoteAudioURI` now mirrors Android's fallback:
  `audio_url ?: "r2://$audio_object_key"`. The value is reused for local TTS
  cache metadata, saved alarm remote audio URI, and voice-message sending.
- Voice-message TTS uses Android's `custom` category and refuses to send a text
  note if the generated TTS response has no remote audio identifier.
- Received remote alarms now downgrade to alarm-only when their voice audio
  cannot be cached locally, matching Android's local-file-only ring path.
- Follow-up verification still requires macOS/Xcode because this Windows
  workspace cannot run Swift, XcodeGen, simulator, or physical-device AlarmKit
  checks.
