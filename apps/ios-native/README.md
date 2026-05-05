# Voice Alarm iOS Native PoC

SwiftUI + AlarmKit scaffold for Phase 7. This is source-ready for Xcode on macOS, but it is not built in this Windows workspace.

## Scope

- SwiftUI app shell using the same mustard/navy/terracotta brand direction as Android and the legacy app.
- AlarmKit authorization request.
- One-shot test alarm scheduling.
- Weekly repeating alarm scheduling shape.
- Stop and snooze App Intent hooks with an AlarmKit `postAlert` snooze duration.
- WidgetKit Live Activity target for AlarmKit countdown/snooze presentation.
- Local alarm store for scheduled IDs.
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

## AlarmKit References

Apple documentation used for this PoC:

- https://developer.apple.com/documentation/AlarmKit
- https://developer.apple.com/documentation/AlarmKit/scheduling-an-alarm-with-alarmkit
- https://developer.apple.com/videos/play/wwdc2025/230/

The scheduling sample describes `AlarmManager.shared.requestAuthorization()`, `AlarmManager.AlarmConfiguration`, `Alarm.Schedule.Relative`, custom `AlarmAttributes`, `schedule(id:configuration:)`, and the `alarmUpdates` async sequence.

## Device Checklist

Use a real iPhone running an AlarmKit-capable iOS version and Xcode with the matching SDK.

1. Install the app from Xcode.
2. Tap Request Alarm Permission.
3. Tap 1 min test alarm.
4. Lock the device and wait for the alarm.
5. Confirm the alarm appears on Lock Screen and can be stopped.
6. Tap weekly repeat test and confirm it is accepted by AlarmKit.
7. Confirm the app records the scheduled alarm IDs locally.
8. Confirm stopping/snoozing updates the app after reopening through `alarmUpdates`.
9. Confirm the widget extension renders the snooze countdown on the Lock Screen/Dynamic Island path.

## Custom Sound Check

AlarmKit uses ActivityKit's `AlertConfiguration.AlertSound` for the alert sound parameter. Custom voice audio still needs a physical-device pass with the target iOS SDK, a short local audio asset, and the same file available to the app/widget bundle as required by the OS sound lookup path.

If AlarmKit custom sound support is insufficient or inconsistent on the target iOS release, the iOS UX should use AlarmKit's supported sound path and keep Android-style custom voice alarms as a cached pre-alarm or post-alarm in-app experience.
