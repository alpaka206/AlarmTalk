# Voice Alarm Android Native PoC

Phase 1-2 Android native alarm PoC. This project is intentionally scoped to local alarm reliability and local alarm app behavior only:

- Kotlin + Jetpack Compose + Material 3
- Room-backed local alarms
- alarm list, create, edit, delete, enable/disable
- repeat days, snooze minutes, vibration pattern, and play mode persistence
- `AlarmManager.setExactAndAllowWhileIdle`
- full-screen ringing activity through an alarm foreground service notification
- bundled local alarm tone generated into the APK at build time
- looping playback, repeating vibration, dismiss, snooze
- boot/package-replaced restore from local Room state

The alarm ring path does not use push notifications, server cron, network fetch, paid TTS/persona APIs, or the legacy React Native alarm runtime. Phase 2 stores `playMode` and local audio URI fields for later phases, but ringing still uses bundled local alarm audio.

## Build

```powershell
cd apps/android-native
.\gradlew.bat :app:assembleDebug
.\gradlew.bat :app:testDebugUnitTest
.\gradlew.bat :app:lintDebug
.\gradlew.bat :app:installDebug
```

If Android SDK is not auto-detected, create an ignored `local.properties`:

```properties
sdk.dir=C\:\\Users\\<you>\\AppData\\Local\\Android\\Sdk
```

## Physical Device Checklist

Use a real Android device. Keep logcat open in a separate terminal:

```powershell
adb logcat -c
adb logcat | findstr VoiceAlarm
```

Grant or open required permissions:

```powershell
adb shell pm grant com.voicealarm.nativeapp android.permission.POST_NOTIFICATIONS
adb shell appops set com.voicealarm.nativeapp SCHEDULE_EXACT_ALARM allow
adb shell cmd notification allow_full_screen_intent com.voicealarm.nativeapp
```

Some devices do not expose every command above. In that case, use the app's permission rows:

- Notifications: Android runtime notification permission.
- Exact alarms: system exact alarm access screen.
- Full screen: Android 14+ full-screen intent access screen.

### Foreground

1. Open the app.
2. Create a local alarm for the next few minutes, or use the 1 minute test alarm button.
3. Confirm OS registration:

```powershell
adb shell dumpsys alarm | findstr com.voicealarm.nativeapp
```

Expected: `VoiceAlarm` logs show `Scheduled exact alarm`, then `Alarm received`, `Ringing started`. Ringing screen opens, sound loops, vibration repeats until Dismiss.

### Background

1. Create a local alarm for the next few minutes, or use the 1 minute test alarm button.
2. Press Home or switch to another app.
3. Wait for the alarm.

Expected: full-screen ringing opens. Dismiss stops sound and vibration.

### Screen Off / Lock Screen

1. Create a local alarm for the next few minutes, or use the 1 minute test alarm button.
2. Turn the screen off and lock the device.
3. Wait for the alarm.

Expected: screen wakes and `RingingActivity` appears over the lock screen. Snooze schedules the next local alarm.

### Doze / Idle

Schedule an alarm first, then force idle:

```powershell
adb shell dumpsys battery unplug
adb shell dumpsys deviceidle force-idle
adb shell dumpsys alarm | findstr com.voicealarm.nativeapp
```

Wait for the alarm. After testing, restore the device:

```powershell
adb shell dumpsys deviceidle unforce
adb shell dumpsys battery reset
```

Expected: exact alarm fires in idle, using local DB state and bundled audio.

### Local Alarm CRUD

Use only local app controls and local storage:

1. Tap New alarm.
2. Change label, hour, minute, snooze, repeat days, vibration, and play mode.
3. Save and confirm the alarm appears in the list.
4. Confirm the next fire time is registered with the OS:

```powershell
adb shell dumpsys alarm | findstr com.voicealarm.nativeapp
```

5. Edit the alarm and confirm the OS registration changes.
6. Disable the alarm and confirm its OS alarm is cancelled.
7. Enable it again and confirm a new OS alarm is registered.
8. Delete it and confirm it disappears from the list and `dumpsys alarm`.

Expected: `VoiceAlarm` logs show create, update, enabled changed, deleted, and scheduled/cancelled events. No network calls are required.

Opening the alarm list also performs a startup sync from Room to `AlarmManager`, so future enabled alarms are restored and expired one-shot alarms are marked inactive.

### Dismiss / Snooze

1. Let an alarm ring.
2. Tap Snooze.
3. Confirm the next alarm is registered:

```powershell
adb shell dumpsys alarm | findstr com.voicealarm.nativeapp
```

4. Let it ring again and tap Dismiss.

Expected: Snooze logs `Alarm snoozed` and re-registers; Dismiss logs `Alarm dismissed` and stops playback/vibration.

For a repeating alarm, Dismiss keeps the alarm enabled and schedules the next selected repeat day. For a one-shot alarm, Dismiss disables it.

### Boot Restore Broadcast

Create a future alarm, then send the receiver broadcast. On some Android builds, including Samsung Android 13, shell cannot send the protected `BOOT_COMPLETED` action. Use the debug restore action for adb verification in that case; real reboot still uses `BOOT_COMPLETED`.

```powershell
adb shell am broadcast -a android.intent.action.BOOT_COMPLETED -n com.voicealarm.nativeapp/.alarm.BootCompletedReceiver
adb shell am broadcast -a com.voicealarm.nativeapp.action.DEBUG_RESTORE_ALARMS -n com.voicealarm.nativeapp/.alarm.BootCompletedReceiver
adb shell dumpsys alarm | findstr com.voicealarm.nativeapp
```

Expected: logs show `Restore receiver invoked` and `Boot restore complete`; pending local alarms are registered again with `AlarmManager`.
