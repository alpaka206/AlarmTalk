# Voice Alarm Android Native PoC

Phase 1-6 Android native alarm PoC. This project is intentionally scoped to local alarm reliability, local alarm app behavior, local alarm audio, user-triggered backend sync, social sharing, and post-alarm growth sync:

- Kotlin + Jetpack Compose + Material 3
- Room-backed local alarms
- alarm list, create, edit, delete, enable/disable
- repeat days, snooze minutes, vibration pattern, and play mode persistence
- local voice recording and local audio file selection
- 30 second voice audio limit
- reusable local audio cache keys for generated TTS, recordings, and selected files
- copy alarm action that reuses the cached local audio file
- `alarm_only`, `voice_only`, and `alarm_voice` playback modes
- app theme matched to the legacy mobile mustard/navy/terracotta tokens
- email/password auth against the deployed VoiceAlarm API
- Google ID-token auth support
- manual alarm metadata sync to the deployed VoiceAlarm API
- friend list, pending friend requests, and friend request creation
- family group, invite code creation/accept/revoke, and shared voice profile lookup
- post-alarm character XP event queue with manual sync
- character, streak, subscription, voucher, and unified code status surfaces
- `AlarmManager.setAlarmClock`
- full-screen ringing activity through a high-importance alarm foreground-service notification carrier
- bundled local alarm tone generated into the APK at build time
- looping playback, repeating vibration, dismiss, snooze
- boot/package-replaced restore from local Room state

The ringing screen is a dedicated non-resizeable `RingingActivity` task. It uses `showWhenLocked` / `turnScreenOn` and hides system bars, but it does not request keyguard dismissal; the intended behavior is to appear over the lock screen, not to unlock into the normal app task.

The alarm ring path does not use push notifications, server cron, network fetch, paid TTS/persona APIs, or the legacy React Native alarm runtime. Any later TTS output must be downloaded before scheduling and cached as a local audio file.

## Backend API

The native app debug build defaults to the deployed dev API:

```text
https://api-dev.alarm-talk.com/api/
```

Root health was verified with:

```powershell
Invoke-RestMethod -Uri https://api-dev.alarm-talk.com/health
```

Expected response includes `status: ok` and `db: ok`.

Current deployed auth support:

- Email/password: `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`.
- Google: protected routes accept a Google ID token as a bearer token, matching the legacy app behavior.
- Email-code login: intentionally skipped for the MVP because it needs backend code issuance, email delivery, expiration, throttling, and token exchange.
- Apple: iOS should add Sign in with Apple later. The current backend accepts Apple ID-token payloads on protected routes, but production-grade Apple JWKS signature verification still needs backend hardening before treating it as final.

Provider-costing endpoints are only called from explicit user actions such as saving a new voice-profile TTS alarm or cloning a voice profile. Automated QA should not tap those paths unless provider credit spend is intended.

### Voice Provider Status

- ElevenLabs is the active direct voice provider. The backend uses its Instant Voice Clone flow and `POST /v1/text-to-speech/:voice_id` TTS flow.
- Perso remains first in the product strategy, but the currently public Perso developer surface is video dubbing, lip sync, media, editing, STT, audio separation, and language APIs. Direct `voice_id` cloning/TTS is treated as unavailable until that API contract is confirmed.
- The backend provider layer keeps Perso first in the attempt chain, but the current Perso direct clone/TTS attempt exits locally as unsupported and falls through to ElevenLabs without making an uncertain paid Perso call.
- References: ElevenLabs TTS `https://elevenlabs.io/docs/api-reference/text-to-speech/convert`, ElevenLabs Instant Voice Clone `https://elevenlabs.io/docs/eleven-api/guides/how-to/voices/instant-voice-cloning`, Perso developers `https://developers.perso.ai/overview`.

### Google Sign-In Config

Google sign-in needs a Web OAuth client ID for `requestIdToken()`. Android OAuth clients are console registrations for package name + SHA-1 and are not read by app code.

```text
Dev applicationId: com.alarmtalk.app.dev
Prod applicationId: com.alarmtalk.app
Dev Web client ID: 677878444839-321tg0ii4og4pa1tk0rpi72erddbvl50.apps.googleusercontent.com
Prod Web client ID: 504825419212-uq7dps7fi1duk4jdikciapli3e2l4e30.apps.googleusercontent.com
Prod Android client ID: 504825419212-nlk9lqshr5bq3caebuavae3m871hf1r3.apps.googleusercontent.com
```

Override the Web client ID with a Gradle property when needed:

```powershell
.\gradlew.bat -PvoiceAlarmDevGoogleWebClientId="YOUR_WEB_CLIENT_ID.apps.googleusercontent.com" :app:installDevDebug
```

### Sentry Error Reporting

Android crash and ANR reporting is disabled by default. Set a flavor-specific DSN only when the target Sentry project is ready:

```powershell
.\gradlew.bat -PvoiceAlarmProdSentryDsn="https://PUBLIC_KEY@o0.ingest.sentry.io/0" :app:bundleProdRelease
```

When the DSN is blank, the app does not initialize the Sentry SDK. Release bundles include native debug symbol metadata where available.

## Build

```powershell
cd apps/android-native
.\gradlew.bat :app:assembleDevDebug
.\gradlew.bat :app:testDevDebugUnitTest
.\gradlew.bat :app:lintDevDebug
.\gradlew.bat :app:installDevDebug
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
adb shell pm grant com.alarmtalk.app.dev android.permission.POST_NOTIFICATIONS
adb shell appops set com.alarmtalk.app.dev SCHEDULE_EXACT_ALARM allow
adb shell cmd notification allow_full_screen_intent com.alarmtalk.app.dev
```

Some devices do not expose every command above. In that case, use the app's permission rows:

- Notifications: Android runtime notification permission.
- Exact alarms: system exact alarm access screen.
- Full screen: Android 14+ full-screen intent access screen.

Current verified device:

- Samsung SM-A325N, Android 13 / API 33.
- Verified with debug receiver on 2026-05-04: alarm-clock schedule fired, `AlarmReceiver` fired, `RingingService` started, bundled local alarm audio started, `RingingActivity` launched as a dedicated full-screen task, and dismiss stopped the alarm.
- Samsung Android 13 does not expose `cmd notification allow_full_screen_intent`; use the in-app permission row or system settings when full-screen access needs manual approval.

### Foreground

1. Open the app.
2. Create a local alarm for the next few minutes, or use the 1 minute test alarm button.
3. Confirm OS registration:

```powershell
adb shell dumpsys alarm | findstr com.alarmtalk.app
```

Expected: `VoiceAlarm` logs show `Scheduled alarm clock`, then `Alarm received`, `Ringing started`. Ringing screen opens, sound loops, vibration repeats until Dismiss.

For locked-device or CI-style debug verification where UI tapping is not available, debug builds include an adb-only test receiver. It is declared under `src/debug`, so it is not packaged in release builds:

```powershell
adb logcat -c
adb shell input keyevent KEYCODE_SLEEP
adb shell am broadcast -a com.alarmtalk.app.action.DEBUG_CREATE_TEST_ALARM -n com.alarmtalk.app.dev/com.alarmtalk.app.debug.DebugAlarmReceiver --ei delay_minutes 1
adb logcat | findstr VoiceAlarm
adb shell am broadcast -a com.alarmtalk.app.action.DEBUG_DISMISS_LAST_ALARM -n com.alarmtalk.app.dev/com.alarmtalk.app.debug.DebugAlarmReceiver
```

Expected logs include `Scheduled alarm clock`, `Debug test alarm created`, `Alarm received`, `Starting ringing audio`, `Ringing started`, and `Alarm dismissed`.

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
adb shell dumpsys alarm | findstr com.alarmtalk.app
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
2. Change label, hour, minute, repeat days, holiday-off, snooze, vibration, and play mode.
3. Save and confirm the alarm appears in the list.
4. Confirm the next fire time is registered with the OS:

```powershell
adb shell dumpsys alarm | findstr com.alarmtalk.app
```

5. Edit the alarm and confirm the OS registration changes.
6. Disable the alarm and confirm its OS alarm is cancelled.
7. Enable it again and confirm a new OS alarm is registered.
8. Delete it and confirm it disappears from the list and `dumpsys alarm`.

Expected: `VoiceAlarm` logs show create, update, enabled changed, deleted, and scheduled/cancelled events. No network calls are required.

Opening the alarm list also performs a startup sync from Room to `AlarmManager`, so future enabled alarms are restored and expired one-shot alarms are marked inactive.

### Alarm Editor Modes

- `Alarm only`: uses only the bundled local alarm sound. Voice audio is not required or saved for this mode.
- `Voice only`: requires a generated voice-profile TTS clip, a server-saved dubbed/TTS clip, or a recorded/selected local audio clip.
- `Alarm + Voice`: rings the bundled alarm first. When the user dismisses the alarm tone, the cached voice clip plays once, then the alarm is dismissed/rescheduled.

If no repeat days are selected, the alarm is a one-shot alarm and is disabled after Dismiss. Repeat alarms can enable `Holiday off`; this skips holidays from the local `holiday_dates` cache by country/region, with a bundled KR seed as fallback, without a ring-time network fetch.

### Local Voice Audio

Local recording/file voice alarms do not require login. Login is only required for voice-profile TTS, shared/server voice features, and backend sync.

1. Tap New alarm or edit an existing alarm.
2. Choose `Voice only` or `Alarm + Voice`.
3. Select `Record/File`.
4. Tap Record and grant microphone permission.
5. Stop before 30 seconds, or let the app stop at the 30 second limit.
6. Save and confirm the alarm rings without network access.

To verify file selection:

1. Tap Pick and choose an `audio/*` file.
2. Files longer than 30 seconds should be trimmed to the first 30 seconds when the Android media stack can mux the selected format. If duration cannot be read or trimming fails, retry with m4a/aac/mp4.
3. Save and confirm `VoiceAlarm` logs show local audio caching.

Airplane-mode check:

```powershell
adb shell cmd connectivity airplane-mode enable
adb logcat -c
adb logcat | findstr VoiceAlarm
```

Expected: `alarm_only` loops bundled audio, `voice_only` loops the cached voice file, and `alarm_voice` loops bundled alarm audio until Dismiss, then plays the cached voice once. No fetch is allowed at ring time.

Restore radios after testing:

```powershell
adb shell cmd connectivity airplane-mode disable
```

### Voice Profile TTS

This path calls paid providers only when the user taps Save for a voice-profile alarm. Do not run it unless you intend to spend provider credits.

1. Sign in.
2. Load voice profiles and choose a ready profile.
3. Select `Voice only` or `Alarm + Voice`.
4. Select `Voice profile`.
5. Enter text, or enable random prompt and choose category/language.
6. Tap Save.

Expected:

- Android calls `POST /api/tts/generate`.
- The backend checks the deterministic generated-audio cache first. On a cache hit, it returns existing audio without calling Perso or ElevenLabs.
- On a cache miss, the backend tries the provider chain. Perso direct voice TTS is currently treated as unsupported until its direct API contract is proven, then ElevenLabs is used.
- The backend stores generated mp3 bytes in Cloudflare R2 under a deterministic key when `VOICE_BUCKET` is bound and returns base64 audio plus `message_id`, `cache_key`, and object metadata.
- Android decodes the response, caches it under app-private storage with a stable local cache key, and stores only local audio for the ring path.
- Editing only the alarm time, copying an alarm, or recreating the same profile/text/category/language on the same device reuses the local cached audio and does not call the provider again.
- At ring time, no ElevenLabs, Perso, R2, push, cron, or network fetch is used.

Cache reuse QA without provider spend:

1. First create one voice-profile TTS alarm only when provider spend is acceptable.
2. Edit only its time and save.
3. Copy the alarm from the alarm list.
4. Create another alarm with the same voice profile, text, category, and language on the same device.

Expected: steps 2-4 reuse the app-private cached file. Android should not call `/api/tts/generate`; the backend should not call Perso or ElevenLabs.

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
- The app automatically syncs queued XP events to `POST /api/characters/xp` after sign-in/network is available.
- The Growth refresh icon is a manual fallback for reloading server state.

Verification flow:

1. Let an alarm ring and tap Dismiss.
2. Open the app and sign in if needed.
3. Confirm Growth reflects the event automatically; use the refresh icon only as a fallback.

Expected:

- Character/streak/XP refreshes from `/api/characters/me`; pending local events sync without requiring manual refresh.
- Subscription loads from `/api/billing/subscription`.
- Issued vouchers load from `/api/billing/vouchers`.
- Coupon or invite code entry uses `/api/code/register`.
- Checkout and paid provider APIs are not called.

### Dismiss / Snooze

1. Let an alarm ring.
2. Tap Snooze.
3. Confirm the next alarm is registered:

```powershell
adb shell dumpsys alarm | findstr com.alarmtalk.app
```

4. Let it ring again and tap Dismiss.

Expected: Snooze logs `Alarm snoozed` and re-registers; Dismiss logs `Alarm dismissed` and stops playback/vibration.

For a repeating alarm, Dismiss keeps the alarm enabled and schedules the next selected repeat day. For a one-shot alarm, Dismiss disables it.

### Boot Restore Broadcast

Create a future alarm, then send the receiver broadcast. On some Android builds, including Samsung Android 13, shell cannot send the protected `BOOT_COMPLETED` action. Use the debug restore action for adb verification in that case; real reboot still uses `BOOT_COMPLETED`.

```powershell
adb shell am broadcast -a android.intent.action.BOOT_COMPLETED -n com.alarmtalk.app.dev/com.alarmtalk.app.alarm.BootCompletedReceiver
adb shell am broadcast -a com.alarmtalk.app.action.DEBUG_RESTORE_ALARMS -n com.alarmtalk.app.dev/com.alarmtalk.app.alarm.BootCompletedReceiver
adb shell dumpsys alarm | findstr com.alarmtalk.app
```

Expected: logs show `Restore receiver invoked` and `Boot restore complete`; pending local alarms are registered again with `AlarmManager`.
