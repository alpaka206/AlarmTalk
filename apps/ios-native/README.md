# Voice Alarm iOS Native PoC

SwiftUI + AlarmKit scaffold for Phase 7. This is source-ready for Xcode on macOS, but it is not built in this Windows workspace.

## Scope

- SwiftUI app shell using the same mustard/navy/terracotta brand direction as Android and the legacy app.
- Native Sign in with Apple using `AuthenticationServices`.
- Backend `/api/auth/apple` session exchange and app JWT storage in Keychain.
- AlarmKit authorization request.
- One-shot alarm scheduling.
- Weekly repeating alarm scheduling.
- Stop and snooze App Intent hooks with an AlarmKit `postAlert` snooze duration.
- WidgetKit Live Activity target for AlarmKit countdown/snooze presentation.
- Local alarm store for scheduled IDs.
- Microphone recording for voice samples.
- Voice-clone upload flow with backend duration validation.
- TTS generation, local audio cache, and in-app preview.
- Voice-backed local alarm records with cached audio metadata.
- Backend alarm list/create/update/delete API client.
- Voice profile list/update/delete, voice clone upload, raw voice upload, speaker separation API client.
- TTS generate/message/audio API client for Android-parity backend communication.
- AlarmKit limitation notes and physical-device checklist.

The iOS ring path must not depend on push, APNs, server cron, or network fetch. Critical Alerts are not assumed as the default strategy.

## Generate Project

On macOS:

```bash
cd apps/ios-native
brew install xcodegen
xcodegen generate
open VoiceAlarmNative.xcodeproj
```

For a command-line compile check without signing:

```bash
cd apps/ios-native
bash scripts/build-debug.sh
```

In Xcode:

1. Select the `VoiceAlarm` target.
2. Set a development team.
3. Confirm the bundle ID matches the backend `APPLE_CLIENT_ID` env value.
4. Confirm Signing & Capabilities includes **Sign in with Apple**.
5. Run on a physical iPhone with iOS 26+.

The app reads `VOICE_ALARM_API_BASE_URL` from `VoiceAlarm/Info.plist`. The default is production:

```text
https://voice-alarm-api.voicealarm.workers.dev/api
```

## Backend Requirements

- Apply migration `35_apple-login-users`.
- Set `APPLE_CLIENT_ID` to the iOS bundle ID, for example `com.voicealarm.nativeapp.ios`.
- Deploy the backend before testing Apple login from the iOS app.

The app exchanges the Apple identity token at `POST /api/auth/apple`, stores the returned app JWT in Keychain, and uses that app JWT for all backend calls.

## AlarmKit References

Apple documentation used for this PoC:

- https://developer.apple.com/documentation/AlarmKit
- https://developer.apple.com/documentation/AlarmKit/scheduling-an-alarm-with-alarmkit
- https://developer.apple.com/videos/play/wwdc2025/230/

The scheduling sample describes `AlarmManager.shared.requestAuthorization()`, `AlarmManager.AlarmConfiguration`, `Alarm.Schedule.Relative`, custom `AlarmAttributes`, `schedule(id:configuration:)`, and the `alarmUpdates` async sequence.

## Device Checklist

Use a real iPhone running an AlarmKit-capable iOS version and Xcode with the matching SDK.

1. Install the app from Xcode.
2. Sign in with Apple and confirm `/api/auth/apple` returns an app JWT.
3. Tap AlarmKit permission and grant access.
4. Create a one-time local alarm a few minutes in the future.
5. Lock the device and wait for the alarm.
6. Confirm the alarm appears on Lock Screen and can be stopped.
7. Create a weekly repeat alarm and confirm AlarmKit accepts it.
8. Save a local alarm to the server and confirm it appears in `/api/alarm`.
9. Relaunch the app and confirm Keychain session restore, server alarm refresh, and local alarm storage.
10. Confirm stopping/snoozing updates the app after reopening through `alarmUpdates`.
11. Confirm the widget extension renders the snooze countdown on the Lock Screen/Dynamic Island path.
12. Record 60-120 seconds of voice, upload it for cloning, and confirm the profile returns as `ready`.
13. Generate a Korean TTS wake phrase, preview the cached local audio, then create an alarm with `voice_only` or `alarm_voice`.

## Custom Sound Check

AlarmKit uses ActivityKit's `AlertConfiguration.AlertSound` for the alert sound parameter. Custom voice audio still needs a physical-device pass with the target iOS SDK, a short local audio asset, and the same file available to the app/widget bundle as required by the OS sound lookup path.

If AlarmKit custom sound support is insufficient or inconsistent on the target iOS release, the iOS UX should use AlarmKit's supported sound path and keep Android-style custom voice alarms as a cached pre-alarm or post-alarm in-app experience.
