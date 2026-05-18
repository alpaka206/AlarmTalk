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
