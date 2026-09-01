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
| 갱신 신호 | `routes/billing-google-rtdn.ts` (RTDN) | `MainViewModelBillingActions.refreshStoreEntitlement` (시작·전경 진입) | `SubscriptionManager.resyncEntitlements` (전경 진입) |
| **유료 판정 — 유일 출처** | `isPaidVoicePlan`(users.plan) · `hasActivePaidEntitlement`(삭제 직전) | `resolvePaidVoiceAccess` (`ui/util/PlatformAndLabelUtils.kt`) | `PaidVoiceGate.resolve` |
| 판정 소비 — 잠금(파괴적) | — | `AlarmTalkApp` 잠금 이펙트(`isDefinitelyFreePlan`) · `sync/PlanChangeSyncWorker` | `AlarmTalkApp.applyFreePlanVoiceLockIfNeeded` |
| 판정 소비 — 울림·프리페치 | — | `alarm/RingingService` · `sync/StockClipPrefetchWorker` | `PaidVoiceGate.shouldDowngrade`(예약 시점) |
| 판정 소비 — 표시·게이트 | — | `MainViewModel.isPaidVoiceEntitledOptimistic` | `PlanTier.bestKnown`(보류면 남은 행으로 등급을 올리지 않는다) |
| 판정 스냅샷 — `users.plan` 쓰기 | `/auth/me` 응답의 `user.plan` | `MainViewModelAuthActions`(`/auth/me` 성공 경로) · `sync/PlanChangeSyncWorker` — **방금 받아 온 곳만** | `SocialFeatureViewModel.refreshAll`(받으면 적고, 못 받으면 미완 표시) |
| 판정 스냅샷 — 갱신 직렬화 | — | `AccessSnapshotStore.mutate`(companion `LOCK`) | `AccessSnapshotStore.mutate`(static `NSLock`) |
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
