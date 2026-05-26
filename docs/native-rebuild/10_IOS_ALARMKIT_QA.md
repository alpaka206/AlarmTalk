# iOS AlarmKit QA Gate

This file is the release gate for the native iOS app. Do not claim iOS parity until this checklist passes on a physical iPhone running the target iOS 26+ release.

## Required Setup

- Xcode with the target iOS SDK.
- Physical iPhone signed into an Apple Account with two-factor authentication.
- `VoiceAlarm` target has the Sign in with Apple capability.
- Backend deployed with:
  - migration `35_apple-login-users`
  - `APPLE_CLIENT_ID=com.voicealarm.nativeapp.ios`
- `VoiceAlarm/Info.plist` includes:
  - `NSAlarmKitUsageDescription`
  - `NSSupportsLiveActivities`
  - `VOICE_ALARM_API_BASE_URL`

## Auth QA

1. Fresh install.
2. Tap Sign in with Apple.
3. Grant name/email scopes.
4. Confirm the app receives an Apple identity token.
5. Confirm `POST /api/auth/apple` returns an app JWT.
6. Relaunch the app and confirm the Keychain session restores.
7. Revoke the Apple credential in Settings and confirm the app returns to login or refresh fails cleanly.

## AlarmKit QA

1. Request AlarmKit authorization.
2. Deny once and confirm the app does not schedule alarms.
3. Reinstall or reset permission state, grant authorization, and continue.
4. Schedule a one-time alarm for 1-5 minutes ahead.
5. Lock the phone and confirm the alarm appears on the Lock Screen.
6. Confirm Stop ends the alarm.
7. Schedule an alarm with Snooze, tap Snooze, and confirm countdown Live Activity appears.
8. Schedule a weekly repeating alarm and confirm AlarmKit accepts the schedule.
9. Reopen the app and confirm `alarmUpdates` reconciles stopped/canceled alarms.

## Backend Sync QA

1. Tap server refresh after login.
2. Confirm `/api/alarm` and `/api/voice` are called with the app JWT.
3. Save a local alarm to the backend.
4. Relaunch the app and confirm the remote alarm list includes it.
5. Delete/cancel a local alarm and confirm the remote delete path works for synced alarms.
6. Generate TTS through `/api/tts/generate` with a ready voice profile and confirm a message ID, audio URL/object key, and cache key are returned.
7. Upload voice-clone audio through `/api/voice/clone` and confirm duration validation, plan gating, and the one-profile limit match Android.
8. Upload raw audio through `/api/voice/upload`, run `/api/voice/uploads/:id/separate`, and confirm speaker segments are decoded.
9. Confirm generated TTS audio is written under the app's local audio cache before the alarm is scheduled.
10. Create `voice_only` and `alarm_voice` local alarms and confirm `/api/alarm` receives `wake_mode=voice_only` or `wake_mode=sound_then_voice` with the generated `message_id`.

## PR #369 Android Parity QA

Use this checklist before taking the PR out of draft. It covers the iOS ported
surface that cannot be proven from this Windows workspace.

### Build Gate

1. From `apps/ios-native`, run `xcodegen generate`.
2. Open `VoiceAlarmNative.xcodeproj`.
3. Run the `VoiceAlarmTests` test target.
4. Build and install `VoiceAlarm` on a physical iPhone.
5. Confirm the widget extension is embedded and the app launches without a
   missing entitlement, signing, or Info.plist error.

### Navigation And Refresh

1. Sign in, quit the app, relaunch, and confirm the Keychain session restores.
2. Visit Home, Alarms, Voices, and Messages tabs.
3. Confirm each tab refreshes the expected latest state without visible stale
   plan/social/voice status jumps.
4. Confirm free users are gated from paid voice features and message features.
5. Confirm paid users default new alarms to `alarm + voice`, while free users
   still default to alarm-only.

### Alarm Editor

1. Create a blank-name alarm and confirm it saves as the default alarm label.
2. Confirm the play-mode order is `alarm + voice`, `alarm`, `voice`.
3. Confirm voice volume is editable from 30-100% and is separate from alarm
   sound volume.
4. Save server TTS, local recording, and imported-file voice alarms.
5. Confirm local recording/imported audio is cached before scheduling.
6. Confirm duplicate local alarm times are rejected.
7. Confirm repeat days, holiday-off, snooze, vibration, random weather, and
   random fortune settings persist after reopening the editor.

### Ring Path

1. Schedule alarm-only, voice-only, and alarm-plus-voice alarms a few minutes
   ahead.
2. Lock the phone and verify AlarmKit fires each alarm.
3. Stop and snooze from the alarm UI and confirm local state updates after
   reopening the app.
4. For voice playback fallback, confirm the first voice starts quieter and fades
   up, while repeated voice playback stays at the target volume.
5. Turn off network before the alarm fires and confirm the ring path still uses
   local records and local audio only.

### Voice Studio

1. Record 60-120 seconds and create a voice profile.
2. Import an audio file, crop it, and create a voice profile.
3. Import a video file and confirm audio is extracted before upload.
4. Run speaker separation, preview each draft voice, promote one draft, and
   confirm unselected drafts are cleaned up.
5. Delete a voice profile and confirm related local alarms downgrade to
   alarm-only.
6. After voice deletion, refresh messages and confirm unavailable voice-message
   rows no longer show a play button.

### Shared Voices

1. On a shared plan, confirm own voice cards show only the voice name, share
   toggle, and shared badge.
2. Confirm relationship/listener labels are managed only in the info/setup
   sheet, not on the card.
3. From another account, receive a shared voice and confirm the row reads
   "`owner`님에게 공유받은 목소리".
4. Select a shared voice without viewer info from the alarm editor.
5. Confirm the setup sheet opens first, includes preview playback, and requires
   relationship/listener labels before selection.

### Messages

1. Send a text message and a voice message to a shared member.
2. Confirm sent/received timestamps show date and time.
3. Confirm voice-message text stays hidden until the audio is listened to.
4. Confirm marking one message as read updates only that row.
5. Delete the source voice and refresh; confirm the play button disappears for
   affected voice messages.

### Shared Pass And Billing

1. Open the profile menu and confirm code, shared-pass, billing, character, and
   settings routes match the Android structure.
2. Register an invite code and confirm routing opens the shared-pass/member
   screen.
3. Register a non-invite voucher and confirm routing returns to Home after the
   refreshed session is applied.
4. Open share-code flow and confirm it refreshes voucher/capacity state before
   showing a share sheet, including the one-code case.
5. As an owner, remove another member; as a member, confirm remove-member is not
   available.
6. Use StoreKit local configuration to test purchase, restore, cancel at period
   end, and immediate cancel states.

### Settings And Auxiliary Sheets

1. Confirm all modal-style sheets use the X dismissal affordance.
2. Confirm theme, nickname, weather location, fortune info, quiet time, billing,
   code, and message composer sheets match the Android information hierarchy
   while using iOS-native controls.
3. Confirm location permission is requested only from the explicit current
   location action.
4. Confirm settings no longer exposes startup permission status rows that are
   only needed when a gated feature is used.

### Character And XP

1. Complete and snooze alarms, then confirm XP events are queued with the
   Android nonce format `event:alarmId:localDate`.
2. Reopen the app and confirm pending XP flushes to the backend.
3. Confirm the character card, growth panel, stage label, stats, streak, and
   recent records match Android-visible rules.

## Ring Path Rule

At the moment an alarm fires, the iOS app must not require:

- APNs
- server cron
- live network fetch
- AI/TTS generation

AlarmKit and locally persisted state are the only acceptable ring-path dependencies.

## Custom Voice Sound Gate

Android-style voice-only and alarm-plus-voice parity is blocked until this is verified on the target iOS release:

1. Bundle a short local sound that follows Apple's alert sound requirements.
2. Schedule an AlarmKit alarm with `AlertConfiguration.AlertSound.named`.
3. Confirm it plays when locked, in silent mode, Focus, StandBy, and Apple Watch forwarding paths.
4. Confirm downloaded/generated voice files can be made available through an OS-supported sound lookup path.

If any custom sound scenario fails, iOS must ship with the supported AlarmKit sound path and clearly label Android-style custom voice playback as unavailable or limited on iOS.
