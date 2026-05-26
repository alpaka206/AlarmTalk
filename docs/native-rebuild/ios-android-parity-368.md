# iOS Android Parity Port (#368)

## Ground Rules

- Android source is the reference and must not be modified in this branch.
- Parity means matching product logic, API contracts, data semantics,
  permission gates, feature availability, and visual hierarchy. It does not mean
  forcing Android-specific microcopy or interaction patterns onto iOS when an
  iOS-native presentation is clearer.
- iOS may use platform-native affordances such as Apple sign-in, StoreKit,
  AlarmKit, SwiftUI sheets, and iOS permission flows as long as the resulting
  user journey, server communication, and local alarm guarantees remain
  equivalent to Android.
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

## iOS Adaptation Boundary

- Must match Android: server routes and payload semantics, local alarm storage
  invariants, ring-time local-only audio behavior, plan gates, ownership/member
  permissions, voice-sharing state transitions, message read/audio availability
  behavior, XP/idempotency rules, and paid-plan downgrade cascades.
- May be iOS-native: presentation components, sheet/navigation affordances,
  permission prompt timing when the platform requires it, Apple/StoreKit flows,
  AlarmKit-specific labels, and microcopy that is clearer on iOS while preserving
  the same product meaning.
- Should not be changed just for parity: Android-only implementation details,
  Android permission names, Android navigation mechanics, or literal Android
  text where iOS has a clearer native convention.

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
- iOS onboarding completion now mirrors Android's user-scoped storage: each
  signed-in user has an independent completion marker, with a one-time migration
  from the old global `onboarding_completed_v1` flag for the first migrated user.
- iOS auth user decoding now mirrors Android's session-store normalization:
  blank or null profile/plan values fall back to stable defaults, quiet-window
  settings are sanitized, and missing dynamic prompt settings decode as empty
  weather/fortune preferences.
- iOS access gating now mirrors Android's user-scoped access snapshot: recent
  subscription and family-group state is restored per signed-in user, refreshed
  snapshots are persisted, and logout/account switching clears in-memory
  social, voice, and remote-sync state.
- iOS account deletion now mirrors Android's cleanup path by clearing the
  deleted user's persisted access snapshot while leaving other user snapshots
  intact.
- iOS shared-pass and billing mutations now mirror Android's post-mutation
  session refresh: code registration, leaving a shared pass, subscription
  cancellation, StoreKit purchase success, and purchase restore refresh
  `/auth/me` after the foreground action.
- iOS dynamic-prompt preference saves now mirror Android's
  `updateDynamicPromptSettings` follow-up by refreshing social/family state
  after `/user/me` is updated.
- iOS family-alarm permission saves now mirror Android's request sanitizer:
  quiet windows are filtered to valid weekdays, capped at eight windows,
  rejected on invalid `HH:mm` times, and the first/default quiet window is sent
  through the legacy `family_alarm_quiet_*` fields alongside the window list.
- iOS voice-message sending now mirrors Android's ViewModel guardrails before
  calling TTS: recipient/profile IDs are trimmed and required, and voice-note
  text is rejected above 200 characters even outside the composer UI.
- iOS text-message sending now mirrors Android's `sendNote` guardrails by
  trimming the selected receiver ID before validation and before the `notes`
  request is sent.
- iOS message recipient selection now mirrors Android's `remember(recipients)`
  behavior: after a family-group refresh, a removed/stale recipient is replaced
  with the first current recipient and the current user is excluded by both id
  and email.
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
- iOS alarm completion/snooze XP events now use Android's
  `event:alarmId:localDate` client nonce format, so server idempotency and
  same-day duplicate handling match Android.
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
  `at_period_end` or `immediate` to the backend instead of immediately
  scheduling a period-end cancellation from the button.
- iOS code registration now mirrors Android's family connection panel:
  invite codes and gift/pass codes have separate inputs, active-pass users see
  the same "register after current pass" guidance, shared members confirm
  leaving the current pass before entering a new code, and registration uses an
  X-dismiss confirmation sheet.
- iOS code registration now also mirrors Android's post-registration routing:
  invite/`INV-` codes open the shared-pass/member sheet, while non-invite
  voucher codes return to the home tab after the refreshed session is applied.
- iOS alarm list now hides the developer-facing server sync card and removes
  row-level local/server/audio detail text and manual "server save" action so
  the user-facing list matches Android's simple time/label/toggle/warning
  structure.
- iOS alarm list now shows the AlarmKit permission card only while alarm
  authorization is missing, matching Android's alarm-tab behavior instead of
  keeping a granted-permission card on the main list.
- iOS alarm list ordering now matches Android's visible ordering by hour,
  minute, then creation time instead of sorting by the next fire date.
- iOS alarm-tab badge now mirrors Android's received-alarm badge semantics:
  the badge counts newly received remote alarms since the user's last alarm-tab
  visit instead of counting disabled alarms.
- iOS home now mirrors Android's profile menu and quick-start structure:
  profile opens code/character/billing/shared-pass/settings actions, while
  quick-start stays focused on `목소리`, `새 알람`, and `상대 알람 맞춰주기`
  with lock badges for unavailable voice/alarm capabilities.
- iOS home quick-start actions now mirror Android's permission gate behavior:
  voice entry requests microphone permission before opening the voice tab when
  the paid plan is available, and new/family alarm creation requests AlarmKit
  permission before opening the editor.
- iOS no longer auto-presents the startup permission sheet after onboarding;
  AlarmKit and microphone permission prompts stay tied to the home/alarm/voice
  actions that actually need them, matching the agreed iOS-native on-demand
  permission flow.
- iOS alarm-tab creation now follows the same iOS-native on-demand permission
  flow: tapping "알람 만들기" requests AlarmKit authorization first and opens
  the editor only after authorization is available.
- iOS family-alarm entry now mirrors Android's availability rule: the home
  shortcut requires login, couple/family access, and at least one recipient who
  allows family alarms, and the editor blocks family-alarm save without
  couple/family access.
- iOS bottom navigation and voice-tab header now use Android's visible
  `목소리` wording.
- iOS settings sheet now uses the same X-style modal dismissal affordance as
  the other iOS modal surfaces.
- iOS settings now mirrors Android's settings scope: screen mode, random
  prompt info, account, and delete account stay in Settings, while code,
  character, billing, and shared-pass navigation live only in the profile menu.
- iOS settings empty weather/fortune labels now use Android's `미설정`
  wording, and the account card no longer shows the extra email row.
- iOS voice management copy now consistently uses Android's user-facing
  `목소리` wording, including slot, selection, delete, and plan-gate text.
- iOS voice sharing availability now mirrors Android's `canShareVoiceWithOthers`
  rule: couple/family access or another shared member is required before share
  toggles can be enabled, and received shared voices are hidden when sharing is
  unavailable.
- iOS voice creation, speaker separation, billing plan descriptions, and voice
  error messages now use the same `목소리` / `유료 이용권` wording as Android.
- iOS voice clone requests now mirror Android's multipart shape: profile name is
  trimmed, relationship/listener fields are always included, `isDraft=false` is
  sent by default, and ViewModel clone/update paths validate relationship and
  listener labels before making the server call.
- iOS voice deletion now mirrors Android's recovery path: a server 404 is
  treated as an already-deleted voice, selected voice state is cleared, local
  alarms are downgraded to alarm-only, and voice state is refreshed.
- iOS voice deletion now also mirrors Android's `refreshNotesSilently()` follow-up
  by refreshing social/message state after deletion, so received voice-message
  play buttons disappear after the backend marks audio unavailable.
- iOS plan gating now uses a shared best-known tier from StoreKit entitlement,
  backend subscription, and the restored session plan. Home quick-start,
  alarm-editor voice modes, and voice creation use the same paid-voice gate.
- iOS root tab routing now mirrors Android's navigation gate: tapping the
  locked `목소리` tab opens the paid-plan dialog for free users, and tapping
  `메시지` without couple/family access opens the couple/family plan dialog.
- iOS root tabs now mirror Android's foreground refresh cadence: home refreshes
  social/billing/character state, voices refreshes voice plus social state,
  alarms refreshes remote alarm sync plus authorization, and messages refreshes
  social/message plus voice-message archive state on tab entry.
- iOS alarm editing now exposes Android's manual voice-message input,
  translation language selector, random prompt language selector, voice-only
  repeat choice, and per-alarm voice volume. The local alarm record now stores
  `voiceVolumePercent`, and the iOS voice player uses that value instead of
  reusing the alarm-sound volume.
- iOS alarm editing now also exposes Android's local `녹음/파일` voice source.
  It records up to 30 seconds, imports audio files, trims long files to the
  alarm-audio limit, previews the selected local audio, caches it through
  `AudioCacheStore`, and saves the alarm with `voiceSource = local_audio`.
- iOS alarm editing now mirrors Android's empty-name behavior: blank alarm
  names are accepted and saved with the default `"알람"` label instead of
  blocking the save.
- iOS new-alarm defaults now mirror Android's editor state: newly created
  alarms open at 06:00 with an empty editable label, while the plan-aware
  play-mode default remains alarm-only for free users and alarm + voice for
  paid users. Saving a blank label still stores `"알람"`.
- iOS alarm-volume defaults now mirror Android's 100% default for new,
  decoded-legacy, test, preview, and received-remote alarm records.
- iOS voice-volume editing now mirrors Android's 30-100% range: existing voice
  alarms below the UI minimum are normalized to 30% on edit/save, and validation
  reports the same lower bound.
- iOS alarm editing now keeps platform-native presentation while matching the
  Android product semantics: `음성만` hides alarm-sound controls because alarm
  sound is not part of that ring path, but the saved alarm volume is preserved
  for switching back to alarm-inclusive modes.
- iOS family-alarm creation now mirrors Android's local-voice branch: when a
  recipient alarm uses `녹음/파일`, the prepared local audio is uploaded through
  `/voice/upload` and the alarm is created through `/family/alarms/voice`
  instead of sending an unusable local-only file reference in `/alarms`.
- iOS alarm enable/disable now mirrors Android's `setEnabled`: enabling an
  alarm recalculates the next fire time, clears the snooze count and stale
  AlarmKit ID before rescheduling, while disabling clears the scheduled
  AlarmKit ID and marks remote-backed alarms dirty for push sync.
- iOS local alarm records now include Android's
  `dynamicVoicePreparedForFireAtMillis` field, and newly generated random
  voice alarms mark the generated audio as prepared for the saved fire time.
- iOS now mirrors Android's dynamic voice refresh path for future repeat
  occurrences: app launch, login/session refresh, foreground entry, and
  BGAppRefresh sync all scan due repeating random voice alarms, generate fresh
  TTS, cache it locally, update the alarm audio fields, and mark the current
  fire time as prepared.
- iOS TTS audio cache keys now mirror Android's `AlarmAudioStore.ttsCacheKey`
  rule: server-provided `cacheKey` wins, otherwise the key is derived from
  `tts-v2|profileId|normalizedText|category|language`. Alarm TTS, shared-voice
  preview, and dynamic voice refresh all use this Android-compatible key.
- iOS in-app alarm voice fallback now mirrors Android's voice playback cadence:
  the first voice play in a ring starts lower and fades to the per-alarm voice
  volume over 6 seconds, while repeat voice playback waits 900ms and continues
  at the target volume until the alarm is stopped or snoozed.
- iOS alarm deletion now mirrors Android's audio-cache cleanup: when a deleted
  alarm releases the last reference to an `audioCacheKey`, the cached voice
  audio is removed from `AudioCacheStore`.
- iOS received-remote-alarm pruning now deletes the local record only through
  the AlarmKit cancel path, so a failed OS alarm cancellation leaves the record
  in place for the next refresh instead of creating an orphan scheduled alarm.
- iOS free-plan downgrade handling now mirrors Android's voice lock cascade:
  once StoreKit entitlements have loaded and the best-known plan is confirmed
  below personal, local voice alarms are canceled/deleted and paid
  voice/message state is cleared.
- iOS billing-panel current-plan display now uses the same best-known plan
  resolver as the rest of the app, so inactive server subscription rows do not
  make the pass UI look paid.
- iOS alarm rows now expose Android's local copy behavior: copying an alarm
  creates a local-owned duplicate 10 minutes later, clears remote sync identity,
  schedules it with AlarmKit, and removes the duplicate if scheduling fails.
- iOS subscription cancellation now uses Android/backend's immediate-cancel
  request value (`immediate`) instead of the old UI-only `now` alias.
- iOS share-code preparation messages now use Android's active-plan label
  (`커플`, `가족`, or `공유`) instead of always saying "가족".
- iOS share-code creation now also upserts the returned voucher like Android,
  replacing stale rows with the same id and moving the fresh code to the top.
- iOS billing/code mutation failures now map backend `error_code` values to
  the same Korean user-facing messages Android uses for plan, checkout, cancel,
  and voucher failures.
- iOS shared-pass leave/remove-member messages now mirror Android's
  user-facing copy and fallback behavior instead of surfacing English server
  messages.
- iOS remote-alarm mapping now mirrors Android's request sanitizing and
  received-audio guard: `messageId` / `voiceProfileId` are trimmed before push,
  blank identifiers are omitted, and received remote alarms without
  `message_audio_url` are downgraded to alarm-only instead of trying to fetch
  unavailable voice audio.
- iOS remote-alarm pull now filters server results to alarms targeted at the
  current user and sent by someone else before importing, matching Android's
  received-alarm sync boundary and avoiding local-owned remote duplicates.
- iOS alarm editor no longer exposes the iOS-only "1분 테스트" action in the
  user-facing save section, matching Android's editor surface.
- iOS alarm saving now runs Android-style final validation before local upsert:
  repeat-day masks, alarm/voice volume bounds, cached voice audio, and duplicate
  local alarm times are rejected at the same boundary as Android's repository.
- iOS alarm editing now mirrors Android's fresh-TTS reuse path: existing voice
  alarms whose cached audio still matches the selected profile, prompt, category,
  and language can be saved without forcing a new TTS generation.
- iOS BGAppRefresh now mirrors Android's background worker message refresh:
  after remote alarm push/pull it silently refreshes received notes, so deleted
  or unavailable voice-message audio is reflected without waiting for the user to
  open the messages tab.
- iOS received-note refresh now also mirrors Android's `SocialNotificationTracker`
  behavior: the first refresh only seeds seen note IDs, later refreshes post up to
  three local notifications for newly received unread notes when iOS notification
  permission is already authorized.
- iOS received-remote-alarm import now mirrors Android's social notification
  behavior by posting a local notification for newly imported alarms when iOS
  notification permission is already authorized.
- iOS requests UserNotifications authorization lazily when the user opens the
  messages tab, keeping the permission prompt tied to the social update feature
  instead of adding another startup/settings permission surface.
- iOS alarm permission, scheduling, cancel, Live Activity button, and recording
  permission copy now uses Korean user-facing alarm wording instead of exposing
  English AlarmKit/internal status text.
- iOS app/widget display names and Live Activity fallback labels now mirror the
  Android `Waker` brand and Korean alarm-state wording instead of the old
  `Voice Alarm` placeholder.
- iOS social/message/member/character failure paths now use Android-style
  Korean fallback messages when backend or system errors are English, avoiding
  raw `Server error ...` text in user-visible status messages.
- iOS voice segment preview now mirrors Android's visible failure behavior by
  showing the Korean "preview playback failed" message instead of silently
  ignoring AVAudioPlayer errors during clone/separation preview.
- iOS auth/profile/account mutation errors now mirror Android's
  `userFacingError` behavior by preserving Korean backend messages and replacing
  English server/system errors with Korean fallback copy.
- iOS remote-alarm refresh, push, full-sync, and delete errors now use the same
  Android-style Korean fallback behavior instead of exposing raw server/system
  error text.
- iOS family-alarm create failures now use the same Korean fallback mapping
  before showing the validation alert, so backend/system English messages are
  not exposed from the alarm editor.
- Follow-up verification still requires macOS/Xcode because this Windows
  workspace cannot run Swift, XcodeGen, simulator, or physical-device AlarmKit
  checks.
