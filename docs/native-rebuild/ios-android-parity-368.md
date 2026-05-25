# iOS Android Parity Port (#368)

## Ground Rules

- Android source is the reference and must not be modified in this branch.
- iOS ring-time behavior must use local alarm records and local audio only.
- Network calls are allowed only during explicit foreground user actions such as login, sync, voice upload, TTS generation, or message sending.
- Windows workspace cannot run `xcodebuild`, Swift compiler, iOS simulator, or physical-device install. Those checks stay as required macOS/Xcode QA items before release.

## Current Baseline

| Area | Android Reference | iOS Current State | Gap |
| --- | --- | --- | --- |
| Auth | Email, Google login, session restore, profile update/delete, latest state gating | Apple + email login, Keychain restore, profile update/delete | Google is Android-only; Apple is the iOS platform equivalent. Need macOS sign-in QA. |
| Permissions | Exact alarm, notification, full-screen intent, battery guidance | AlarmKit + microphone gate | Platform-specific parity acceptable. Need final AlarmKit physical-device proof. |
| Alarm list | Local + remote alarms, sender labels, disabled/deleted voice handling | Local store + AlarmKit + remote sync with Android sender labels | Need macOS visual QA and received-alarm device pass. |
| Alarm editor | Time wheel, repeat, holiday, snooze, vibration, play mode, voice picker, random prompt weather/fortune, shared voice setup preview | Time wheel, repeat, holiday, snooze, vibration, play mode, voice picker, weather/fortune inputs, shared voice setup preview | Need macOS visual QA and physical-device save/schedule pass. |
| Alarm ring | AlarmManager full-screen service, local audio, volume ramp, snooze/dismiss, XP event | AlarmKit schedule, local sound staging, in-app voice fallback, App Intents | iOS AlarmKit limitations need device proof; volume-ramp parity is limited by AlarmKit/system sound behavior. |
| Voice creation | Record/upload, crop, speaker separation, clone, relationship/listener, slots, delete cascade | Voice recorder/upload/speaker separation/clone/profile management with shared-card/modal copy parity | Need macOS visual QA and physical record/upload pass. |
| Shared voices | Family shared voices, viewer relationship/listener, no relation on card, preview before selection | Family voices, viewer info update, simplified card copy, setup CTA, preview | Need macOS visual QA and final alarm-selection device pass. |
| Messages | Received/sent note flow, voice note audio availability, read after listen, timestamp with time | Received notes, text/TTS composer, audio freshness/read behavior with Android row/composer copy parity | Need macOS visual QA and device audio/read pass. |
| Members/share code | Current group, share code refresh, one-member modal, owner/member permissions | Code registration plus routed shared-pass member screen | Need macOS visual QA. |
| Billing | Plan cards, voucher/redeem/cancel/change, feature gates | StoreKit2 UI + backend voucher primitives with Android non-IAP copy/gate parity | Need macOS StoreKit/IAP QA. |
| Settings | Theme, nickname, weather, fortune, quiet time, account, permissions | Account, billing, people, growth, quiet time, theme/nickname/weather/fortune sheets with Android modal copy parity | Need macOS visual QA. |
| Character/streak | XP queue and character card | CharacterEventStore and GrowthPanel with Android stage/stat/recent-record display rules | Need macOS visual QA and physical-device ring-to-XP pass. |

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
- Received remote alarm labels now mirror Android's
  "`sender`님이 보낸 알람" / "상대가 보낸 알람" rules instead of using the
  message text as the alarm title.
- iOS app launch and foreground entry now recover enabled local alarms that are
  missing an AlarmKit runtime ID or were left in a failed state. Repeating
  alarms are moved to the next valid fire time before rescheduling; expired
  one-shot alarms are disabled and marked failed, matching Android boot-restore
  semantics.
- iOS fortune input now uses the Android-style date picker, preset birth-time
  choices, exact time picker, and "time unknown" option in both settings and
  alarm-editor random prompt flows.
- iOS weather-region input now mirrors Android's explicit "use current
  location" action. It requests When-In-Use location permission only when the
  user taps the button, reverse geocodes to country/city, and still supports
  manual entry.
- iOS theme and nickname settings now mirror Android's modal copy and states:
  selected theme rows use the same icon/card/selected badge treatment, and the
  nickname sheet adds the Android-style guidance card, placeholder, 30-character
  counter, busy dismissal lock, and save-disabled-until-changed behavior.
- iOS message composer now uses Android-style section cards and chips for
  recipient, send mode, and voice selection, including the same message
  placeholder, counter, and send-disabled-until-valid behavior.
- iOS shared voices now map the server `needs_viewer_info` state through
  `requiresViewerInfo`, keep relationship/listener hidden on the shared voice
  card, show the same setup CTA, and expose the shared voice setup/preview flow
  from both the voice tab and alarm editor selection path.
- iOS alarm-editor shared voice rows now match Android's simplified copy:
  shared voices show only the voice name plus "`owner`님에게 공유받은 목소리",
  while missing viewer info is handled by opening the setup sheet on selection
  instead of showing a separate "설정 필요" badge.
- iOS character home/settings display now mirrors Android's visible rules:
  stage is shown as the same seed/sprout/tree/bloom emoji, the settings header
  uses `LV.n 단계명`, stat tiles use `성실함/꾸준함/건강/애정도`, recent records
  show time plus XP only, and the iOS-only manual XP button/achievement/extra XP
  rows are no longer shown in the growth panel.
- Member management now exposes the family-alarm permission and quiet-window
  editor used by Android's shared-plan screen. The shared-pass screen is now
  routed from home/settings when a group exists, keeps code registration as the
  no-group path, refreshes before sharing a code, and uses Android's current
  "공유 이용권" wording.
- iOS billing now mirrors Android's voucher share behavior: plan cards with
  unused issued/active/pending vouchers expose "이용권 코드 공유", refresh the
  subscription/voucher state before opening, and show a selection sheet even
  when only one code is available.
- iOS billing cancellation now opens an Android-style choice sheet and passes
  `at_period_end` or `now` to the backend instead of immediately scheduling a
  period-end cancellation from the button.
- iOS code registration now mirrors Android's family connection panel:
  invite codes and gift/pass codes have separate inputs, active-pass users see
  the same "register after current pass" guidance, shared members confirm
  leaving the current pass before entering a new code, and registration uses an
  X-dismiss confirmation sheet.
- iOS alarm list now hides the developer-facing server sync card and removes
  row-level local/server/audio detail text and manual "server save" action so
  the user-facing list matches Android's simple time/label/toggle/warning
  structure.
- iOS alarm list now shows the AlarmKit permission card only while alarm
  authorization is missing, matching Android's alarm-tab behavior instead of
  keeping a granted-permission card on the main list.
- iOS home now mirrors Android's profile menu and quick-start structure:
  profile opens code/character/billing/shared-pass/settings actions, while
  quick-start stays focused on `목소리`, `새 알람`, and `상대 알람 맞춰주기`
  with lock badges for unavailable voice/alarm capabilities.
- iOS bottom navigation and voice-tab header now use Android's visible
  `목소리` wording.
- iOS settings sheet now uses the same X-style modal dismissal affordance as
  the other iOS modal surfaces.
- iOS plan gating now uses a shared best-known tier from StoreKit entitlement,
  backend subscription, and the restored session plan. Home quick-start,
  alarm-editor voice modes, and voice creation use the same paid-voice gate.
- iOS alarm editing now exposes Android's manual voice-message input,
  translation language selector, random prompt language selector, voice-only
  repeat choice, and per-alarm voice volume. The local alarm record now stores
  `voiceVolumePercent`, and the iOS voice player uses that value instead of
  reusing the alarm-sound volume.
- iOS alarm editing now also exposes Android's local `녹음/파일` voice source.
  It records up to 30 seconds, imports audio files, trims long files to the
  alarm-audio limit, previews the selected local audio, caches it through
  `AudioCacheStore`, and saves the alarm with `voiceSource = local_audio`.
- Follow-up verification still requires macOS/Xcode because this Windows
  workspace cannot run Swift, XcodeGen, simulator, or physical-device AlarmKit
  checks.
