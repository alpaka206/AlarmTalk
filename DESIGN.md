# AlarmTalk Design System

## 1. Atmosphere & Identity

AlarmTalk should feel like a quiet, dependable alarm control room: calm enough for daily setup, clear enough for sleepy moments, and emotionally warmer than a utility timer. The signature is voice-first reliability: restrained blue actions, simple cards, and low-noise settings that keep destructive actions visually separate.

## 2. Color

### Palette

| Role | Token | Light | Dark | Usage |
|---|---|---|---|---|
| Brand/primary | Material `primary` | `#175FB0` | `#A6D2FF` | Primary CTAs, links, selected controls |
| Brand/onPrimary | Material `onPrimary` | `#FFFFFF` | `#08243C` | Text and icons on primary |
| Surface/background | Material `background` | `#F7F7FA` | `#090D16` | Screen background |
| Surface/card | Material `surface` | `#FFFFFF` | `#131825` | Cards, sheets, dialogs |
| Surface/variant | Material `surfaceVariant` | `#EDEEF3` | `#1D2434` | Secondary surfaces, icon backgrounds |
| Text/primary | Material `onSurface` | `#181922` | `#F7F8FC` | Primary labels and body text |
| Text/secondary | Material `onSurfaceVariant` | `#5F6470` | `#A7AFC0` | Captions, settings values, helper text |
| Border/default | Material `outline` | `#CCCED8` | `#3A4257` | Outlined controls |
| Border/subtle | Material `outlineVariant` | `#E0E2EA` | `#272F42` | Card outlines, dividers |
| Status/error | Material `error` | `#C23E32` | `#FF9A8A` | Destructive actions and error states |

Dark surfaces are deliberately deep-navy tinted (not neutral gray) so the landing's night-sea tone carries into the app.

### Rules

- Android `AlarmTalkTheme.kt` is the source of truth for Material color values.
- iOS `AlarmTalkPalette` should mirror Android values. iOS is currently on hold and its dark values still predate the navy-tinted update — re-sync from `AlarmTalkTheme.kt` before any iOS release.
- Always consume colors via `MaterialTheme.colorScheme`; raw `Color(0x…)` literals are forbidden outside the documented exceptions (RingingActivity's fixed lock-screen palette, notification accents, landing/login brand visuals, alarm-home background gradient).
- Use `error` only for destructive actions or real errors, never as decoration.

## 3. Typography

### Scale

| Level | Size | Weight | Line Height | Usage |
|---|---:|---:|---:|---|
| Display | 104 | 700 | 1.0 | Ringing clock |
| Headline | 24 | 700 | 1.3 | Screen titles |
| Title | 16 | 700 | 1.4 | Card titles |
| Body | 16 | 500 | 1.5 | Primary body |
| Body small | 14 | 500 | 1.5 | Settings values, helper text |
| Label | 14 | 700 | 1.2 | Buttons and prominent labels |
| Meta | 11 | 600 | 1.2 | Chips and metadata |

### Font Stack

- Primary: Pretendard, then platform system sans-serif.
- Numeric emphasis: monospace only for clock/time-focused displays.

### Rules

- Text must use platform dynamic type where available.
- Korean labels should remain concise and avoid awkward line breaks in narrow settings rows.

## 4. Spacing & Layout

### Base Unit

Use a 4 dp/pt base unit, with the app-level rhythm built on the existing 8-point grid.

| Token | Value | Usage |
|---|---:|---|
| xs | 4 | Chip internals, label offsets |
| sm | 8 | Icon-to-label gaps, section header gap |
| md | 12 | Dense card internals |
| lg | 16 | Screen horizontal padding, settings row padding |
| xl | 24 | Major content groups |
| 2xl | 32 | Title-to-content separation |

### Rules

- Settings screens use one scrollable column with 16-20 dp/pt page padding and 20 dp/pt between sections.
- Group related rows inside cards; do not nest cards inside cards.

## 5. Components

### Settings Card

- Structure: optional small section title above a single outlined card.
- Spacing: title leading offset 4; row padding 16 horizontal and 14 vertical.
- States: rows are full-width touch targets with chevrons for navigation/action.
- Accessibility: every row must expose a clear text label; destructive labels use the error color.
- Usage: account rows, marketing consent, and danger actions.

### Policy Text Links

- Structure: small text links separated by a subtle dot, outside settings cards.
- Spacing: center near the bottom of Settings with compact vertical padding; when account deletion is visible, place below that card.
- States: links open the public terms and privacy pages in the external browser.
- Usage: service terms and privacy policy only.

### Danger Section

- Structure: a titled settings card with destructive rows only.
- Spacing: same as settings card.
- States: destructive row label uses the error token; confirmation dialog explains the 30-day grace period.
- Usage: account deletion and future irreversible account-level actions.

### Empty Alarm Preview

- Structure: keep the home title above a single first-alarm card. Hide the persistent add FAB while no alarms exist; the whole card is the one creation path. Do not add a reliability strip, preview schedule, decorative illustration, or additional empty-list row.
- Information balance: state that no alarm exists, name the first-alarm action, and give one concise setup prompt. Never show a default time, schedule, device, network, voice-profile metadata, or playback waveform before the user has created an alarm.
- Type and scale: use `Title` for the empty home title, `Headline` for the card action, and `Body` for supporting copy. The card is a focused first-run action, not a promotional hero.
- Surface: use one outlined hero card with the standard 24 dp radius and a single 40 dp primary circular arrow affordance. Do not use gradients, glass, decorative illustrations, nested cards, or a second competing FAB.
- Usage: alarm home only when the user has no saved alarms.

## 6. Motion & Interaction

### Timing

| Type | Duration | Usage |
|---|---:|---|
| Micro | 100-150 ms | Button press, switch toggle |
| Standard | 200-300 ms | Sheet/dialog open and close |
| Emphasis | 400-600 ms | Ringing or alarm-state transitions |

### Rules

- Use platform-native Material/SwiftUI motion unless a product-specific interaction exists.
- Do not add decorative animation to settings screens.

## 7. Depth & Surface

### Strategy

Use a mixed but restrained strategy: card surfaces are outlined with subtle tonal difference; dialogs and sheets may use platform elevation.

| Level | Treatment | Usage |
|---|---|---|
| Screen | Background color only | Main scroll surfaces |
| Card | Surface fill plus subtle outline | Settings groups, alarm cards |
| Dialog/sheet | Surface fill plus platform elevation | Confirmation and edit flows |

### Rules

- Settings hierarchy comes from section labels and card grouping, not heavy shadows.
- Destructive actions are isolated by section placement and error color, not oversized buttons.
