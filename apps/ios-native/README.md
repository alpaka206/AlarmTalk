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
open AlarmTalkNative.xcodeproj
```

For a command-line compile check without signing:

```bash
cd apps/ios-native
bash scripts/build-debug.sh
```

In Xcode:

1. Select the `AlarmTalk` target.
2. Set a development team.
3. Confirm the bundle ID matches the backend `APPLE_CLIENT_ID` env value.
4. Confirm Signing & Capabilities includes **Sign in with Apple**.
5. Run on a physical iPhone with iOS 26+.

The app reads `VOICE_ALARM_API_BASE_URL` from `AlarmTalk/Info.plist`. The default is production:

```text
https://api.alarm-talk.com/api
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

## StoreKit2 In-App Purchases (Phase 4-D1)

Apple App Store 정책상 디지털 구독은 **반드시 StoreKit2 IAP** 로 결제되어야 한다. 본 iOS 앱은 `SubscriptionManager` 가 결제·복원·entitlement 동기화의 단일 진입점이며, BillingPanel UI 가 그 클라이언트다.

### App Store Connect 제품 등록

App Store Connect → My Apps → AlarmTalk → Features → In-App Purchases 에서 다음 3개 SKU 를 동일한 구독 그룹("AlarmTalk Subscriptions") 아래에 등록한다. (연간 SKU 는 판매하지 않는다.)

| productID | PlanTier | Period | 비고 |
| --- | --- | --- | --- |
| `com.voicealarm.nativeapp.ios.personal_monthly` | personal | Monthly (P1M) | |
| `com.voicealarm.nativeapp.ios.couple_monthly`   | couple   | Monthly (P1M) | |
| `com.voicealarm.nativeapp.ios.family_monthly`   | family   | Monthly (P1M) | Family Sharing **enabled** |

- 모든 SKU 를 단일 구독 그룹에 두면 사용자가 그룹 내에서 자유롭게 업/다운그레이드 할 수 있고, 가족 플랜은 Family Sharing 을 켜서 Apple Family 그룹 멤버에게도 entitlement 가 propagate 된다.
- 가격은 App Store 의 region 별 price tier 로 설정 — 코드는 `Product.displayPrice` 를 그대로 표시하므로 통화/세금이 자동 반영된다.

### 시뮬레이터 로컬 테스트

`apps/ios-native/AlarmTalk/Configuration/StoreKitConfiguration.storekit` 파일이 시뮬레이터용 3개 SKU 정의를 담고 있다. `project.yml` 의 scheme 설정에서 자동 선택되며, 실기기/TestFlight 빌드에서는 무시되고 App Store Connect 가 권위로 사용된다.

xcodegen 후 Xcode 에서:

1. Scheme → Edit Scheme → Run → Options → StoreKit Configuration 이 `StoreKitConfiguration.storekit` 인지 확인.
2. 시뮬레이터에서 앱 실행 → Settings → 이용권 → 6개 카드가 displayPrice 와 함께 노출되는지 확인.
3. 구매 버튼 탭 → 결제 시트가 뜨고 success/userCancelled/pending 분기가 모두 동작하는지 확인.
4. "이전 구매 복원" 버튼 → `AppStore.sync()` 가 호출되고 다른 시뮬레이터 기기/Apple ID 의 구독이 propagate 되는지 확인.

### 백엔드 요구 사항

`SubscriptionManager` 는 결제 성공 후 즉시 `POST /api/billing/apple/confirm` 라우트를 호출해 백엔드 entitlement 동기화를 시도한다. 백엔드는 Apple App Store Server API (`https://api.storekit.itunes.apple.com/inApps/v1/transactions/{transactionId}`) 로 transaction 의 진위와 만료일을 검증한 뒤에만 `subscriptions` 테이블을 갱신해야 한다.

현재 백엔드 라우트는 server-to-server 검증이 구현되기 전까지 fail-closed 로 동작한다. 유효한 SKU 여도 501 `APPLE_TRANSACTION_VERIFICATION_REQUIRED` 를 반환하며 DB entitlement 를 변경하지 않는다. iOS 클라이언트는 StoreKit `currentEntitlements` 를 로컬 권위로 사용하고, 서버 검증 구현 후 foreground 진입 시 `resyncEntitlements()` 로 catch-up 한다.

**라우트가 아직 배포되지 않은 경우**: 클라이언트는 graceful degradation 한다. StoreKit `currentEntitlements` 가 권위이므로 `currentTier` 는 정확하게 계산되며, 백엔드 plan/subscription row 만 갱신되지 않을 뿐이다. 백엔드 라우트가 배포된 후 다음 foreground 진입 시 자동 catch-up 된다 (`AlarmTalkApp.swift` 의 `.active` 분기에서 `resyncEntitlements()` 가 호출됨).

요청 페이로드 (`ConfirmAppleSubscriptionRequest`):

```json
{
  "transaction_id": "...",
  "original_transaction_id": "...",
  "product_id": "com.voicealarm.nativeapp.ios.personal_monthly",
  "jws_representation": "<StoreKit2 VerificationResult.jwsRepresentation — Apple 서명 raw JWS>"
}
```

서버 검증 구현 후 응답 페이로드 (`ConfirmAppleSubscriptionResponse`):

```json
{
  "success": true,
  "plan_key": "personal",
  "subscription": { "id": "sub_...", "plan_id": "...", "status": "active", "starts_at": "...", "expires_at": "2026-06-19T12:34:56Z" }
}
```

`success: true` 수신 시 클라이언트는 기존 구독 fetch 경로(`GET /api/billing/subscription`)로 서버 구독 상태를 즉시 새로고침한다 (`SubscriptionManager.onServerEntitlementUpdated` → `SocialFeatureViewModel.refreshSubscriptionSilently`). 501/503 응답은 비파괴 처리 — 로컬 StoreKit entitlement 를 유지하고 에러를 노출하지 않는다.

### Transaction listener race-safety

`SubscriptionManager.startListeningForTransactions()` 는 `Task.detached` 위에서 `for await result in Transaction.updates` 를 돈다. 진입 케이스는 (1) 가족 공유 propagation, (2) 자동 갱신, (3) 환불(`revocationDate`), (4) Ask-to-Buy 보류 결제 승인 등이다.

- 같은 트랜잭션이 `purchase()` 와 listener 양쪽에서 처리되더라도 `transaction.finish()` 는 idempotent 하므로 안전.
- `Transaction.currentEntitlements` 는 만료된 자동갱신 구독을 자동 제외하므로 만료 후 `currentTier` 가 자동으로 `.free` 로 떨어진다.
- 백엔드 sync 가 실패하면 `lastError` 메시지만 남기고 다음 foreground 진입에서 `resyncEntitlements()` 가 catch-up.

### 비-IAP 흐름

`SocialFeatureViewModel.checkout(planKey:)` 는 `@available(*, deprecated)` 마크되었다. 비-IAP 흐름 중 다음만 살아남는다.

- `/api/billing/vouchers/family-share` — 가족 공유 코드 발급.
- `/api/billing/redeem` — 외부 voucher/INV 코드 redeem.
- `/api/billing/cancel` — 구독 해지 예약.
