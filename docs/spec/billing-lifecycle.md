# 구독 수명주기 — 스토어가 권위다

## 원칙

**결제 스토어가 진실이고 우리 DB 는 사본이다.** 사본이 원본과 어긋나면 두 방향으로
사고가 나는데, 둘 다 사용자가 손해를 본다:

| 어긋남 | 결과 |
| --- | --- |
| 우리는 만료로 보는데 스토어는 유효 | **돈은 내는데 기능을 잃는다** — 목소리 알람이 잠긴다 |
| 우리는 해지했는데 스토어는 계속 청구 | **권한도 잃고 돈도 나간다** |

그래서 **스토어를 못 확인하면 아무것도 바꾸지 않는다**(fail-closed).

## 해지

| 스토어 | 서버가 해지할 수 있나 | 어떻게 |
| --- | --- | --- |
| Google Play | **가능** | `purchases.subscriptions.cancel` / `:revoke` 호출이 **성공한 뒤에만** DB 변경 |
| App Store | **불가능** | API 자체가 없다 → 409 `STORE_CANCEL_UNSUPPORTED` + `manage_url` 로 거절, **DB 무변경** |

- ⚠ **애플 해지를 서버가 대신 해 주는 척하지 말 것.** 로컬만 취소하면 사용자는
  권한을 잃은 채 Apple 에 계속 과금된다. 앱은 그 거절 코드를 받아
  `AppStore.showManageSubscriptions` 시트를 연다 — **그게 앱 안의 유일한 해지 경로**다
  (없으면 심사 거절 사유이기도 하다).
- ⚠ **한 구독에 애플·구글이 섞여 있으면 통째로 거절한다.** 부분 해지는 상태를 갈라 놓는다.
- Play 호출이 실패하면 502 + `manage_url`, **DB 무변경**. 이미 성공한 토큰이 있어도
  재시도가 안전하다(이미 취소된 토큰 재시도는 성공으로 수렴).

## 결제 실패 — 보류는 **그룹 전체**에 걸리고, 구조는 남는다

결제가 실패하면 스토어가 재시도한다(Play `ON_HOLD`, Apple 상태 3). 이때:

| 대상 | 처리 |
| --- | --- |
| 소유자 | `users.plan = free` |
| **같은 그룹 멤버 전원** | **`users.plan = free`** — 가족·커플 모두 |
| 그룹·멤버십·구독 행 | **보존** |
| 알림 | 소유자 "결제 수단을 확인하면 바로 다시 쓸 수 있어요" / 멤버 "이용권 주인의 결제가 확인되지 않아 공유 기능이 잠시 잠겼어요" |

- ⚠ **멤버를 빼먹지 말 것.** 예전에는 소유자만 내려가서, 소유자는 돈을 안 내는데 가족·커플
  전원이 최대 30일간 유료 기능을 계속 썼다. 게다가 멤버 화면에는 공유 목소리가 멀쩡히
  보이는데 그걸로 새 알람을 만들면 404 로 막혀 **보이는데 안 되는** 상태였다.
- ⚠ **그룹을 해체하지 말 것.** 카드가 며칠 막힌 것으로 가족 다섯 명을 재초대 대상으로
  만들면 안 된다. 업계 표준(Spotify·Apple 가족공유)도 그룹은 유지하고 서비스만 멈춘다.
- ⚠ **멤버가 자기 개인 구독을 따로 가진 경우를 지킨다.** 값을 직접 대입하지 말고
  `resolvePlanAfterSuspend` 로 **남은 활성 구독에서 다시 계산**한다.
- ⚠ **바뀐 사람에게만 알린다.** 자기 결제가 따로 있어 등급이 안 바뀐 멤버에게
  "결제가 실패했어요" 를 보내면 자기 카드에 문제가 생긴 줄 안다.
- ⚠ **복구도 같이 구현한다.** 보류만 넣고 복구를 빠뜨리면 멤버가 **영영 무료로 남아**
  원래 버그보다 나빠진다. 결제가 되살아나면(`entitle`) 멤버 plan 을 다시 계산한다.

### 유예(grace)와 재시도(retry)는 다르다

| 스토어 | 유예 — 접근 허용 | 재시도 — 보류(free) |
| --- | --- | --- |
| Google Play | 그레이스 기간(구독 상태가 아직 ACTIVE 계열) | `SUBSCRIPTION_STATE_ON_HOLD` / `PAUSED` |
| App Store | 상태 **4** `IN_GRACE_PERIOD` | 상태 **3** `IN_BILLING_RETRY` |

유예는 스토어가 **명시적으로 접근을 허용**하는 기간이라 유료를 유지한다. 재시도는 유예가
끝났거나 애초에 없는 상태다.

⚠ 애플 재시도를 `expire` 로 보내면 **그룹이 해체된다** — 종료가 아니라 `suspend` 로 보내
권한만 회수한다(`reconcileAppleBeforeExpiry`).

## 만료 — 크론 전에 스토어에 되묻는다

만료 크론은 5분마다 돈다(`processSubscriptionExpiry`). `expires_at` 이 지났다고 바로
강등하지 않고 **스토어에 현재 상태를 다시 묻는다**(`reconcileStoreBeforeExpiry`).

왜: 갱신 알림을 놓칠 수 있기 때문이다.
- Google: RTDN 유실
- Apple: **App Store Server Notifications 라우트가 아예 없다.** 연장 신호는 iOS 앱이
  전경으로 올라올 때 보내는 `resyncEntitlements` 뿐인데, 알람 앱은 안 열어도 울리므로
  한 달 넘게 안 여는 사용자가 흔하다 — 그 사이 크론이 무료로 강등시킨다.

| 판정 | 뜻 |
| --- | --- |
| `expire` | 스토어도 만료 → **종료 처리**(그룹 해체 포함) |
| `suspend` | 결제 재시도 중 → **권한만 회수**(그룹 보존, 위 「결제 실패」 절) |
| `skip` | 스토어가 아직 유효 → **연장**했거나, 일시 장애 → 다음 회차 재시도 |

- ⚠ **"활성" 만 보면 안 된다.** 아직 권한이 있는 상태가 더 있다:
  - Google: `SUBSCRIPTION_STATE_CANCELED`(기간종료 해지 예약)도 만료 전까지 유효
  - Apple: `IN_GRACE_PERIOD`(4) — 애플이 명시적으로 접근을 허용하는 기간이다
  - ⚠ Apple `IN_BILLING_RETRY`(3)는 **권한이 없다**(보류). 다만 종료도 아니라서
    `expire` 가 아니라 `suspend` 로 보낸다 — `expire` 로 보내면 그룹이 해체된다
- ⚠ **일시 장애로 강등하지 말 것.** 스토어 API 가 5분 삐끗한 값으로 유료 사용자가 무료가
  된다. 단 **만료가 72시간 넘게 지났으면 강행**한다 — 안 그러면 좀비 구독이 영원히 남는다.
- ⚠ **자동갱신이 꺼져 있으면 연장하되 `cancel_at_period_end = 1`** 로 세운다. 그래야
  만기가 오면 조용히 만료된다.
- ⚠ **새 스토어를 붙이면 `reconcileStoreBeforeExpiry` 에 갈래를 추가해야 한다.**
  빠뜨리면 그 스토어 구독은 스토어에 묻지도 않고 강등된다 — 애플이 정확히 그 상태였다.

## 애플 구독 상태를 읽는 법

⚠ **`fetchAppleTransaction` 으로는 갱신을 못 본다.** 자동갱신 구독은 **갱신마다
`transactionId` 가 바뀌는데** 우리가 저장한 건 `originalTransactionId`(수명 동안 고정)라,
그걸로 개별 트랜잭션을 조회하면 **첫 결제의 만료일**만 돌아온다.

`fetchAppleSubscriptionStatus`(`GET /subscriptions/{id}`)를 쓴다 — 구독의 어떤 트랜잭션
ID 로도 조회되고 최신 갱신 정보를 준다. 구글의 `getPlaySubscriptionV2` 와 같은 역할이다.
- 응답의 `data[].lastTransactions[]` 에서 **물어본 `originalTransactionId` 와 일치하는
  항목만** 쓴다. 같은 구독 그룹의 다른 구독(개인 → 가족으로 갈아탄 흔적)을 집으면
  엉뚱한 만료일로 연장한다.
- **번들 ID 를 반드시 대조한다.** 다른 앱의 구독이 우리 것으로 들어오면 안 된다.
- 프로덕션에 없으면 샌드박스를 한 번 더 본다 — TestFlight·심사 빌드가 샌드박스라,
  프로덕션만 보면 심사에서 떨어진다.
- ⚠ **넘어가는 조건은 404 만이 아니다 — 401·403 도 넘어간다.** 앱이 아직 프로덕션에
  올라가지 않았으면 프로덕션 호스트는 404 가 아니라 **401** 을 준다(2026-08-10 실측:
  production 401 / sandbox 400 `Invalid transaction id` — 샌드박스는 인증을 통과했다는
  뜻이다). 401 에서 바로 던지면 **샌드박스에 도달조차 못 해** 위 규칙이 무력해진다.
- ⚠ **그렇다고 401 을 `AppleTransactionNotFoundError` 로 흘리면 안 된다.** 그 예외는
  재조회가 **즉시 `expire`** 로 읽는다(아래 표). 키가 깨졌거나 만료된 순간 **돈을 내고
  있는 애플 구독자가 전원 무료로 강등된다.** 어느 환경도 안 열렸으면 일반 오류로
  던져서 `skip`(다음 크론 재시도)이 되게 한다 — fail-closed 다.

## 플랜 변경 — **스토어 시트가 시점을 정한다**

⚠ **'지금 변경 / 종료일에 변경' 을 우리가 묻는 UI 를 만들지 말 것.** 두 스토어 모두 전환을
자기가 처리하고 **시점도 자기가 정한다** — 우리가 고르게 하면 지킬 수 없는 약속이 된다.

| | 전환 방식 | 시점 |
| --- | --- | --- |
| Play | 구매 요청에 교체 모드를 실어 보낸다(`setSubscriptionUpdateParams`) | 지금은 `WITH_TIME_PRORATION` **고정** — 즉시 전환 + 비례정산 |
| App Store | 같은 구독 그룹이라 다른 플랜을 사는 것 자체가 업/다운그레이드 | 애플이 정한다(업그레이드 즉시+비례정산 / 다운그레이드는 갱신일) |

⚠ **Play 교체 구매는 새 `purchaseToken` 을 발급한다.** 그래서 RTDN 이 그 토큰으로 사용자를
못 찾는데, 권위 응답의 **`linkedPurchaseToken`**(대체된 옛 토큰)으로 이어 붙인다.
이 처리가 없으면 전환 알림이 통째로 버려지고 **반영이 클라 confirm 하나에만 매달린다** —
결제 직후 앱이 죽거나 오프라인이면 서버는 그 전환을 영영 모른다(2026-08-11에 고쳤다).

⚠ **전환은 그룹을 해체한다.** `applyStoreEntitlement` 가 plan 이 바뀐 트랜잭션을
「기존 구독 취소 → 새 구독 생성」으로 처리하므로, **가족 → 개인 다운그레이드는 가족 그룹을
해체하고 멤버 전원을 강등**시킨다. 이건 정상이다 — 사용자가 직접 고른 다운그레이드다.
**결제 실패(보류)의 「그룹을 해체하지 말 것」과 혼동하지 말 것.** 그쪽은 회복형이라 그룹을
보존한다.

⚠ **다운그레이드는 아직 준비가 덜 됐다**(2026-08-11 조사). 교체 모드가 `WITH_TIME_PRORATION`
하드코딩이라 항상 즉시 전환이고, 어느 플랜이 상위인지 판정하는 근거가 앱·서버 어디에도 없다
(`plans.price_krw` 가 사실상 유일한 순서 근거다). 다운그레이드를 갱신일에 적용하려면
`ReplacementMode.DEFERRED` 를 골라야 하고, 그때는 결제가 즉시 일어나지 않아 confirm 타이밍이
달라진다 — **그 설계를 하기 전에는 전환 UI 를 열지 않는다.**

## 구현 지도

| 규칙 | 백엔드 | 안드로이드 | iOS |
| --- | --- | --- | --- |
| 해지 — Play 성공 후에만 DB 변경 | `routes/billing-mutation.ts` `POST /cancel` | `MainViewModelBillingActions.cancelSubscription` | — |
| 해지 — 애플은 거절 | 같은 파일, `STORE_CANCEL_UNSUPPORTED` | `STORE_MANAGE_REQUIRED_CODES` | `SocialFeatureViewModel.cancelSubscription` → `BillingPanel.openAppStoreSubscriptionManagement` |
| 만료 재조회 디스패처 | `lib/billing-cancel.ts` `reconcileStoreBeforeExpiry` | — | — |
| 만료 재조회 — Google | 같은 파일 `reconcileGoogleBeforeExpiry` | — | — |
| 만료 재조회 — Apple | 같은 파일 `reconcileAppleBeforeExpiry` | — | — |
| 보류 — 그룹 전파 | `lib/billing-cancel.ts` `propagateGroupMemberPlans` | — | — |
| 보류 — Google 진입점 | `routes/billing-google-rtdn.ts` 회복형 갈래 | — | — |
| 보류 — Apple 진입점 | `reconcileAppleBeforeExpiry` → `'suspend'` | — | — |
| 결제 실패 알림 | `lib/fcm.ts` `sendPaymentFailedPush` | `fcm/AlarmTalkMessagingService.kt` | `PushNotificationCoordinator` |
| 애플 구독 상태 조회 | `lib/apple-storekit.ts` `fetchAppleSubscriptionStatus` | — | — |
| 갱신 신호 | `routes/billing-google-rtdn.ts` (RTDN) | — | `SubscriptionManager.resyncEntitlements` (전경 진입) |
| 회귀 테스트 | `test/billing-cancel-play.test.ts` · `test/billing-cancel-apple.test.ts` · `test/apple-storekit.test.ts` | — | — |
| 플랜 변경 — 스토어가 처리 | — | `billing/PlayBillingManager.kt` (`setSubscriptionUpdateParams`) | `SubscriptionManager.purchase`(같은 구독 그룹) |
| 전환 결과 수신 | `routes/billing-google-rtdn.ts`(`linkedPurchaseToken`) → `lib/store-billing.ts` | — | `resyncEntitlements` |
| 변경 반영 푸시 | `lib/billing-cancel.ts` `notifyPlanChanged` → `lib/fcm.ts` | `fcm/AlarmTalkMessagingService.kt` | `PushNotificationCoordinator` |

## 의도된 플랫폼 차이

| 차이 | 이유 |
| --- | --- |
| iOS 해지는 시스템 시트로 나간다 | App Store Server API 에 해지가 없다 |
| 애플에는 서버 알림(ASSN) 라우트가 없다 | 아직 미구현 — 그래서 만료 재조회가 **유일한** 서버측 갱신 감지 경로다. ASSN 을 붙이면 재조회는 그때도 안전망으로 남긴다 |
