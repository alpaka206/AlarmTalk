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
| Play | 구매 요청에 교체 모드를 실어 보낸다(`setSubscriptionUpdateParams`) | **방향으로 고른다** — 업그레이드는 `WITH_TIME_PRORATION`(즉시 전환 + 비례정산), 다운그레이드는 `DEFERRED`(다음 갱신일). 아래 「교체 모드는 **방향으로 고른다**」 |
| App Store | 같은 구독 그룹이라 다른 플랜을 사는 것 자체가 업/다운그레이드 | 애플이 정한다(업그레이드 즉시+비례정산 / 다운그레이드는 갱신일) |

⚠ **Play 교체 구매는 새 `purchaseToken` 을 발급한다.** 그래서 RTDN 이 그 토큰으로 사용자를
못 찾는데, 권위 응답의 **`linkedPurchaseToken`**(대체된 옛 토큰)으로 이어 붙인다.
이 처리가 없으면 전환 알림이 통째로 버려지고 **반영이 클라 confirm 하나에만 매달린다** —
결제 직후 앱이 죽거나 오프라인이면 서버는 그 전환을 영영 모른다(2026-08-11에 고쳤다).

⚠⚠ **`linkedPurchaseToken` 은 "같은 사람" 을 뜻하지 않는다 — 계정 바인딩을 반드시 대조한다.**
이 값은 업/다운그레이드뿐 아니라 **해지했지만 아직 만료 전인 구독의 재가입**에도 실려 온다.
그건 같은 **구글 계정**이면 되고 같은 **AlarmTalk 계정**이라는 보장이 없다. 검증 없이 옛
토큰의 주인을 물려받으면 공용 폰에서 사고가 난다 — 계정 A 해지 → 계정 B 로 재구매 → RTDN 이
클라 confirm 을 앞질러 도착 → **A 가 이용권을 받고** 새 토큰이 A 에게 영구 바인딩된다.
돈 낸 B 의 confirm 은 그 뒤로 영영 `TRANSACTION_OWNED_BY_OTHER_USER`(409)다.
대조는 `lib/purchase-account-binding.ts` **한 곳**에 있고 confirm·RTDN 이 함께 쓴다
(2026-08-11에 고쳤다 — 그전에는 confirm 만 대조했다). RTDN 은 **식별자가 없으면 채택하지
않는다**(fail-closed) — 알려 줄 사람이 없는 경로라 틀리면 되돌릴 길이 없고, 흘려보내면
클라 confirm 이 제 계정으로 올바르게 바인딩한다.

### 전환이 그룹에 하는 일

`applyStoreEntitlement` 는 plan 이 바뀐 트랜잭션을 「기존 구독 취소 → 새 구독 생성」으로
처리한다. 그때 그룹을 어떻게 할지는 **가는 방향**에 달렸다.

| 전환 | 그룹 |
| --- | --- |
| 개인 → 커플/가족 | 새 그룹·새 초대 코드를 만든다 |
| **커플 ↔ 가족** | **그룹을 이어받는다** — 멤버·초대 코드 그대로, 정원과 plan 만 바뀐다 |
| 커플/가족 → 개인 | 해체한다. 그룹을 뒷받침할 결제가 사라지므로 정상이다 |

⚠ **그룹형 → 그룹형에서 해체하지 말 것**(2026-08-11에 고쳤다). 그전에는 이 갈래도 소유자
취소 경로를 그대로 타서 **커플 → 가족 업그레이드가 파트너를 쫓아냈다** — 멤버 강등, 유료
음성 보관 예약, **이미 카톡으로 뿌린 초대 코드까지 만료**, 게다가 **통지도 없었다.**
더 비싼 걸 산 대가가 그것이었다. 이어받기는 `store-billing.ts` 의
`findOwnedGroupToCarryOver`(소유자일 때만) + `cancelActiveSubscriptionsForUser` 의
`preserveGroupId` 로 한다.

- **정원이 줄면**(가족 5 → 커플 2) 넘치는 인원만 내보낸다. 남길 사람은 **먼저 들어온
  순서**(`joined_at`)로 고른다 — 임의로 자르면 왜 저 사람이 빠졌는지 설명할 수 없다.
- **나가게 된 멤버에게는 반드시 알린다**(`demotedUserIds` → `notifyPlanChanged`).
  전환은 소유자가 하지만 대가는 멤버가 치른다 — 아무 말 없이 유료 접근을 잃으면
  사용자는 앱이 고장 난 줄 안다.
- **초대 코드는 새로 발급하지 않고 새 구독으로 옮긴다.** 코드 문자열이 그대로라 뿌려 둔
  초대장이 계속 통한다. 새로 발급하면 소유자가 그 사실을 알 방법이 없다.

**결제 실패(보류)의 「그룹을 해체하지 말 것」과 혼동하지 말 것.** 그쪽은 회복형이라 그룹을
보존한다.

### 교체 모드는 **방향으로 고른다**

| 방향 | 모드 | 사용자에게 일어나는 일 |
| --- | --- | --- |
| 업그레이드 | `WITH_TIME_PRORATION` | 즉시 상위 플랜을 쓰고, 남은 기간을 새 플랜 기준으로 환산 |
| 다운그레이드 | **`DEFERRED`** | **지금 과금하지 않는다.** 현재 플랜을 기간 끝까지 쓰고 **다음 갱신일**에 바뀐다 |

⚠ **하나로 고정하지 말 것.** `WITH_TIME_PRORATION` 은 업그레이드용이다. 다운그레이드에 걸면
더 싼 플랜으로 **즉시** 내려가면서 남은 기간이 환산된다 — 사용자는 "이번 달은 원래 플랜을
쓰다가 다음 달부터" 를 기대한다.

⚠ **등급 순서는 가격으로 판정하지 말 것.** 가격은 스토어가 정하고 지역·프로모션마다 달라
같은 전환이 나라에 따라 업/다운그레이드로 갈린다. 순서는 우리 제품 정의라
`PlayBillingProducts.RANK` 에 박아 둔다(백엔드 `plans.price_krw` 순서와 같다).
**새 플랜을 추가하면 거기도 함께 넣는다** — 빠지면 그 플랜과 오가는 전환이 전부
다운그레이드로 처리된다(모르는 상품은 안전하게 다운그레이드로 본다).

⚠ **`DEFERRED` 는 지금 결제가 일어나지 않는다.** 그래서 구매 리스너로 새 purchase 가 즉시
오지 않고, 화면이 "바로 바뀐다" 고 말하면 안 된다. 반영은 갱신 시점의 RTDN 으로 온다.

## 유료 판정 — 우선순위 다섯 단 (양 앱 공통)

⚠ **판정을 화면마다 손으로 쓰지 말 것.** 2026-08-31 전에는 안드로이드 3개·iOS 3개의 서로 다른
판정이 있었고, 한쪽만 고치는 사고가 리뷰에서 연달아 났다. 이제 앱마다 **판정기 하나**다.

```
1. 스토어가 유효하다고 함            → 유료   (서버 만료로 절대 뒤집지 않는다)
2. 서버가 users.plan = free 라고 함  → 무료   (남아 있는 구독 행보다 위다)
3. 서버가 내 구독을 앎               → 상태·만료로 가른다
4. 남은 users.plan → 그룹 접근      (plan 정보가 없고 그룹도 없으면 **무료**)
5. 스냅샷 자체가 없음                → 모름 (무료가 아니다)
```

⚠ **'모름' 은 4단이 아니라 5단에서만 나온다.** 서버가 "본인 구독 없음" 이라고 **답했고**
그룹 접근도 없으면 근거가 다 모인 무료다 — 이걸 모름으로 접으면 낙관 규칙(`모르면 잠그지
않는다`)에 걸려 **무료 사용자의 유료 목소리가 영영 강등되지 않는다.** 모름은 서버에 한 번도
못 물어본 상태(스냅샷 없음)만 가리킨다.

⚠ **2단이 3단보다 위인 이유: 보류는 구독 행을 지우지 않는다.** 결제 보류(구글 ON_HOLD·
애플 결제 재시도)에서 서버는 그룹과 구독 행을 **그대로 두고** `users.plan` 만 회수한다
(`propagateGroupMemberPlans` 는 멤버의 그룹 연동 구독을 취소하지 않고 재계산에서 제외만
한다 — 결제가 복구되면 재초대 없이 살아나야 하기 때문이다). 그래서 행부터 보면
`status='active'` 에 만료도 미래인 행이 그대로 있어, **결제가 밀린 그룹 멤버가 계속
유료로 읽힌다.** 신규 결제를 잘못 막지도 않는다 — 서버가 행 삽입과 **같은 트랜잭션에서**
`users.plan` 을 올리고(`createNewSubscriptionForPlan`), 산 직후는 어차피 1단이 잡는다.

⚠ **그 값을 적어 두는 것도 같이 해야 한다.** 울림·예약 게이트는 스냅샷만 읽으므로,
`/auth/me` 로 plan 을 받아 온 경로는 **전부** `AccessSnapshot.userPlan` 에 적는다
(`PlanChangeSyncWorker` 포함 — 판정만 하고 안 적으면 게이트가 강등 **전** 등급을 읽는다).
받지 못했으면 **옛 값으로 때우지 않는다**: 적지 않고 '미완' 으로 표시한다.

⚠ **거꾸로, 방금 받아 오지 **않은** 경로는 적지 않는다.** 구독 응답을 저장하는 김에 손에
들고 있던 세션의 plan 을 같이 쓰면, 앱을 닫아 둔 사이 강등됐는데 `plan_changed` 를 놓친
계정에서 **옛 유료 값을 판정에 심는다**(보류면 `/billing/subscription` 이 남은 행을 그대로
돌려주므로 그 경로가 그대로 돈다). 안 적혀 있는 것이 옛 값보다 낫다 — 판정기가 구독·그룹
으로 답하면 되고, 다음 `/auth/me` 가 채운다.

⚠ **스토어가 "없다" 고 답한 것은 '무료 확정' 이 아니다.** Play·StoreKit 은 **그 스토어에서
그 계정으로 산 것**만 돌려준다 — iOS 에서 결제하고 안드로이드로 로그인한 사람, 다른 구글
계정으로 산 사람, 그리고 **본인 구매가 아예 없는 그룹 멤버**는 전부 빈 결과가 나온다.
그래서 빈 결과는 **캐시된 스토어 신호를 지우는 것까지**이고, 판정은 서버 스냅샷으로 내려간다.
(그 신호가 오래 살아남지 않도록 **기한**을 둔다 — 아래 「스토어 신호의 기한」.)

### 스토어 신호의 기한

스토어 신호는 **확인 시각 + 상한**으로 산다. 상한 자체는 두 앱이 다르게 얻는다:

| | 상한 | 근거 |
| --- | --- | --- |
| Android | `STORE_ENTITLEMENT_TTL_MILLIS` = **40일** | Play `Purchase` 에는 **만료가 없다** — 확인 시각 + 보수적 상한으로 대신한다 |
| iOS | StoreKit 이 준 **실제 만료**(`expirationDate`) | 트랜잭션이 만료를 주므로 그대로 쓴다 |

⚠ **상한의 역할은 '만료 감지' 가 아니라 '영구 통행증 방지' 다.** 만료 감지는 서버 스냅샷의
`expires_at` 이 하고, 그쪽은 앱이 열릴 때마다 갱신된다. 그래서 상한은 **월 구독 주기보다
넉넉히 길게** 둔다 — 짧게 잡으면 앱을 안 여는 사이 자동갱신된 사용자가 잘린다(3일로 뒀다가
되돌린 이력이 있다).

⚠ **단, 해지 예약(`isAutoRenewing == false`)이면 서버가 아는 기간 말로 상한을 낮춘다.**
TTL 은 '언제 물어봤는가' 에서 시작하므로, 기간 말 해지를 만료 직전에 확인하면 그 뒤 수십 일이
통행증이 된다. **미래인 기간 말일 때만** 낮춘다 — 지난 값으로 낮추면 방금 확인한 신호가
태어나자마자 죽는다.

⚠ **되돌릴 수 없는 변환은 한 조건 더 본다.** 판정기는 `users.plan = free` 를 남은 구독 행보다
위로 보지만(보류를 잡기 위한 규칙), 보류는 **회복형**이다. 울림·예약은 판정기 그대로 막아도
결제가 복구되면 살아나지만, `PlanChangeSyncWorker` 의 영구 변환은 되돌리지 않으므로
**행이 살아 있는 동안에는 하지 않는다**(`isDefinitelyFree() && !hasPaidVoiceAccess(billing)`).

**1단이 이 문서의 제목을 코드로 옮긴 것이다.** 자동갱신은 스토어에서 먼저 일어나고 서버 반영
(RTDN·복원)이 늦을 수 있는데, 그때 서버의 옛 `expires_at` 으로 막으면 **돈을 내고 있는
사용자가 잠긴다.** 반대 방향(만료된 사용자에게 잠깐 열림)은 다음 동기화가 정리한다 —
두 오류의 무게가 다르다.

**소비 규칙은 둘뿐이다.**
- `isEntitledOptimistic` — **모르면 잠그지 않는다.** 표시·울림·저장/생성 게이트.
- `isDefinitelyFree` — **확실히 무료일 때만.** 되돌리기 어려운 동작(무료 잠금 적용, 알람 영구 강등).

⚠ **'모름' 을 '무료' 로 접지 말 것.** 응답 전 기본값을 답으로 읽는 사고가 이 저장소에서
반복됐다(`docs/spec/gates-and-overlays.md`). 그래서 판정기는 값이 **셋**이다.

⚠ **울림·예약 시점에는 스토어를 직접 못 묻는다**(안드로이드는 알람 시점, iOS 는 AlarmKit 구조).
그래서 전경에서 물어 온 등급을 `AccessSnapshot.storePlanKey` 에 적어 두고 그 경로가 읽는다 —
한쪽만 갱신하면 화면과 울림의 답이 갈라진다.

## 권한 스냅샷은 **문 하나로만** 쓴다 (양 앱 공통)

판정기(`resolvePaidVoiceAccess` / `PaidVoiceGate.resolve`)는 **읽는 쪽**의 단일 출처다.
이 절은 **쓰는 쪽**의 단일 출처를 정한다 — 2026-09-02 에 도입했다.

### 왜 필요했나

그전에는 권한 스냅샷(구독·그룹·`users.plan`·스토어 신호)을 쓰는 곳이 **안드로이드 9곳·iOS 8곳**
이었고, 각자 계정·세션세대·토큰에폭·조회세대·취소 확인을 **손으로** 들고 있었다.
PR #709 에서 그 가드를 82줄 붙였는데 국소 가드끼리 어긋나면서 리뷰가 **37회·119건**까지 갔다.
실제로 일어난 것들:

- 에폭 가드를 넣었더니 **그 앞의 토큰 회전** 때문에 항상 거짓이 되어 plan 반영이 죽었다.
- 세션 CAS 를 넣었는데 스냅샷 발행이 **락 밖**이라 창이 그대로 남았다.
- 조회 세대를 넣었더니 **실패한 조회가 남의 성공까지** 무효로 만들었다.
- 공유 순서표를 넣었더니 배경 경로가 **전경의 화면 상태까지** 버렸다.

전역 불변식이 어디에도 없는 시스템에 국소 불변식을 하나씩 붙이면 이렇게 된다.

### 규칙

1. **네트워크·스토어 SDK 호출 전에 표를 뜬다.** `AccessTicket = 계정 + 에폭`.
   - 에폭: 안드로이드 = 세션 세대, iOS = **토큰**(세대 카운터가 없어 같은 계정 재로그인을
     거를 축이 토큰뿐이다).
2. **응답이 오면 그 표로 쓴다.** `write(ticket, 이유) { ... }`.
3. **결과가 `Applied` 일 때만 화면 상태를 갱신한다.** 스냅샷만 막고 전역 state 를 발행하면
   A 의 데이터가 B 화면에 뜬다.
4. **우리가 토큰을 굴렸으면 표도 옮긴다.** 안 옮기면 그 뒤 쓰기가 전부 거절된다.

⚠ **문 밖에서 스냅샷을 쓰지 말 것.** `patchWithoutOwnershipCheck` 에는 소유권 판단이 없다.
강제 장치가 셋이다: ① 옛 `update*` API 제거 ② 표를 **인자로 요구**해 컴파일러가 잡는다
③ `scripts/check-entitlement-writer.py`(CI 필수 체크)가 우회를 막는다.

## 보류는 **보이게** 알린다 — 그리고 진입점이 둘이다

결제 보류(Play `ON_HOLD`/`PAUSED`, 애플 결제 재시도)는 **사용자가 직접 고쳐야** 풀리는
상태다. 그래서 조용한 `plan_changed` 만으로는 안 된다 — 그건 "스냅샷을 다시 읽어라" 는
신호일 뿐이라, 사용자는 어느 날 갑자기 유료 기능이 잠긴 이유를 모른 채 이탈한다.
`sendPaymentFailedPush` 가 표시용 한 통과 워커 기동용 data-only 한 통을 **함께** 보낸다.

⚠ **두 통은 iOS 에도 해당한다.** 예전에는 안드로이드만 두 통이었고 iOS 는 alert 한 통에
`plan_changed` 를 실었는데, alert 에는 `content-available` 이 없어 **앱이 백그라운드면
깨어나지 않는다** — 사용자가 앱을 열기 전까지 서버 플랜을 다시 읽지 못하고, iOS 는 예약
시점에 소리가 고정되므로 **이미 예약된 유료 목소리 알람이 계속 그 목소리로 울린다.**
지금은 표시용(`billing_hold`) + 조용한 신호(`plan_changed`, `silent`) 두 통이다.
클라는 원래 이 짝을 전제로 쓰여 있었다(`PushNotificationCoordinator.billingHold` 는
"표시 전용" 이라 적고 아무 일도 하지 않는다) — 서버가 짝을 안 보내고 있었다.

⚠ **같은 상태를 발견하는 자리가 둘이다 — 둘 다 보내야 한다.**
1. **RTDN** — Play 가 알려 주는 주 경로(`routes/billing-google-rtdn.ts`).
2. **만료 크론** — RTDN 을 놓쳤을 때, 그리고 **애플에는 RTDN 이 아예 없어서**
   (`processSubscriptionExpiry` 의 `reconcileStoreBeforeExpiry` → `'suspend'`).
   애플 보류는 **이 경로로만** 발견된다.

크론 쪽은 보류자를 `paymentHolds` 에 모아 루프가 끝난 뒤 보낸다(푸시는 DB 쓰기 뒤에).
**`notifyUserPks` 에 또 넣지 않는다** — `sendPaymentFailedPush` 가 이미 data-only 를
함께 보내므로 같은 신호가 두 번 간다.

⚠ **크론은 같은 보류를 5분마다 다시 발견한다 — 알림은 바뀐 회차에만.** 보류는 회복형이라
구독 행을 `active` 로 **남기므로**, 이미 지난 `expires_at` 을 든 그 행이 만료 크론에 매번
다시 걸린다. 무조건 보내면 결제가 복구될 때까지 "결제가 확인되지 않았어요" 가 **5분마다**
온다. 판정은 강등 전후의 `users.plan` 비교이고, 멤버 쪽이 이미 쓰던 규칙과 같다
(`propagateGroupMemberPlans` 의 `planBefore !== planAfter`).
소유자가 안 바뀌고 멤버만 새로 잠긴 회차(소유자에게 다른 유료 구독이 남은 경우)를 위해
`ownerUserPk` 는 **null 을 받는다** — 그러면 소유자에게는 보내지 않는다.

⚠ **크론에는 보류 갈래가 두 개다**(예약해지 만기 루프 / 일반 만료 루프). 한쪽만 고치면
예약해지 상태에서 보류가 겹친 사용자는 권한만 조용히 잠긴다 — 실제로 그렇게 빠뜨렸다.

## 갱신을 쥔 스토어가 있으면 **다른 스토어에서 새로 사지 못한다**

⚠ Play 로 결제 중인 이용권이 있는데 애플 결제를 시작하면, 확정은 **우리 DB 의 옛 구독
행만** 취소할 뿐 Play 의 자동갱신은 끊지 못한다 — 서버가 Play 구독을 끊을 수 있는 것은
`POST /billing/cancel` 을 탈 때뿐이고, 스토어 구매 확정 경로는 그걸 부르지 않는다.
결과는 **두 스토어가 동시에 청구**하고, 서버는 새 애플 구독만 보여 주므로 Play 쪽을
관리할 입구가 앱에서 사라지는 것이다.

- 판정은 **로컬 스토어 상태가 아니라 `store_provider`** 다(위 절과 같은 이유).
- ⚠ **판정 신호는 `store_renewal_providers` 다 — `store_provider` 가 아니다**(코덱스 #733 3차).
  둘은 다른 질문이다:
  - `store_provider` 는 "해지가 어느 스토어를 거치나" 라 애플이 있으면 **애플로 접힌다.**
    그걸 재사용하면 애플·구글이 **함께 살아 있는 계정**이 "애플뿐" 으로 읽혀 Play 가
    갱신 중인데 애플 결제를 또 열어 준다.
  - `subscription` 자체가 **null 일 수 있다.** Play 보류(`ON_HOLD`/`PAUSED`)는 구독 행을
    살려 두고 `users.plan` 만 회수하는데, 그 행은 `expires_at` 이 지나 응답에서 빠지고
    등급도 free 다 — **등급이나 `subscription` 으로 거르면 보류 중인 Play 구독이 안 보인다.**
    결제가 복구되는 순간 두 곳에서 청구된다.
  그래서 신호는 **응답 최상위**에 두고, 만료로 거르지 않으며, 스토어를 **접지 않고 전부** 싣는다.
- ⚠ **결제 직전에 서버 값을 한 번 받아 온다 — 캐시로 판단하지 않는다**(코덱스 #733 5차).
  서버의 confirm 가드는 **이미 청구된 뒤**라 되돌릴 수 없다. 그래서 StoreKit 을 부르기
  직전에 `GET /billing/subscription` 을 다시 받고, **못 받아 오면 진행하지 않는다**
  (캐시로 넘어가면 이 단계를 둔 이유가 사라진다). 남는 창은 조회와 결제 사이의 수백 ms 뿐이고,
  그건 아래 서버 가드가 받는다.
- ⚠ **서버가 거절했으면 성공이라고 말하지 않는다.** 구독 갈래는 확정 여부와 무관하게
  성공을 돌려주는데, 그건 "다음 동기화가 따라잡는다" 가 참일 때 얘기다. 교차 스토어 거절은
  따라잡히지 않는다 — 사용자가 Play 를 해지해야 풀린다.
- ⚠ **권위 판정은 쓰기 트랜잭션 안이다**(코덱스 #733 6차). 라우트에서만 보면 두 스토어의
  확정이 **동시에** 들어올 때 둘 다 "경쟁자 없음" 으로 읽고 지나간다 — 쓰기만 직렬화되어
  먼저 쓴 로컬 행이 취소되고 **바깥의 두 구독은 그대로 갱신된다.** `applyStoreEntitlement`
  안에서 보므로 **두 스토어가 대칭**이고, 라우트의 검사는 애플 호출을 아끼는 빠른 거절이다.
- ⚠ **거절했으면 스토어 확인 처리(ack)도 하지 않는다**(코덱스 #733 7차). Play 는 확인되지
  않은 구매를 **3일 뒤 자동 환불**한다 — 권한을 못 준 결제를 ack 하면 사용자는 돈만 내고
  **되돌릴 길까지 잃는다.** RTDN 은 거절을 만나면 ack 전에 빠져나온다(Pub/Sub 자체는 200 —
  재시도해도 결과가 같다).
- ⚠ **막는 것은 새 구매뿐이다.** 이미 우리가 아는 트랜잭션의 재전송·갱신은 막으면 안 된다 —
  이미 팔린 구독의 갱신을 거절하면 **돈은 나가는데 권한이 끊긴다.** 같은 스토어 안의 등급
  변경도 막지 않는다(스토어가 처리하는 정상 경로다).
- ⚠ **해지 예약된 구독은 갱신 주인이 아니다.** `cancel_at_period_end = 1` 은 "아직 유료지만
  **다음 갱신은 없다**" 는 뜻이다. 그걸 세면 **안내대로 Play 에서 해지한 사용자가 남은 기간
  내내 애플로 못 산다** — 우리가 하라고 한 일을 했는데 막힌다. (해지 판정 `store_provider`
  는 반대다: 예약해지든 아니든 서버는 애플 구독을 못 끊으므로 활성 구독 전부를 본다.)
- ⚠ **앱의 판정만으로는 부족하다 — 서버가 확정 시점에 한 번 더 본다**(코덱스 #733 4차).
  앱이 보는 것은 **캐시된 스냅샷**이라, 같은 계정이 **다른 기기에서 방금** Play 구독을
  시작한 경우를 못 본다(구매자 본인은 `plan_changed` 대상도 아니라 갱신 신호도 안 온다).
  `POST /billing/apple/confirm` 이 활성 Play 갱신을 보면 409 `CROSS_STORE_RENEWAL_ACTIVE`
  로 거절한다. 거절해도 잃는 것은 없다 — 스토어 트랜잭션은 그대로 남아, Play 를 해지한 뒤
  앱이 다시 올리면(`resyncEntitlements`) 그때 통과한다.
- ⚠ **환불 갈래가 이 가드보다 먼저다.** 환불은 회수 통보이지 구매가 아니다 — 여기서
  막으면 회수가 영영 안 된다.
- ⚠ **모르는 것은 '아니오' 로 친다**(코덱스 #733). 새 기기·새 로그인이거나
  `GET /billing/subscription` 이 아직 돌고 있거나 실패한 동안에는 서버 구독이 **없는
  것처럼 보이는데**, StoreKit 제품은 이미 로드돼 살 수 있다. 그 틈이 정확히 이 게이트가
  막으려던 이중 청구다. **이미 유료인데 갱신 주인을 모르면 막고**, 그때 곧바로 다시 읽는다.
  무료 사용자는 막지 않는다 — 갱신을 쥔 스토어가 애초에 없다.
- ⚠ **StoreKit 을 부르기 직전에 다시 본다.** 카드 탭에서 한 번만 보면, 확인 알럿이 떠
  있는 사이 `plan_changed` 갱신으로 스냅샷이 Play 구독으로 바뀌어도(다른 기기에서 Play
  결제) 그대로 결제가 나간다. 판정 함수는 하나이므로 두 자리에서 같은 것을 부른다.
- 막고 나서 **무엇을 해야 하는지 말한다** — "Play 스토어 → 구독에서 먼저 해지하거나,
  기간이 끝난 뒤에 다시" 다. 그냥 막으면 고장으로 읽힌다. 버튼은 죽이지 않고 누르면
  이유를 말한다(편집기의 `SaveBlockReason` 과 같은 규약).
- 반대 방향(안드로이드에서 애플 구독이 살아 있을 때)은 같은 규칙이지만 아직 구현이 없다 —
  iOS 가 스토어에 없어 그 조합이 존재하지 않는다. **iOS 출시 뒤에는 함께 막아야 한다.**

## 환불은 **크론을 기다리지 않고** 권한을 회수한다

⚠ 애플에는 우리가 받는 서버 알림 라우트가 없다(App Store Server Notifications 미구현).
기간 중 환불은 클라가 `Transaction.updates` 로 물어다 준 `POST /billing/apple/confirm`
요청이 **유일한 통보**다. 거기서 `TRANSACTION_REVOKED` 로 거절만 하면, 만료 크론이
재조회할 때까지 — 즉 저장된 `expires_at` 까지 — 환불받은 계정과 그 가족 멤버가 계속
유료로 남는다.

- 정리는 Play RTDN 의 `deactivate` 갈래와 **같은 벌**이다: 매핑된 구독 한 건만 취소하고,
  목소리는 지우지 않고 보관 유예를 걸고, 강등되는 당사자와 해체된 멤버에게 알린다.
- ⚠ **회수 대상은 그 트랜잭션에 묶인 구독이지 요청을 보낸 계정이 아니다.** 환불은 애플이
  확인해 준 사실이라, 누가 알려 주든 그 구독은 끊기는 것이 맞다.
- ⚠ **조회 키가 둘이다** — 구독은 `originalTransactionId`(갱신마다 바뀌지 않는다), 선물은
  `transactionId`. 한쪽만 보면 못 찾는다.
- ⚠ **체인이 아직 살아 있으면 손대지 않는다**(코덱스 #733 2차). `originalTransactionId` 는
  **체인 전체가 공유**한다 — 자동갱신은 갱신마다 트랜잭션이 새로 나지만 그 id 는 같다.
  그래서 옛 갱신 한 건이 뒤늦게 환불되면 조회가 그 id 로 **지금 살아 있는 구독 행**을
  집는다. 그대로 취소하면 이어받은 그룹까지 해체되고 **되돌릴 수 없다.** 판단은 애플에
  체인의 현재 상태를 물어서 하고(`fetchAppleSubscriptionStatus`), **끝난 상태일 때만** 회수한다.
  재시도(3)·유예(4)는 회복형이라 여기서 끊지 않는다 — 만료 크론의 보류 갈래가 다룬다.
- ⚠ **끝난 상태는 만료(2) '와' 회수(5) 둘이다.** 지금 구독 자체가 환불되면 애플은 만료가
  아니라 **`REVOKED`(5)** 를 준다 — `!== EXPIRED` 로 적었다가 주 경로인 "지금 구독 환불" 이
  통째로 새어 나갔다(코덱스 #733 3차). 그래서 **끝난 상태를 목록으로 적고**, 목록에 없는
  값(애플이 나중에 늘릴 수 있다)은 살아 있다고 본다.
  (`reconcileAppleBeforeExpiry` 는 반대로 '권한 있는 상태' 를 목록으로 적는다 — 묻는 것이
  달라서 목록도 다르다: 저기는 "지금 유료인가", 여기는 "끝났는가" 다.)
- ⚠ **못 물어보면 살아 있다고 본다(fail-closed).** 두 오류의 무게가 다르다 — 회수를
  건너뛰면 환불받은 사용자가 `expires_at` 까지 유료로 남고 크론이 결국 정리하지만,
  잘못 취소하면 돈을 내고 있는 그룹이 해체된다.
- ⚠ **로그아웃 중에 온 환불은 적어 뒀다가 로그인 때 민다**(코덱스 #733 4차). 가드를
  건너뛰어도 `syncWithBackend` 는 세션이 없으면 그냥 실패하는데, 환불된 트랜잭션은
  `currentEntitlements` 에도 `unfinished` 에도 없어 **다시 올릴 경로가 하나도 없다.**
  `PendingRevokedTransactionStore` 에 담고 `flushPendingRevocations` 가 시작·계정 변경·
  **전경 재동기화**(`resyncEntitlements`)에서 민다. ⚠ 전경 경로를 빼면 세션이 있는데
  일시 실패(502·503·429)한 건은 **앱을 껐다 켜기 전까지** 재시도되지 않는다 — 그 순회는
  `currentEntitlements` 인데 환불된 트랜잭션은 거기 없다. ⚠ **로그아웃에서 비우지 말 것** — 주인이 로그아웃한 뒤에 온 환불이 정확히 이 큐가
  있어야 하는 경우다.
  ⚠ **큐에서 지우는 것은 서버가 그 트랜잭션을 판정했을 때뿐이다**(코덱스 #733 5차).
  401(토큰 거절)·403(동의 필요)·**429(요청 제한)** 는 **결제 라우트가 보지도 못했다**는
  뜻이라 — 미들웨어가 앞에서 막은 것이다 — 지우면 그 환불은 영영 서버에 닿지 않는다.
  ⚠ **범위(`400..<500`)로 적지 말 것.** 라우트가 실제로 내는 상태만 목록으로 둔다
  (`adjudicatedStatuses` = 400·404·409). 범위로 두면 새로 생긴 미들웨어 상태가 조용히
  삼켜진다 — 실제로 429 가 그렇게 새어 나갔다.
- ⚠ **환불 통보는 계정 가드를 건너뛴다.** A 가 산 구독이 환불됐는데 그때 기기에 B 가
  로그인해 있으면 `maySyncToBackend` 가 이걸 버리는데, 환불된 트랜잭션은
  `currentEntitlements` 에 안 나오고 구매 때 이미 finish 돼 있어 **다시 올릴 경로가 하나도
  없다.** 서버의 환불 갈래는 **호출자가 아니라 트랜잭션에서** 대상 구독을 찾으므로 B 의
  토큰으로 올려도 A 의 것을 정확히 회수한다.
- ⚠ **그 판정으로 삭제 예고까지 막지 말 것**(코덱스 #733 7차). '아직 유료' 는 **소유자**
  얘기다. 그룹이 해체되면서 떨어져 나간 멤버들은 유예가 걸려 있는데, 소유자에게 다른 유료
  구독이 남았다는 이유로 예고를 통째로 건너뛰면 **그 멤버들이 아무 경고 없이 목소리를 잃는다.**
  `notifyVoiceDeletionScheduled` 는 **유예 행이 있는 사람만** 고르므로 전원을 넘기면 된다.
- ⚠ **아직 유료면 보관 유예를 걸지 않는다**(코덱스 #733 6차). 환불된 구독이 이 계정의
  **여러 활성 구독 중 하나**일 수 있다 — 취소 처리는 살아남은 유료 플랜을 일부러 보존하는데,
  유예 행을 무조건 깔면 돈을 내고 있는 사용자에게 **"목소리가 3일 뒤 삭제돼요"** 가 나간다.
  스윕이 나중에 취소해 주긴 하지만 그때는 이미 놀란 뒤다.
- ⚠ **커밋 뒤 통지는 최선 노력이다.** 거기서 던지면 라우트가 500 이 되고, 앱은
  `TRANSACTION_REVOKED` 를 못 받아 권위 상태를 다시 읽는 경로를 놓친다 — 회수가 끝났는데
  유료 상태가 남는다.
- ⚠ **조회를 쓰기 트랜잭션 안에서 한다**(코덱스 #733). 밖에서 읽으면 그 사이 재구매·플랜
  변경으로 그 행이 이미 취소되고 **그룹만 새 구독으로 넘어가 있을 수 있다.** 낡은 행으로
  정리를 돌리면 구독 UPDATE 는 가드에 걸려 무해하지만 `disbandOwnedPlanGroup` 은 그대로
  돌아 **지금 돈을 내고 있는 구독이 뒷받침하는 그룹에서 멤버를 전원 내보낸다.**
- ⚠ **응답은 400 이지만 정리는 끝났다 — 앱이 그걸 알아야 한다.** `success` 가 아니라서
  클라가 그냥 실패로 넘기면 그 세션은 캐시된 유료 구독을 그대로 들고 있고,
  `plan_changed` 푸시를 놓치면 유료 목소리가 계속 나간다. iOS 는 이 코드를 받으면
  권위 상태를 다시 읽는다(`SubscriptionManager.syncWithBackend`).
  ⚠ 그 갱신은 **구독 응답과 `users.plan` 둘 다**여야 한다 — 구독만 새로 받으면
  `auth.session.user.plan` 이 옛 유료 값 그대로라 `PaidVoiceGate.resolve` 가 그 값으로
  유료 목소리를 계속 내준다(`onServerEntitlementUpdated` 가 `/auth/me` 도 읽는다).

## 그룹형 전환은 **멤버의 구독 행까지** 옮긴다

커플 ↔ 가족 전환에서 `plan_groups` 만 고치면 멤버의 `subscriptions.plan_id` 가 **옛 플랜에
그대로** 남는다. `GET /billing/subscription` 은 멤버의 등급을 그 행에서 뽑으므로, 그룹의
정원·코드는 옮겨 갔는데 멤버 화면과 권한 스냅샷만 옛 플랜으로 남는다.

- **정원 정리(`enforceGroupCapacity`) 뒤에** 옮긴다 — 쫓겨날 멤버까지 옮겼다 바로 취소하는
  낭비를 피하고, 남은 사람만 겨냥한다.
- 소유자는 제외한다(새 구독 행을 따로 만들고, 옛 행은 방금 취소됐다).
- ⚠ **남은 멤버도 통지 대상이다**(코덱스 #733). 등급이 바뀐 것은 나간 사람만이 아니다 —
  안 알리면 다음 앱 시작·주기 pull 까지 **옛 플랜 키**를 들고 있다. 그래서 반환 필드
  이름이 `demotedUserIds` 가 아니라 `planChangedUserIds` 다: 나가는 사람만 담는 줄 알고
  남은 사람을 빠뜨렸으니, 이름을 "알려야 할 사람" 으로 바꿔 같은 실수를 막는다.

## 해지가 어느 스토어를 거치는지는 **서버가 정한다**

⚠ **앱이 로컬 스토어 상태로 흉내 내지 말 것.** iOS 는 `purchasedProductIDs` 에 구독이
하나라도 있으면 애플로 보고 애플 관리 시트를 열었는데, 아이폰에서 산 옛 구독의
entitlement 가 기기에 남은 채 지금은 Play 구독을 쓰는 사용자가 있다 — 그 경우
`/billing/cancel` 을 **아예 부르지 않아** 사용자는 해지했다고 믿는데 Play 구독이 계속
갱신된다.

- 값의 출처는 `storeCancelProviderOf` 하나이고, `POST /billing/cancel` 의 409 판정과
  `GET /billing/subscription` 의 `store_provider` 가 **같은 함수**에서 나온다.
- 판정 범위는 **그 사용자의 활성 구독 전부**다. 해지는 하나라도 애플이면 거절하므로,
  최신 1건만 보면 예고가 어긋난다.
- `null` 은 스토어 결제가 아니라는 뜻(프로모·바우처)이거나 **구버전 서버**다. 어느 쪽이든
  앱은 서버에 물어보고 `STORE_CANCEL_UNSUPPORTED` 를 받으면 관리 시트로 보낸다 —
  안드로이드가 원래 그 하나만 쓴다.

## 구현 지도

| 규칙 | 백엔드 | 안드로이드 | iOS |
| --- | --- | --- | --- |
| 해지 — Play 성공 후에만 DB 변경 | `routes/billing-mutation.ts` `POST /cancel` | `MainViewModelBillingActions.cancelSubscription` | — |
| 해지 — 애플은 거절 | 같은 파일, `STORE_CANCEL_UNSUPPORTED` | `STORE_MANAGE_REQUIRED_CODES` | `SocialFeatureViewModel.cancelSubscription` → `BillingPanel.openAppStoreSubscriptionManagement` |
| 해지 — **어느 스토어를 거치나** | `storeCancelProviderOf`(`lib/billing-cancel.ts`) → `GET /billing/subscription` 의 `store_provider` | 에러 코드로 판단(`STORE_MANAGE_REQUIRED_CODES`) | `BillingSubscription.storeProvider`(로컬 StoreKit 금지) |
| 다른 스토어가 갱신 중일 때 구매 차단 | `store_provider` 를 내려보낸다 | (미구현 — iOS 출시 뒤) | `BillingPanel` 의 `showPlayOwnsRenewalNotice` |
| 환불 — 즉시 권한 회수 | `revokeRefundedAppleSubscription` (`routes/billing-apple.ts`) | — | — |
| 그룹형 전환 — 멤버 플랜 이전 | `applyStoreEntitlement` 의 carryOver 갈래 (`lib/store-billing.ts`) | — | — |
| 전환 — 알려야 할 사람 | `planChangedUserIds`(나간 사람 + 남은 사람) | — | — |
| 구매 차단 판정 — 앱 | `store_renewal_providers`(최상위·만료 무시·접지 않음) | — | `BillingPanel.purchaseBlockReason`(순수 함수) |
| 결제 직전 권위 조회 | `GET /billing/subscription` | — | `BillingPanel.confirmAndPurchase` |
| 구매 차단 판정 — **서버(권위)** | `CROSS_STORE_RENEWAL_ACTIVE` (`routes/billing-apple.ts`) | 문구 표에만 있다 | `APIErrorMessages` |
| 로그아웃 중 환불 큐 | — | — | `PendingRevokedTransactionStore` · `flushPendingRevocations` |
| 만료 재조회 디스패처 | `lib/billing-cancel.ts` `reconcileStoreBeforeExpiry` | — | — |
| 만료 재조회 — Google | 같은 파일 `reconcileGoogleBeforeExpiry` | — | — |
| 만료 재조회 — Apple | 같은 파일 `reconcileAppleBeforeExpiry` | — | — |
| 보류 — 그룹 전파 | `lib/billing-cancel.ts` `propagateGroupMemberPlans` | — | — |
| 보류 — Google 진입점 | `routes/billing-google-rtdn.ts` 회복형 갈래 | — | — |
| 보류 — Apple 진입점 | `reconcileAppleBeforeExpiry` → `'suspend'` | — | — |
| 결제 실패 알림 | `lib/fcm.ts` `sendPaymentFailedPush` | `fcm/AlarmTalkMessagingService.kt` | `PushNotificationCoordinator` |
| 결제 실패 알림 — 진입점 **둘** | RTDN(`routes/billing-google-rtdn.ts`) · 크론(`processSubscriptionExpiry` 의 `paymentHolds`) | — | — |
| 결제 실패 알림 — 중복 방지 | `readUserPlan` 전후 비교(`lib/billing-cancel.ts`) | — | — |
| 미완료 결제 재전송 — 진입점 **둘** | — | — | `SubscriptionManager.replayUnfinishedTransactions`(`bootstrap` · 계정 변경 `.task`) |
| 애플 구독 상태 조회 | `lib/apple-storekit.ts` `fetchAppleSubscriptionStatus` | — | — |
| 갱신 신호 | `routes/billing-google-rtdn.ts` (RTDN) | `MainViewModelBillingActions.refreshStoreEntitlement` (시작·전경 진입) | `SubscriptionManager.resyncEntitlements` (전경 진입) |
| **유료 판정 — 유일 출처** | `isPaidVoicePlan`(users.plan) · `hasActivePaidEntitlement`(삭제 직전) | `resolvePaidVoiceAccess` (`ui/util/PlatformAndLabelUtils.kt`) | `PaidVoiceGate.resolve` |
| 판정 소비 — 잠금(파괴적) | — | `AlarmTalkApp` 잠금 이펙트(`isDefinitelyFreePlan`) · `sync/PlanChangeSyncWorker` | `AlarmTalkApp.applyFreePlanVoiceLockIfNeeded` |
| 판정 소비 — 울림·프리페치 | — | `alarm/RingingService` · `sync/StockClipPrefetchWorker` | `PaidVoiceGate.shouldDowngrade`(예약 시점) |
| 판정 소비 — 표시·게이트 | — | `MainViewModel.isPaidVoiceEntitledOptimistic` | `PlanTier.bestKnown`(보류면 남은 행으로 등급을 올리지 않는다) |
| 판정 스냅샷 — `users.plan` 쓰기 | `/auth/me` 응답의 `user.plan` | `MainViewModelAuthActions`(`/auth/me` 성공 경로) · `sync/PlanChangeSyncWorker` — **방금 받아 온 곳만** | `SocialFeatureViewModel.refreshAll`(받으면 적고, 못 받으면 미완 표시) |
| 판정 스냅샷 — **쓰기 문(유일)** | — | `EntitlementWriter`(`ui/main/EntitlementWriter.kt`) | `EntitlementWriter.swift` |
| 문의 원자성 근거 | — | `AuthSessionStore.runIfGeneration`(세션 쓰기와 같은 락) | `KeychainStore.runIfCurrentSession`(세션 쓰기와 같은 락) |
| 우회 차단 | — | `scripts/check-entitlement-writer.py`(CI) | 같은 스크립트가 둘 다 검사 |
| 회귀 테스트 | `test/billing-cancel-play.test.ts` · `test/billing-cancel-apple.test.ts` · `test/apple-storekit.test.ts` | `PaidVoiceAccessTest` | `PaidVoiceGateTests` |
| 플랜 변경 — 스토어가 처리 | — | `billing/PlayBillingManager.kt` (`setSubscriptionUpdateParams`) | `SubscriptionManager.purchase`(같은 구독 그룹) |
| 전환 결과 수신 | `routes/billing-google-rtdn.ts`(`linkedPurchaseToken`) → `lib/store-billing.ts` | — | `resyncEntitlements` |
| 구매-계정 바인딩 대조 | `lib/purchase-account-binding.ts` (confirm·RTDN 공용) | `billing/PlayBillingManager.kt` `setObfuscatedAccountId` | — |
| 전환 — 그룹 이어받기 | `lib/store-billing.ts` `findOwnedGroupToCarryOver` · `lib/billing-cancel.ts` `preserveGroupId` | — | — |
| 전환 — 정원 축소 강등 통지 | `lib/store-billing.ts` `enforceGroupCapacity` → `demotedUserIds` → `notifyPlanChanged` | `fcm/AlarmTalkMessagingService.kt` | `PushNotificationCoordinator` |
| 변경 반영 푸시 | `lib/billing-cancel.ts` `notifyPlanChanged` → `lib/fcm.ts` | `fcm/AlarmTalkMessagingService.kt` | `PushNotificationCoordinator` |

## 의도된 플랫폼 차이

| 차이 | 이유 |
| --- | --- |
| iOS 해지는 시스템 시트로 나간다 | App Store Server API 에 해지가 없다 |
| 애플에는 서버 알림(ASSN) 라우트가 없다 | 아직 미구현 — 그래서 만료 재조회가 **유일한** 서버측 갱신 감지 경로다. ASSN 을 붙이면 재조회는 그때도 안전망으로 남긴다 |
