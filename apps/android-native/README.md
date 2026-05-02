# Voice Alarm Android Native PoC

Phase 1-6 Android native alarm PoC. This project is intentionally scoped to local alarm reliability, local alarm app behavior, local alarm audio, user-triggered backend sync, social sharing, and post-alarm growth sync:

- Kotlin + Jetpack Compose + Material 3
- Room-backed local alarms
- alarm list, create, edit, delete, enable/disable
- repeat days, snooze minutes, vibration pattern, and play mode persistence
- local voice recording and local audio file selection
- 30 second voice audio limit
- `alarm_only`, `voice_only`, and `alarm_voice` playback modes
- app theme matched to the legacy mobile mustard/navy/terracotta tokens
- email/password auth against the deployed VoiceAlarm API
- Google ID-token auth support
- manual alarm metadata sync to the deployed VoiceAlarm API
- friend list, pending friend requests, and friend request creation
- family group, invite code creation/accept/revoke, and shared voice profile lookup
- post-alarm character XP event queue with manual sync
- character, streak, subscription, voucher, and unified code status surfaces
- `AlarmManager.setExactAndAllowWhileIdle`
- full-screen ringing activity through an alarm foreground service notification
- bundled local alarm tone generated into the APK at build time
- looping playback, repeating vibration, dismiss, snooze
- boot/package-replaced restore from local Room state

The alarm ring path does not use push notifications, server cron, network fetch, paid TTS/persona APIs, or the legacy React Native alarm runtime. Any later TTS output must be downloaded before scheduling and cached as a local audio file.

## Backend API

The native app defaults to the deployed API used by the legacy mobile app:

```text
https://voice-alarm-api.voicealarm.workers.dev/api/
```

Root health was verified with:

```powershell
Invoke-RestMethod -Uri https://voice-alarm-api.voicealarm.workers.dev/
```

Expected response includes `status: ok` and `db: ok`.

Current deployed auth support:

- Email/password: `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`.
- Google: protected routes accept a Google ID token as a bearer token, matching the legacy app behavior.
- Email-code login: intentionally skipped for the MVP because it needs backend code issuance, email delivery, expiration, throttling, and token exchange.
- Apple: iOS should add Sign in with Apple later. The current backend accepts Apple ID-token payloads on protected routes, but production-grade Apple JWKS signature verification still needs backend hardening before treating it as final.

No ElevenLabs, Perso, TTS generation, voice clone, diarization, checkout, or upload endpoints are called by this Android PoC.

### Google Sign-In Config

Google sign-in needs a Web OAuth client ID for `requestIdToken()`. The current debug build uses:

```text
Web client ID: 869967951972-6honvq43o8knpe8r71auengnd33rt5pb.apps.googleusercontent.com
Android client ID: 869967951972-a66elsu635bd8klj123ac16kc5m3hba0.apps.googleusercontent.com
```

Override the Web client ID with a Gradle property when needed:

```powershell
.\gradlew.bat -PvoiceAlarmGoogleWebClientId="YOUR_WEB_CLIENT_ID.apps.googleusercontent.com" :app:installDebug
```

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

### Local Voice Audio

1. Tap New alarm or edit an existing alarm.
2. In Voice audio, tap Record and grant microphone permission.
3. Stop before 30 seconds, or let the app stop at the 30 second limit.
4. Save with play mode `Voice` or `Alarm + Voice`.
5. Confirm the alarm rings without network access.

To verify file selection:

1. Tap Pick and choose an `audio/*` file.
2. Files longer than 30 seconds should be rejected.
3. Save and confirm `VoiceAlarm` logs show local audio caching.

Airplane-mode check:

```powershell
adb shell cmd connectivity airplane-mode enable
adb logcat -c
adb logcat | findstr VoiceAlarm
```

Expected: `alarm_only` loops bundled audio, `voice_only` loops the cached voice file, and `alarm_voice` repeats bundled alarm audio followed by the cached voice file. No fetch is allowed at ring time.

Restore radios after testing:

```powershell
adb shell cmd connectivity airplane-mode disable
```

### Backend Auth / Manual Sync

Network is only used when the user signs in or taps Sync now.

1. Open the app.
2. Sign in with email/password, or configure Google sign-in and continue with Google.
3. Create or edit local alarms.
4. Tap Sync now from the Account panel.
5. Watch logs:

```powershell
adb logcat | findstr VoiceAlarm
```

Expected:

- Local alarms keep ringing offline after sync.
- Sync logs `Backend alarm sync complete`.
- Alarm rows show `synced`, `changed`, `sync failed`, or `local only`.
- Local voice files are not uploaded automatically. If an alarm uses a device-local file, sync writes alarm metadata only and keeps the audio on-device.

To verify the ring path is still offline, sync once, enable airplane mode, then let a local alarm fire. Ringing should still use Room state and local audio only.

### Social / Sharing

Social APIs are user-triggered only:

1. Sign in.
2. Tap Refresh in People.
3. Send a friend request by email.
4. Accept any pending friend request.
5. Create a family invite as a family owner.
6. Join a family invite with a six digit code.
7. Confirm shared family voices are listed.

Expected:

- Friend/family errors from the backend are shown as app messages.
- Family invite actions use `/api/family/invites`.
- Shared voices use `GET /api/voice/family`.
- Shared-voice TTS generation is not called.

### Character / Billing

Dismiss and snooze enqueue local character events in Room:

- Dismiss queues `alarm_completed`.
- Snooze queues `alarm_snoozed`.
- Duplicate event nonces are ignored locally.
- Sync XP sends queued events to `POST /api/characters/xp`.

Verification flow:

1. Let an alarm ring and tap Dismiss.
2. Open the app and confirm Growth shows one queued event.
3. Sign in and tap Sync XP.
4. Tap Refresh in Growth.

Expected:

- Character/streak/XP refreshes from `/api/characters/me`.
- Subscription loads from `/api/billing/subscription`.
- Issued vouchers load from `/api/billing/vouchers`.
- Coupon or invite code entry uses `/api/code/register`.
- Checkout and paid provider APIs are not called.

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
