# Design

Information architecture, screens, UI/UX guide, and flow/sequence diagrams for AlarmTalk.

## 1. Information Architecture

### Design principles

1. Alarm first. Opening the app reaches the alarm list within one second.
2. Relationships are managed in one place. Friends, family, shared voices live under the `People` tab.
3. Server-dependent features are visually distinct. Sync state is a top-bar badge.
4. Maximum 3 levels of depth. Beyond that, use modals.

### Site map (Android)

```
AlarmTalk
├─ ⏰ Alarms (Home tab)
│    ├─ Alarm list
│    ├─ New alarm (AlarmEditor / new mode)
│    ├─ Edit alarm (AlarmEditor / edit mode)
│    └─ Ringing screen (RingingActivity, single task)
│
├─ 🎤 Voices (Voices tab)
│    ├─ My voice profiles (max 2)
│    ├─ New voice (record / file)
│    ├─ Voice detail
│    └─ Shared voices (family/partner, read-only)
│
├─ 👥 People (Members tab)
│    ├─ Friends
│    ├─ Pending requests
│    ├─ Family group (owner / member)
│    ├─ Invite code create / accept
│    └─ Ownership transfer / member removal
│
└─ 👤 Account (Account panel)
     ├─ Profile
     ├─ Sign in / out
     ├─ Automatic sync status + manual refresh fallback
     ├─ Subscription / vouchers
     ├─ Code register (VA-XXXX or 6-digit)
     ├─ Permission status / shortcuts
     ├─ Theme / language / dark mode
     ├─ Support / privacy / terms
     └─ Account deletion
```

### Tabs (4)

| Tab | Route | Description |
|---|---|---|
| ⏰ Alarms | `home` | Alarm list, create, edit |
| 🎤 Voices | `voices` | My profiles, shared profiles |
| 👥 People | `members` | Friends, family group, invite code |
| 👤 Account | `account` | Settings, sync, subscription, code register |

### Stack screens

- `auth` — sign-in / sign-up
- `onboarding` — first launch
- `landing` — pre-login brand screen
- `permission_gate` — permission guidance
- `editor` — alarm create / edit
- `ringing` — single task (`RingingActivity`)

### Deep links

| Scheme | Path | Purpose |
|---|---|---|
| `voicealarm://` | `invite/{code}` | Auto-fill family invite code |
| `voicealarm://` | `voucher/{code}` | (Planned) Auto-fill voucher code |
| `https://naro.app` | `invite/{code}` | Web fallback that opens the landing page <!-- TODO(rebrand): replace naro.app with final AlarmTalk domain --> |

### Permission order (Android)

```
First launch
  └─ Notification permission (POST_NOTIFICATIONS)
        └─ Exact alarm permission (SCHEDULE_EXACT_ALARM)
              └─ Full-screen intent permission (USE_FULL_SCREEN_INTENT)
                    └─ (When needed) Battery optimization exemption
                          └─ Ready to create alarms

When recording voice
  └─ Microphone permission (RECORD_AUDIO)
        └─ Recording allowed
```

## 2. Screen Specifications

### AlarmListScreen

```
┌─────────────────────────────────────┐
│ AlarmTalk                     [+]   │
│ Tomorrow morning at 6:30...         │
├─────────────────────────────────────┤
│ ⏰ 06:30   Weekdays      [● ON]     │
│    Mom's voice · alarm+voice        │
│    Next: Monday 06:30               │
├─────────────────────────────────────┤
│ ⏰ 07:00   Every day     [○ OFF]    │
│    Preset · alarm only              │
├─────────────────────────────────────┤
│        [+ New alarm]                │
├─────────────────────────────────────┤
│  ⏰    🎤    👥    👤               │
│ Alarms Voices People Account        │
└─────────────────────────────────────┘
```

- Top header shows the soonest active alarm and a sync state chip (`local only` / `synced` / `sync failed`).
- Each card supports swipe-to-delete (left) and tap-to-edit.
- Toggle switch updates Room and `AlarmManager` synchronously.

### AlarmEditorScreen

```
┌─────────────────────────────────────┐
│ ← New alarm                  [Save] │
├─────────────────────────────────────┤
│             07 : 30                 │  ← WheelPicker
├─────────────────────────────────────┤
│ M T W T [F] [S] S                   │  ← repeat chips
│  ☐ Holiday off                      │
├─────────────────────────────────────┤
│ Label: Morning                      │
├─────────────────────────────────────┤
│ Wake-up mode                        │
│  ( ) Alarm only                     │
│  (●) Voice only                     │
│  ( ) Alarm + Voice                  │
├─────────────────────────────────────┤
│ Audio source                        │
│  (●) Voice profile: Mom's voice     │
│      Message to read:               │
│      ┌──────────────────────────┐   │
│      │ Wake up sweetheart        │   │
│      └──────────────────────────┘   │
│      [Pick a preset]                │
│  ( ) Record / file                  │
├─────────────────────────────────────┤
│ Snooze: 5 min   |   Vibration: Std  │
└─────────────────────────────────────┘
```

- Mode-dependent fields are revealed/hidden conditionally.
- Saving issues the TTS request (when `Voice profile` is selected) before scheduling.

### Other key screens

- **AuthScreen** — email/password + Google ID-token, with platform-aware buttons. Error messages avoid leaking which field was wrong.
- **VoicesTab** — count badge `(N/2)` on my profiles, shared-voices section, mini-play preview.
- **MembersScreen** — tabs for `Friends` and `Family group`, invite code generator with 10-minute countdown, copy/revoke buttons.
- **AccountPanel** — single scrollable column with all settings and sync actions.
- **RingingActivity** — single task, `showWhenLocked = true`, `turnScreenOn = true`, `excludeFromRecents = true`. Touch targets ≥ 88 dp.

## 3. UI/UX Guide

### Color palette

| Role | Hex | Usage |
|---|---|---|
| Cream | `#FFFAF4` | Primary background |
| Ink | `#17130F` | Text, emphasis |
| Cocoa | `#39281F` | Secondary text, card |
| Rose | `#D8665B` | Primary CTA, alarm action |
| Honey | `#F2B56B` | Highlight accent |
| Mint | `#7FA28D` | Settings ON, success state |

Body text contrast ≥ 4.5:1. Large text (≥ 18 pt) ≥ 3:1.

### Typography

- Primary font: **Pretendard** (Korean / English / Japanese).
- Fallback: `system-ui` → `sans-serif`.
- Ringing screen uses a large monospace numeric for time.

| Style | Size / weight / line height | Usage |
|---|---|---|
| displayLarge | 64 / 800 / 1.0 | Ringing time |
| headlineSmall | 24 / 700 / 1.3 | Screen title |
| titleMedium | 16 / 700 / 1.4 | Card title |
| bodyLarge | 16 / 500 / 1.5 | Body |
| bodyMedium | 14 / 500 / 1.5 | Secondary body |
| labelLarge | 14 / 700 / 1.2 | Button |
| labelSmall | 11 / 600 / 1.2 | Chip, meta |

### Spacing (8-point grid)

| Token | Value | Usage |
|---|---|---|
| xs | 4 dp | Inside chips |
| sm | 8 dp | Between icons |
| md | 12 dp | Inside cards |
| lg | 16 dp | Between sections |
| xl | 24 dp | Screen margins |
| 2xl | 32 dp | Title ↔ section |

### Components

- **Buttons** — `Primary` (Rose / White), `Secondary` (translucent white / Cocoa), `Ghost` (transparent / Cocoa), `Destructive` (deep red / White). Height ≥ 52 dp. Touch target ≥ 48 dp.
- **Cards** — surface level 1. Subtle shadow on landing only; on app, use `Elevation 2.dp`.
- **Wave animation** — used in voice-playing buttons. 7 bars, `1.25s ease-in-out infinite`.
- **Spinners** — `CircularProgressIndicator` with Rose color.
- **Empty states** — short copy + single CTA. No illustrations on critical paths.

### Accessibility

- Every clickable element has `contentDescription`. Icon-only buttons have a hidden label.
- WheelPicker value changes are spoken via TalkBack.
- Dynamic type: every text uses `sp` units, font scale up to 200% must not break layout.
- Color is never the sole carrier of meaning (ON/OFF also has label + icon).

### Tone

- Polite, friendly, second-person Korean ("…해 주세요"). English / Japanese mirrors the same friendliness.
- Action labels are verbs ("Save alarm", "Pick a voice"), not nouns.
- Toast messages stay within one line.

## 4. Flow Charts

### F-01. Create a voice-only alarm

```
[Alarm list] ─ tap "+" ─▶ [AlarmEditor]
                            │
                       fill fields
                            ▼
              ┌────────────┴───────────┐
              ▼                        ▼
          alarm_only            voice_only / alarm_voice
              │                        │
              │           ┌────────────┴───────────┐
              │           ▼                        ▼
              │   Voice profile               Record / file
              │           │                        │
              │           ▼                  ┌─────┴─────┐
              │  POST /tts/generate         > 30 s?
              │           │                  yes      no
              │      cache miss?              │       │
              │      yes      no              ▼       ▼
              │       │       │            trim    save
              │   ElevenLabs  R2 hit          │
              │       │       │               │
              │       └───┬───┘               │
              │           ▼                   │
              │     base64 response           │
              │           │                   │
              │           ▼                   │
              │   Local app-private cache ◀───┘
              │           │
              └───────────┴────▶ AlarmRepository.save()
                                       │
                                       ▼
                          AlarmManager.setAlarmClock
                                       │
                                       ▼
                              Alarm list refreshes
```

### F-02. Ring → dismiss / snooze

```
       Scheduled time
              ▼
    AlarmManager fires
              ▼
        AlarmReceiver
              ▼
   RingingService (foreground)
              ▼
   ┌──────────┴──────────┐
   ▼                     ▼
 Vibrator      RingingNotificationFactory
   │                     ▼
   │             full-screen intent
   │                     ▼
   │             RingingActivity
   │                     ▼
   │              MediaPlayer.start (loop)
   │                     ▼
   │            ┌────────┴────────┐
   │            ▼                 ▼
   │       alarm_only        alarm_voice
   │            │                 │
   │            │       Bundled tone → user dismiss → voice once
   │            │                 │
   │            └────────┬────────┘
   │                     ▼
   │              User action?
   │            ┌────────┴────────┐
   │         Snooze            Dismiss
   │            │                 │
   │            ▼                 ▼
   │    Next = now + Δ    Next = next repeat day
   │            │                 │
   │            ▼                 ▼
   │       Re-register      Re-register or
   │                        is_active=false
   └──────────────┬─────────────────┘
                  ▼
       Enqueue character_event
                  ▼
       RingingService.stopSelf()
```

## 5. Sequence Diagrams (ASCII swimlane)

### SEQ-1. Email login

```
[User]  [Android]  [/api/auth/login]  [DB]
 type →
         POST →
                  Zod validate
                                       bcrypt.compare
                                              ◀
                  JWT issued
                          ◀ 200
         SessionStore.save
         Navigate to home
```

### SEQ-3. TTS generation (cache miss)

```
[Android]  [/api/tts/generate]  [DB]  [ElevenLabs]  [R2]
   POST {voice_profile_id, text, language}
        → authMiddleware
        → cache_key = sha256(profile|text|lang|provider)
        → SELECT generated_audio WHERE cache_key=?
                                     ◀ not found
        → voice-provider.synthesize(...)
                                          → POST /text-to-speech/{voice_id}
                                                                       ◀ mp3 bytes
        → R2.put("tts/{cache_key}.mp3", mp3)
                                                                                ◀ ok
        → INSERT generated_audio
                                              ◀ ok
        ◀ 201 { message_id, cache_key, r2_key, audio_base64 }
```

### SEQ-5. Alarm ring (full-screen intent)

```
[OS Scheduler]  [AlarmReceiver]  [RingingService]  [NotificationMgr]  [RingingActivity]
   fire(intent)
        ▶
              startForegroundService
                       ▶ startForeground(id, notification)
                                                ▶ high-importance + full-screen intent
                                                                          ▶ launch
                       MediaPlayer.start()                                  │
                       Vibrator.vibrate()                                   │
                                                                       ◀ Dismiss
                       stopSelf() ◀ RingingService.STOP                     │
                                                                       finish()
```

### SEQ-6. Family invite accept

```
[Member]  [Android]  [/api/family/invites/:code/accept]  [DB]
 enter code
            POST
                 → authMiddleware
                 → SELECT plan_group_invites WHERE code AND status='pending'
                                                          ◀ row
                 → check expiry, group capacity, self-invite
                 → BEGIN TRANSACTION
                 → INSERT plan_group_members
                 → UPDATE plan_group_invites SET status='used'
                 → COMMIT
                 ◀ 200 { group }
   Refresh family list
```

(More sequences live inline with each backend route.)

## 6. Visual Tokens

The same color, type, and spacing tokens are used across Android (`apps/android-native/.../ui/theme`) and the landing page (`apps/landing/index.html`). Keep them in sync when changing any token.
