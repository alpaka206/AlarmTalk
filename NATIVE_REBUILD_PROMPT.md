# Voice Alarm Native Rebuild Prompt

## Goal

Rebuild Voice Alarm as a production-grade native alarm app.

The product is not a notification/reminder app. It must behave like a real alarm clock:

- The alarm rings at the scheduled time.
- It works when the screen is off.
- It works on the lock screen.
- It survives Doze / idle mode on Android.
- It restores scheduled alarms after device reboot.
- It plays the selected local alarm sound, TTS voice, original recording, or alarm + voice sequence.
- It supports snooze, dismiss, vibration, and repeat days.

Use the existing repository only as a reference and backend source. Do not try to repair the React Native alarm runtime.

## Current Source Context

Repository branch: `develop_loop`

Useful assets to reuse:

- Cloudflare Workers + Hono backend
- Turso/libSQL schema and API contracts
- perso.ai / TTS backend integration
- voice profile, message, alarm, invite, character domain ideas
- design tokens, colors, typography, UX references
- existing tests as behavioral references

Do not rely on these existing runtime pieces:

- React Native / Expo alarm execution
- `alarmRinger.ts`
- `notifeeAlarms.ts`
- server cron / FCM mock as the primary alarm trigger
- Expo notification behavior

## Target Stack

### Android first

- Kotlin
- Jetpack Compose
- Material 3
- Hilt
- Retrofit / OkHttp
- Kotlinx Serialization or Moshi
- Room
- DataStore
- AlarmManager
- Foreground Service for ringing playback
- Full-screen Activity / intent for ringing screen
- BootCompletedReceiver
- MediaPlayer or ExoPlayer / Media3 for local audio playback

### iOS later, but validate early

- Swift
- SwiftUI
- AlarmKit PoC first
- Local audio file playback feasibility check
- One-time alarm, repeating alarm, snooze, dismiss

Do not make Critical Alert entitlement the default iOS plan until AlarmKit limitations are verified.

## Development Strategy

Use Android-first implementation because only Android physical device testing is currently available.

Do not build the full app before proving the alarm engine.

### Milestone 1: Android alarm engine PoC

Acceptance criteria:

- User can create a local test alarm for 1-5 minutes later.
- Alarm is registered in Android OS alarm service.
- Alarm rings when app is foregrounded.
- Alarm rings when app is backgrounded.
- Alarm rings when screen is off / device is locked.
- Alarm rings in forced idle / Doze test.
- Ringing screen opens full-screen.
- Sound loops until dismissed.
- Vibration works until dismissed.
- Snooze schedules the next alarm.
- Reboot receiver restores scheduled alarms from local database.

Suggested verification commands:

```bash
./gradlew installDebug
adb logcat | findstr VoiceAlarm
adb shell dumpsys alarm | findstr voicealarm
adb shell dumpsys deviceidle force-idle
adb shell am broadcast -a android.intent.action.BOOT_COMPLETED
```

### Milestone 2: Android local alarm data

Acceptance criteria:

- Room stores alarms locally.
- Repeat weekdays are persisted.
- Snooze minutes and vibration pattern are persisted.
- Alarm play mode is persisted:
  - `alarm_only`
  - `voice_only`
  - `alarm_voice`
- Audio source is persisted:
  - bundled default alarm
  - downloaded TTS audio
  - user recording
  - uploaded original file
- Alarm schedules are derived from local data, not network state.

### Milestone 3: Android MVP UI

Acceptance criteria:

- Compose alarm list
- Create alarm screen
- Edit alarm screen
- Snooze settings screen
- Vibration settings screen
- Ringing screen
- Local audio preview
- Permission onboarding for exact alarms, notifications, full-screen intent, battery optimization if needed

### Milestone 4: Backend integration

Acceptance criteria:

- Reuse existing backend env values supplied by the user.
- Auth works.
- Alarm CRUD syncs with backend.
- Voice profiles load from backend.
- TTS generation downloads/caches audio before scheduling.
- Alarm ring path never depends on live network.

### Milestone 5: iOS feasibility PoC

Acceptance criteria:

- SwiftUI app schedules an AlarmKit one-time alarm.
- SwiftUI app schedules an AlarmKit repeating weekly alarm.
- Snooze and dismiss behavior are verified.
- Custom/local voice sound behavior is verified on the best available simulator/device path.
- Document any iOS limitation before implementing full iOS parity.

## Common Domain Model

Design Android and iOS around a shared product contract:

```text
Alarm
- id
- timeLocal HH:mm
- repeatDays: 0-6
- enabled
- snoozeMinutes
- vibrationPattern: default | strong | none
- playMode: alarm_only | voice_only | alarm_voice
- defaultAlarmSoundId
- voiceProfileId
- messageId
- localAudioUri
- rawAudioUri
- nextFireAt
- createdAt
- updatedAt

AlarmState
- scheduled
- ringing
- snoozed
- dismissed
- missed
- failed
```

## Non-negotiable Rules

- Do not trigger alarms from server cron.
- Do not depend on push notifications for core alarm behavior.
- Do not fetch audio at ring time.
- Do not start with social, character, billing, or family features.
- Do not optimize UI before alarm reliability is proven.
- Do not assume iOS can exactly copy Android until AlarmKit is tested.
- Keep environment files out of git; the user will provide env values.

## First Task Request

Start by creating the Android native project inside this repository, preferably under:

```text
apps/android-native/
```

Then implement Milestone 1 only:

1. Set up Kotlin + Jetpack Compose + Material 3.
2. Add a local test alarm creation screen.
3. Store the test alarm locally.
4. Schedule it with `AlarmManager`.
5. Open a full-screen ringing Activity when the alarm fires.
6. Play a looping bundled alarm sound.
7. Vibrate until dismissed.
8. Add snooze.
9. Add boot receiver restoration.
10. Provide exact physical-device test instructions.

Stop after Milestone 1 is verifiable on a real Android phone.

