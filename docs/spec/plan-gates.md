# 로그인·이용권 게이트

> **단일 출처.** 구현이 이것과 다르면 구현이 틀린 것이다. → [README](README.md)

## 1. 상태는 **셋**이다 — 둘로 가르지 말 것

2026-08-07 사용자 문의: **"로그인도 했고 쿠폰도 등록했는데 '로그인이 필요하다' 모달이
뜬다."** 원인은 상태가 셋인데 분기가 둘이었던 것이다. 양쪽 앱 모두 같은 결함이 있었다.

| 상태 | 무엇이 문제인가 | 제목 | 확인 버튼이 가는 곳 |
| --- | --- | --- | --- |
| **비로그인** | 세션이 없다 | "로그인이 필요해요" | 이용권 화면(구매할 때 로그인) |
| **로그인 + 무료** | 이용권이 없다 | "유료 이용권이 필요해요" | 결제(이용권 화면) |
| **로그인 + 유료** | 플랜 문제가 **아니다** | "기본 목소리로는 직접 입력을 쓸 수 없어요" | **목소리 등록** |

나머지 액션은 세 상태 모두 '닫기' 하나이고, 버튼 순서는 두 앱 모두 [닫기][확인] 이다(§2). ⚠ **게이트에는 코드 입력이
없다 — 어느 상태에도**(2026-10-14, 아래 「선물 코드 — 폐지」). 예전에는 '로그인 + 무료' 에만 '선물·초대 코드가 있어요' 가
붙었다.

2026-10-16 오너 결정: 편집기의 비로그인·무료 상태는 두 앱 모두 [닫기][이용권 보기], 유료 상태는
[닫기][등록하기]다. 이용권 화면은 비로그인도 볼 수 있고 구매를 시작할 때 로그인한다.

2026-10-19: 잠긴 '직접 입력' 이 연 **'로그인 + 무료'** 게이트에는 광고를 쓸 수 있을 때 **'광고 보고 한 번 쓰기'** 가 더해져
버튼이 셋(세로)이 된다 — Android 만, 규칙은 [`ad-rewards.md`](ad-rewards.md) §4. 광고는 결제도 코드도 아니라 아래 「선물 코드 —
폐지」 규칙과 부딪치지 않는다. 광고를 쓸 수 없으면 예전 두 버튼 그대로다.

목소리 탭의 '내 목소리 만들기' 게이트는 두 앱 모두 상태로 가르지 않는 [닫기][이용권 보기] 한 모양이다(안드로이드
`VoiceProfileManagementPanel` 의 `PlanGateDialog`, iOS 같은 이름 파일의 `planGateOpen` 알럿).

### 왜 2분기가 틀렸나

```
freeVoiceTier = 로그인함 && !유료
```

이 값의 **부정**에는 비로그인뿐 아니라 **로그인한 유료 사용자**가 함께 들어간다.
그래서 `else` 를 '비로그인' 으로 읽으면 유료 사용자가 로그인을 요구받는다.

판정은 **세 갈래 열거형**으로 한다 — 불리언 하나로 세 상태를 표현할 수 없다.

⚠ **기간 한정 개인 플랜 동안에는 원시 무료 계정도 '로그인 + 유료'(개인)다**
([`billing-lifecycle.md`](billing-lifecycle.md) 「기간 한정 개인 플랜」). 서버가 `plan` 을
계산값(`plus`)으로 주므로 앱은 **그대로 소비**한다. 기기 시계를 보는 예외는 하나뿐이다 —
**끝 전에 받아 둔 낡은 캐시**가 끝을 넘기면 무료로 읽는다(같은 절의 D1: 끝 뒤에 받은 답은
그대로 권위이고, 살아 있는 구독 행이 언제나 이긴다. '받은 시각' 은 서버가 계산한 시각
`computed_at` 이 우선이고(D7), 받은 시각이 아예 없는 캐시는 끝 전의 답으로 본다). '로그인 + 무료'
갈래는 지우지 않는다: 기간이 끝나면 같은 계정이 곧바로 그 갈래로 돌아온다.

### 유료가 닿던 길은 **막혔다** — 갈래는 방어값으로 남긴다

⚠ **2026-09-02 정정.** 그전에는 여기에 「유료가 게이트에 닿는 길은 실재한다 — 기본
목소리를 고르면 유료여도 문구가 '날씨+약' 으로 제한되고, 그 화면의 잠긴 '직접 입력' 을
누르면 게이트가 열린다」고 적혀 있었다. **그 화면이 사라졌다.** 문구 목록을 하나로
합치면서(`voice-and-message.md` §2) 잠긴 '직접 입력' 은 **무료에게만** 뜬다
(`manualLocked = freeVoiceTier`).

지금 편집기에서 게이트를 여는 입력은 둘뿐이고 등급이 정해져 있다:

| 입력 | 조건 | 갈래 |
| --- | --- | --- |
| 목소리를 켜거나 잠긴 목소리를 누름 | `authSession == null` | `LOGIN_REQUIRED` |
| 잠긴 '직접 입력' | `freeVoiceTier` | `PLAN_REQUIRED` |

그래서 `SYSTEM_VOICE_LIMIT` 은 **지금 도달 불가능**하다.

**그래도 지우지 않는다.** `when` 의 `else` 는 무엇이든 되어야 하는데, '로그인했고 유료인데
게이트가 열렸다' 는 상태에 **이용권을 팔면 안 된다** — 그게 애초에 세 갈래로 가른 이유다
(2026-08-07 사용자 문의). 그 상태는 버그이고, 버그일 때 가장 덜 해로운 안내가
'내 목소리를 고르세요' 다. 도달 불가라는 이유로 지우고 `PLAN_REQUIRED` 로 합치면
**이용권을 가진 사람에게 이용권을 파는** 옛 사고가 그대로 돌아온다.

## 2. 버튼은 상태마다 다르다

'이용권 보기'는 비로그인·무료 상태에서 이용권을 살펴보는 길이다. 실제 구매에는 로그인이 필요하다.
유료 상태는 이용권 구매가 해결책이 아니므로 '등록하기'로 목소리 화면을 연다.

⚠ **게이트에 코드 입력 액션을 다시 붙이지 말 것**(2026-10-14 — 아래 「선물 코드 — 폐지」). 예전에는
'로그인 + 무료' 게이트에 '선물·초대 코드가 있어요' 와 그 입력 창이 있었다. 막힌 기능 바로 옆의 코드 칸은
'코드를 넣으면 유료 기능이 열린다' 로 읽히고, 그것이 App Store 심사 지침 3.1.1 반려의 사유다. 게이트의
결제 쪽 액션은 '이용권 보기' 하나이고, 앱 어디에도 코드 칸이 없다(2026-10-20 — 아래 「커플·가족 이용권 — 폐지」).

⚠ **버튼 순서는 두 앱 모두 [닫기][이용권 보기] 다**(2026-10-14) — 닫기가 앞(왼쪽), 강조한 확인이 끝(오른쪽). iOS 는
'닫기' 에 취소 역할(`.cancel`)을 주고, 가로 한 줄 알럿에서 시스템이 그것을 앞에 둔다. 안드로이드는 `PlanGateDialog` 의
`actions` 순서로 같은 자리를 만든다(앱의 다른 두 액션 알럿도 닫기·취소가 앞이다). 예전 [이용권 보기][닫기](2026-08-15
지시)는 코드 액션까지 셋을 세로로 쌓던 때의 순서다 — 세로에서는 iOS 가 취소를 맨 아래로 내린다. 확인 버튼이 다른
게이트(유료 갈래의 '등록하기')도 같은 자리다.

⚠ 게이트를 새로 만들 때 액션 목록을 그대로 복사하지 말 것. 상태를 먼저 정하고,
그 상태에 **실제로 도움이 되는 액션만** 붙인다.

## 3. 유료 판정이 무엇을 보는가

⚠ **판정 규칙의 유일 출처는 [`billing-lifecycle.md`](billing-lifecycle.md) 의
「유료 판정 — 우선순위 다섯 단」이다**(2026-09-01 통합). 이 문서는 그 결과를 **게이트가
어떻게 쓰는가**만 말한다. 아래는 예전에 여기 적혀 있던 규칙이 왜 바뀌었는지의 요약이다:

- 예전: "구독 응답만 본다 / **응답이 없으면 무료로 본다**".
- 지금: 스토어 → `users.plan = free` → 구독 응답(만료) → 남은 plan → **모름**.
  - **응답이 없는 것은 '무료' 가 아니라 '모름' 이다.** 무료로 접으면 로딩 중에 유료
    사용자가 무료 안내를 보고, 되돌릴 수 없는 잠금까지 걸릴 수 있다.
  - 대신 `users.plan` 이 이미 free 라고 말하면 그걸 따른다 — 그건 서버가 준 답이다.
  - 만료 시각은 계속 본다(로컬에 남은 stale `active` 가 통과하지 않도록).
- 소비는 두 규칙뿐이다: **모르면 잠그지 않는다**(표시·울림·저장) /
  **확실히 무료일 때만**(되돌릴 수 없는 잠금·강등).

**코드 등록은 없다**(2026-10-20 — 마지막으로 남았던 초대 코드를 커플·가족 이용권과 함께 지웠다. 그 전
2026-10-14 에 선물 코드, 2026-10-12 에 프로모 코드). 유료 판정의 근거는 스토어 구독과 기간 한정 개인 플랜
(서버가 읽을 때 계산한다)뿐이다. 옛 앱의 코드 칸이 보내는 `POST /code/register` 는 어떤 본문이든 404
`CODE_NOT_FOUND` 다(아래 「커플·가족 이용권 — 폐지」).

## 4. 이용권·목소리 정보는 **언제 다시 받는가** (2026-09-29)

게이트는 받아 둔 값으로 판정한다 — 값이 낡으면 게이트가 틀린다. 그렇다고 화면이 뜰 때마다
다시 받으면 같은 응답을 몇 번씩 기다린다. 다시 받는 때는 넷이다.

- **진입 갱신** — 탭·화면에 들어갈 때. 같은 계정의 **완결된** 갱신이 같은 앱 진입 안에서
  **60초** 안에 있었으면 다시 받지 않는다. 목소리·더보기 탭과 화면(편집기·이용권)이
  모두 같은 창을 본다.
  - ⚠ **목소리 탭의 진입 갱신은 빼지 말 것**(2026-08-24 실기기). 예전에는 목소리 탭이 앱
    시작의 캐시 스냅샷에만 기대, 다른 기기에서 플랜이 바뀌면 유료 사용자가 '추가' 를
    눌렀는데 이용권 안내 모달이 떴다. 창은 그 낡음을 60초 이하로 묶을 뿐 없애지 않는다.
  - ⚠ **키에 토큰을 넣지 말 것.** `/auth/me` 는 부를 때마다 토큰을 굴린다 — 토큰을 키로
    쓰면 이용권 갱신 한 번에 **표가 통째로 무효**가 된다. 키는 **계정 + 로그인 한 번**이다
    (같은 계정으로 로그아웃→재로그인하면 창이 비워져야 한다 — 계정 id 만으로는 못 가르는
    쪽은 세션 세대를 함께 넣는다).
  - **실패했거나 반쪽인 갱신은 창을 열지 않는다** — 다음 진입이 곧바로 다시 받는다. 그래서
    '건너뛰기 표' 를 갱신 **전에** 적지 않는다. 먼저 적으면 실패한 뒤 60초 동안 재시도가 막힌다.
    도는 동안의 중복을 막으려고 먼저 적는 표(알람 탭 동기화)는, 회차가 **완결되지 않으면
    자기가 적은 칸을 지운다**(오프라인·저장소 로드 전·탭을 떠나 취소 — 올리지 못한 알람을
    다시 올리는 자리다).
  - 창에 적는 진입·시각은 **요청을 보낼 때의 것**이다. 응답이 백그라운드를 건너 다음 진입에
    도착했을 때의 값을 적으면, 떠나 있는 동안 받은 옛 답이 돌아온 진입의 창을 연다.
  - 앱에 다시 들어오면(백그라운드를 거쳐) 창은 닫힌다.
- **쓰기 뒤 갱신** — 해지·구매·복원·목소리 삭제. 창을 무시한다.
- **푸시** — `plan_changed`·목소리 변경. 창을 무시한다.
- **앱 전경 복귀** — `/auth/me`(plan·프로모·토큰). 창과 무관하게 진입마다 한 번이다
  (개인 플랜 종료 안내 D11 — [`gates-and-overlays.md`](gates-and-overlays.md)).

⚠ **`/auth/me` 를 한 흐름에서 두 번 부르지 말 것.** 이용권 새로고침(`refreshAll`)이 이미
`/auth/me` 로 plan·프로모·토큰을 받아 세션에 넣는다 — 그 옆에서 사용자 새로고침을 또 부르면
같은 답을 한 번 더 기다린다. 예외는 이용권 새로고침이 **끝까지 못 갔을 때**다(구독 조회가
실패해 권한 스냅샷을 채우지 못했거나, 그 사이 토큰이 굴러 plan 을 버렸다) — 그때는 사용자
새로고침을 한 번 더 부른다. "확정이 성공했으면 사용자도 이미 읽었다" 에 기대지 말 것 —
확정할 트랜잭션이 없는 회차(만료 뒤 구독 관리·'복원할 구매 없음')가 있다. 반대로 **프로필을
고친 뒤에는** 사용자 새로고침이 맞고(프로필은 그쪽만 싣는다), 이용권 새로고침은 필요 없다.

**이용권 새로고침의 조회는 한꺼번에 보낸다**(2026-09-29 효율 감사 M7). 구독과 `/auth/me` 는 서로의
결과를 입력으로 쓰지 않는다 — 차례로 기다리면 목소리 탭·이용권·`plan_changed` 가 왕복을 한 번 더
기다린다. (2026-10-20 전에는 가족 그룹·공유 코드 조회까지 넷이었다.)
- **보내는 것만 한꺼번이다.** 받은 것을 쓰는 순서(구독 → plan·토큰)와 가드(계정·갱신 세대·결제 전
  조회 수위·권한 스냅샷의 문)는 그대로다. 앞 단계의 가드에서 물러나면 떠 있던 나머지는 취소되고 답은
  쓰지 않는다.
- 결제 전 조회 수위와 계정 요청 표(순번·진입)는 **보내기 전에** 뜬다 — 구독 읽기와 `/auth/me` 가 맨
  처음에 출발하므로, 그 뒤에 성공한 결제 전 조회·뒤에 보낸 계정 요청의 답을 이 회차가 되돌리지 못한다.
- 구독 조회가 실패하면 `/auth/me` 의 답은 **세션의 plan·프로모와 이 진입의 결과로만** 쓴다 —
  이미 나간 계정 요청의 결과를 버리면 이 진입의 첫 결과가 비어, 뒤에 오는 응답이 세션 한가운데서 종료
  안내를 판정한다(D11, 코덱스 #827). 권한 스냅샷에는 쓰지 않고(구독 없는 반쪽 스냅샷 금지) 토큰도
  굴리지 않는다 — 무상태 JWT 라 지금 토큰이 그대로 유효하다([`session-and-auth.md`](session-and-auth.md)).

## 구현 지도

| 규칙 | Android | iOS | 백엔드 |
| --- | --- | --- | --- |
| 세 상태 열거 | `VoiceGateReason` (`ui/editor/AlarmEditorScreen.kt`) | `PlanAccess` (`Views/Editor/AlarmEditorSheet.swift`) | — |
| 게이트 표시(비로그인·유료 갈래는 두 앱이 §1 의 표와 다르다 — 같은 절의 '지금 구현' 표) | `PlanGateDialog` (`ui/components/PlanGateDialog.kt`) | 내용 `showVoicePlanLockedAlert` (`AlarmEditorSheet.swift`) → 그리기 `VoicePlanGateAlert` | — |
| 유료 판정 — **유일 출처** | `resolvePaidVoiceAccess` (`ui/util/PlatformAndLabelUtils.kt`) | `PaidVoiceGate.resolve` | `isPaidVoicePlan` |
| 판정 소비 — 표시·게이트 | `MainViewModel.isPaidVoiceEntitledOptimistic` | `PlanTier.bestKnown`(보류면 남은 행으로 등급을 올리지 않는다 — 기간 중에는 `bestKnown(user:)`) | — |
| 판정 소비 — 되돌릴 수 없는 잠금 | `MainViewModel.isDefinitelyFreePlan` · 갈래 `foregroundPlanLockAction` · 낡은 프로모 갈래는 이번 진입의 plan 반영 뒤에만(`freePlanLockMayApply` → `WaitForEntryPlan`, 재확인 `deferredPromoLapseLockDue` — `billing-lifecycle.md` D12) | `AlarmTalkApp.applyFreePlanVoiceLockIfNeeded` · 낡은 프로모 갈래는 이번 진입의 plan 반영 뒤에만(`PaidVoiceGate.freePlanLockMayApply`·`isFreeOnlyByPromoLapse`, `AuthViewModel.planAnsweredEntry`, 재확인 `promoLapseLockWaitKey` — D12) | — |
| 기간 한정 개인 플랜 — 낡은 캐시만 무료로(D1·D7: 받은 시각 = `computed_at`, 없으면 끝 전의 답) | `personalPromoLapsed`·`planAnswerStampMillis`(`ui/billing/PersonalPromo.kt`) | `PersonalPromo.isStale`·`PersonalPromo.fetchedAt` | `personalPromoField` 의 `computed_at` |
| 게이트에 코드 입력 없음(§2 — 결제 쪽 액션은 '이용권 보기' 하나) | `PlanGateDialog` 의 액션 두 개(입력 슬롯 없음) — 회귀 `GiftCodeRemovalTest`. CI 검사 (e) 가 `PlanGateDialog.kt` 전체에서 입력 칸·코드 등록 이름을 막는다 | `VoicePlanGateAlert`(편집기) · `VoiceProfileManagementPanel` 의 `planGateOpen` 알럿(목소리 탭) · 문구 `PaidGateCopy`. CI 검사 (e) 가 앞의 파일 전체와 뒤의 알럿 블록을 막는다 | — |
| 게이트 버튼 순서 [닫기][이용권 보기] — §2 | `PlanGateDialog` 의 `actions` 순서 — 회귀 `GiftCodeRemovalTest` | '닫기' 의 `.cancel` 역할(시스템이 앞에 둔다) — 회귀 테스트 없음, 실기기로 본다 | — |
| 코드 칸 없음 — 앱 어디에도(더보기의 '초대 코드 등록' 도 지웠다, 2026-10-20) · 옛 앱의 등록은 어떤 코드든 404 `CODE_NOT_FOUND` | 더보기에 코드 등록 행이 없다(`ui/home/HomeComponents.kt`) | 더보기에 코드 등록 행이 없다(`MenuView`) | `routes/code.ts`(옛 앱 호환 — 본문을 읽지 않고 조회 없이 404) — 회귀 `test/code.test.ts` |
| 파는 상품은 개인 월간 구독 하나(코드를 발급하는 1회성·소모성 상품 없음 · 커플·가족 상품 없음) | `PlayBillingProducts.all`(`billing/PlayBillingManager.kt`) | `SubscriptionProduct`(`Services/IAP/SubscriptionProduct.swift`) · `Configuration/StoreKitConfiguration.storekit` | `APPLE_PRODUCT_TO_PLAN_KEY`(`lib/apple-storekit.ts`) · `googlePlanKeyFromProductId`(`lib/play-subscriptions.ts`) — `personal_monthly` 하나, 목록 밖 상품은 400 `UNKNOWN_PRODUCT` |
| 강제 — 무엇이 막는가(CI lint 는 필수 체크, 두 앱의 단위 테스트는 각 빌드 워크플로 — 필수 체크가 아니다) | CI lint `scripts/check-paid-unlock-codes.py` 의 (a) 화면 문구·(b) 코드·(e) 게이트 모양 + 단위 테스트 `GiftCodeRemovalTest`(`android-build.yml`) | 같은 검사의 (a)·(b)·(e) + 단위 테스트 `GiftRemovalTests`(`ios-build.yml`) | 같은 검사의 (b) 코드·라우트 경로·(d) 초대 코드 형식이 남지 않았는지 + `gift-codes-retired.test.ts`·`code.test.ts`(필수 `test` 잡). 스토어 문구 원본은 같은 검사의 (c) |
| 구독 조회 | `subscriptionResponse` | `socialFeatures.subscription` | `routes/billing-query.ts` |
| 진입 갱신 — 목소리·이용권(완결된 갱신만 · 60초 · 같은 계정·같은 앱 진입 · 보낼 때 적는다) | `ui/app/AlarmTalkApp.kt` 의 `lastTabRefreshAt`(키는 `tab to sessionEffectKey` — 계정 + 세션 세대라 규칙과 같다. ⚠ 표를 갱신 **전에** 적는다 — 실패 뒤 재시도 규칙은 아직 다르다) | `EntryRefreshFreshness` · `SocialFeatureViewModel.refreshOnEntry` · `VoiceStudioViewModel.refreshOnEntry` — 부르는 자리 `MainTabsView.refreshForSelectedTab`(목소리·더보기)·`MainTabsView.refreshAll`·`AlarmEditorSheet`·`BillingPanel` | — |
| 알람 탭 동기화 스로틀(키 = 탭 + 계정 — 토큰 아님 · 완결되지 않은 회차는 칸을 지운다) | 같은 `lastTabRefreshAt`(`tab to sessionEffectKey` — ⚠ 실패해도 칸을 지우지 않는다) | `MainTabsView.tabRefreshThrottleKey` · `AlarmTabSyncThrottle`(완결 판정은 `RemoteAlarmSyncViewModel.runFullSync` 의 반환값. 재로그인은 `MainTabsView` 가 새로 만들어져 표가 비워진다) | — |
| 쓰기·푸시 뒤 이용권 + plan(`/auth/me` 한 번 — 끝까지 못 가면 사용자 새로고침) | — | `SocialFeatureViewModel.refreshAllThenUserIfIncomplete` — 부르는 자리 `plan_changed`(`AlarmTalkApp` 의 `onPlanChanged`)·`BillingPanel` 의 구매·복원·구독 관리 시트 닫힘 | — |
| 이용권 새로고침의 조회는 한꺼번에(쓰는 순서·가드는 그대로 · 수위·계정 표는 보내기 전에) | `MainViewModelBillingActions.refreshBillingData`(구독 하나) | `SocialFeatureViewModel.refreshAll`(`async let`); 회귀 `EntryRefreshFreshnessTests`(두 조회가 한꺼번에·표는 보내기 전에·구독 실패에도 계정 답을 이 진입의 결과로) | — |

## 관련 규약 (다른 문서)

- 목소리 라우트가 요구하는 **동의**가 없을 때는 게이트가 아니라 동의 시트를 연다 →
  `CLAUDE.md` 「동의 화면 규약」
- **알람 권한** 게이트는 이것과 별개다(무료·유료 무관) → `CLAUDE.md` 「알람 권한 3종」


## 웰컴 코드 안내 — **폐지** (2026-09-27)

첫 진입 + 무료 등급에게 계정당 1회 뜨던 코드 안내 시트(2026-08-18 결정, 양 앱 바텀시트)는
**지웠다.** 기간 한정 개인 플랜([`billing-lifecycle.md`](billing-lifecycle.md))이 같은 자리를
대신하고, 운영 중이던 웰컴 그룹 코드(`redemption_group = 'welcome'`)는 마이그레이션 121 로
비활성화했다(이력 보존 — `DELETE` 하지 않는다). 서버의 웰컴 전용 이름 폴백도 지웠다 — 그룹당
1회 규칙은 `redemption_group` 컬럼 하나로 모든 그룹에 똑같이 걸렸다(그 규칙도 프로모 코드와 함께
사라졌다 — 아래 「프로모 코드 — 폐지」).

⚠ **되살릴 때 옛 소진 플래그(`promo_prompted_*`)를 재사용하지 말 것.** 기존 계정은 이미
`true` 라 새 안내가 영영 뜨지 않는다.

**코드 입력은 없다**(2026-10-20). 2026-10-14 에 이용권 게이트의 '선물·초대 코드가 있어요'(안드로이드
`PlanGateDialog` 의 입력 알럿, iOS `RedeemCodeSheet`)를 지웠고, 마지막 입구였던 더보기 → 초대 코드 등록(안드로이드
`FamilyConnectionPanel`, iOS `PeoplePanel`)도 커플·가족 이용권과 함께 지웠다(아래 「커플·가족 이용권 — 폐지」).
되살리지 말 것.

## 프로모 코드 — **폐지** (2026-10-12)

운영자가 만든 문자열 코드(`promo_codes`)로 유료 이용권을 주던 기능을 **서버·두 앱에서 지웠다.**
iOS 1.2.11(빌드 8)이 App Store 심사 지침 **3.1.1**("인앱 결제가 아닌 수단으로 기능을 열면 안 된다 —
프로모 코드로 유료 기능을 연다")로 반려됐다. 운영 중인 프로모 코드는 그때 이미 0개였다(웰컴 그룹
3개는 #121 로 꺼져 있었다).

- **서버가 받지 않는 것이 실질 차단이다.** 앱 문구만 지우면 이미 깔린 옛 앱('프로모션 코드' 문구가
  남은 버전)으로 계속 열린다. `POST /code/register` 는 (그때는) INV-/GIFT- 형식이 아니면 조회 없이
  `CODE_NOT_FOUND` 였고 — 2026-10-14 부터는 INV- 하나, 2026-10-20 부터는 어떤 코드든 `CODE_NOT_FOUND` 다 —
  옛 경로 `POST /billing/promo/redeem` 은 라우트째 지웠다(404).
- **문구에 '프로모션'·'쿠폰' 을 되살리지 말 것.** 코드 칸의 이름은 그때 '초대·선물 코드' 였고, 2026-10-14
  부터 '초대 코드' 였다가 2026-10-20 에 칸 자체가 없어졌다(양 앱 ko·en·ja).
- ⚠ **이 폐지는 사례만 고쳤다.** "남은 두 코드(선물·초대)는 둘 다 스토어 결제에서 나온다" 는 이유로 선물
  코드를 남겼는데, 애플이 막는 것은 결제 수단이 아니라 코드로 여는 것 자체였다 — 그래서 1.2.12 가 같은
  지침으로 다시 반려됐다(아래).
- **이력은 남긴다.** `promo_codes`·`promo_code_redemptions` 는 지우지 않는다 — 받은 사람의 구독 근거다.
  관리자 콘솔(`/admin/promo`)은 그 이력을 **읽기만** 한다. 발급·켜기 라우트는 지웠다 — 만들어도 아무도
  쓸 수 없는 코드가 생길 뿐이라서다.
- 프로모 갈래의 에러 코드(`ACTIVE_SUBSCRIPTION_EXISTS`·`CODE_EXHAUSTED`·`CODE_GROUP_ALREADY_REDEEMED`·
  `CODE_INACTIVE`·`CODE_MISCONFIGURED`·`CODE_NOT_IN_WINDOW`·`PROMO_REDEEM_FAILED`)는 목록·두 앱의
  문구 표·예상된 거절 목록에서 함께 지웠다 — 서버가 더는 내지 않는다(`error-codes.md`).
- 행사 혜택이 필요하면 **스토어의 오퍼 코드**(App Store 오퍼 코드 · Play 프로모션 코드)를 쓴다 —
  결제가 스토어를 거치므로 3.1.1 에 걸리지 않는다. 우리 서버에 코드 체계를 다시 만들지 말 것.

## 선물 코드 — **폐지** (2026-10-14)

개인 이용권을 사서 남에게 보내던 **선물**(1회성 상품 결제 → `GIFT-XXXX-XXXX-XXXX` 코드 발급 → 받는 사람이
코드 칸에 입력)을 **서버·두 앱·두 스토어에서 지웠다.** iOS 1.2.12(빌드 9)가 App Store 심사 지침 **3.1.1** 로
**두 번째** 반려됐다(2026-10-12, 심사 기기 iPhone 17 Pro Max·iPad Air 11-inch (M3)). 애플의 문장:

> The app still unlocks or enables additional functionality with mechanisms other than In-App Purchase, which is
> not appropriate. Specifically, the app uses gift code to unlock or enable digital item/feature. … It would be
> appropriate to remove these features from the app and any other feature that unlocks or enables functionality
> with mechanisms other than the App Store. If you want to provide discounted or free access to items or
> subscriptions in the app, create offer codes for In-App Purchases.

- **왜 두 번 반려됐나 — 사례를 고치고 종류를 남겼다.** 1.2.11 반려(프로모 코드) 때 프로모 코드만 지우고,
  남은 선물·초대 코드는 "둘 다 스토어 결제에서 나온다" 는 이유로 두었다(그 반려의 근거 화면 문구 "초대 코드, 이용권
  선물 코드, 프로모션 코드 모두 등록할 수 있어요" 에 선물 코드가 이미 있었다). 애플이 막는 것은 결제 수단이 아니라
  **코드를 쳐서 유료 기능을 여는 것** 자체다 — 선물은 보낸 사람이 인앱 결제로 샀어도 받는 사람은 코드로 연다.
  게다가 1.2.12 의 스토어 설명("개인 1개월 이용권을 선물 코드로 보낼 수도 있어요")과 심사 노트(선물 코드의
  출처를 설명하며 "같은 선물을 Google Play 에서도 판다" 고 적었다)가 그 기능을 직접 내보였다.
- **운영 데이터는 없다**(2026-10-14 prod 읽기 전용 조회): 발급된 GIFT 코드 0개, 두 스토어의 선물 결제 0건.
  옮기거나 환불할 것이 없다. 초대 코드는 7개 발급·0개 사용이었다.
- **서버가 받지 않는 것이 실질 차단이다 — 모든 앱 버전에, 안드로이드 포함.**
  - `POST /code/register` 는 INV- 4-4-4 형식이 아니면 조회 없이 404 `CODE_NOT_FOUND` 였다 — GIFT- 코드는
    `voucher_codes` 에 발급 행이 남아 있어도 읽지 않았다. 2026-10-20 부터는 어떤 코드든 404 이고 그 표도 없다.
  - 선물 상품의 결제 확정(애플 `com.alarmtalk.app.personal_gift_1m`·구글 `personal_gift_1m`)은 상품 목록에서
    빠져 400 `UNKNOWN_PRODUCT` 다 — 코드를 만들지 않는다. 구글은 Play 를 부르기 전에 끝나 확인(acknowledge)도
    하지 않으므로 Play 가 3일 뒤 자동 환불한다. 애플 환불 통보도 같은 자리에서 끝난다(예전의 선물 환불 회수
    갈래는 지웠다). ⚠ 애플은 전달하지 못한 소모성 결제를 스스로 환불하지 않는다 — 그래서 **판매 중지가 prod
    배포보다 늦으면 안 된다**(옛 빌드로 산 사람은 돈만 내고 코드를 못 받는다).
  - 발급한 코드 목록(`GET /billing/vouchers`)과 공유할 코드(`POST /billing/vouchers/family-share`)는 INV- 만 돌려줬다
    — 옛 GIFT- 행이 남아 있어도 옛 앱의 목록·공유 화면에 나오지 않았다(2026-10-14 2차). 2026-10-20 부터 목록은 언제나
    빈 배열이고 공유 라우트는 없다.
  - dev 스텁 `POST /billing/checkout` 의 `gift: true` 는 400 `INVALID_REQUEST` 다. 운영자가 코드를 찍어 내던 dev 라우트
    `POST /billing/test-codes` 는 지웠다(그 코드는 주인 구독이 없어 등록조차 안 됐고, 되게 고치면 운영자 코드로 이용권을
    여는 1.2.11 반려의 모양이 된다). 에러 코드 `FORBIDDEN`·`INVALID_COUNT`·`INVALID_DAYS` 는 그 라우트만 냈다.
  - 에러 코드 `GIFT_PERSONAL_ONLY`·`INVALID_GIFT_PLAN` 과, 선물 확정 갈래만 내던 `PURCHASE_NOT_COMPLETED` 는
    목록에서 지웠다. 두 앱의 표에서도 앞의 둘을 지웠다(`error-codes.md`). 그때 남긴 `INVALID_INVITE_PLAN` 은
    2026-10-20 초대 코드와 함께 지웠다.
- **두 앱(1.2.13)**: 개인 카드의 '선물하기'·선물 결제·선물 공유 문구, 유료 게이트의 '선물·초대 코드가
  있어요'(§2)를 지웠다. 코드 칸은 '초대 코드'(ko·en·ja 같은 문구)였고 넣는 자리는 더보기 → 초대 코드 등록
  하나였다(2026-10-20 에 그 입구도 지웠다 — 위 「웰컴 코드 안내 — 폐지」 끝). 이용권 화면의 코드 공유는 커플·가족
  카드에만 남겼다.
- **스토어**: 두 스토어의 선물 상품은 판매를 내렸다(2026-10-14) — App Store 인앱 구입
  `com.alarmtalk.app.personal_gift_1m` 은 `DEVELOPER_REMOVED_FROM_SALE`(판매 지역 0곳), Play `personal_gift_1m` 의 구매
  옵션 `personal-gift-1m` 은 `INACTIVE`. 스토어 설명의 선물 줄과 결제 문단의 '1회성 선물' 문장도 지웠고, 커플·가족 줄은
  "한 사람이 구독하고 초대 코드로 그 이용권에 들인다" 로 고쳤다(`docs/product/app-store-listing.md`·`play-store-listing.md`).
- **이력은 그때 남겼다.** `voucher_codes`·`apple_gift_deliveries` 표는 지우지 않았다(마이그레이션 없음). 두 표는
  2026-10-20 마이그레이션 #131 이 초대 코드와 함께 지웠다(prod 의 선물 연결은 0행이었다). 1회성 결제(구독 행 없는
  `store_transactions`)의 5년 보존 갈래는 그대로다.

### 규칙 — 코드로 유료 기능을 열지 않는다 (사례가 아니라 종류로)

- **코드로 유료 기능을 얻는 길은 없다.** 마지막으로 남았던 초대 코드(INV-)는 새 권한을 만드는 것이 아니라
  **주인이 이미 인앱 결제로 내고 있는** 커플·가족 그룹의 빈자리에 합류하는 것이라 애플도 문제 삼지 않았지만,
  2026-10-20 커플·가족 이용권과 함께 지웠다(아래 「커플·가족 이용권 — 폐지」).
- **선물·프로모·쿠폰·체험·라이선스·초대 코드를 새로 만들지 말 것** — 이름이 달라도 '코드를 쳐서 유료 기능이
  열린다' 면 같은 것이다. **코드를 발급하는 1회성·소모성 상품**도 같다.
- 앞으로의 할인·무료 이용은 **스토어 장치로만** 준다 — App Store 는 첫 구독 할인(introductory offer)·오퍼 코드, Play 는
  프로모션 코드·무료 체험. 코드를 넣는 곳도, 결제도 스토어다 — 우리 서버에 코드 체계를 다시 만들지 않는다. 앱 안에서
  오퍼 코드를 받게 하고 싶으면 스토어의 시스템 화면(StoreKit 의 오퍼 코드 시트 등)을 띄운다 — 그건 우리 코드 칸이 아니다.
  그 버튼 문구가 아래 검사의 어휘(redeem 등)에 걸리면 검사의 허용 목록에 이유와 함께 둔다.
- ⚠ **스토어 밖 예외는 지금 하나뿐이다 — 되풀이하지 않는다.** 서버가 켜고 끄는 기간 한정 개인 플랜
  ([`billing-lifecycle.md`](billing-lifecycle.md) 「기간 한정 개인 플랜」 — 끝 시각은 shared 의 `PERSONAL_PROMO.endsAt`
  한 곳에만 둔다)이 원시 무료 계정 모두에게 결제 없이 개인 플랜을 연다. 코드를 치는 길은 아니지만 스토어를 거치지 않고
  유료 기능을 여는 것이라 심사 노트에 밝힌다(1.2.11 노트부터 — 1.2.13 노트에도 남긴다). 이 기간이 끝난 뒤의 행사는 위
  스토어 장치로 한다 — 같은 모양의 서버 무료 기간을 새로 만들지 말 것.
- **앱에 코드 칸을 두지 않는다** — 이용권 화면·유료 게이트(페이월)는 물론 더보기에도. 막힌 기능 바로 옆의 코드
  칸은 '코드를 넣으면 열린다' 로 읽힌다.
- **스토어 설명·출시 노트·심사 노트에 코드로 유료 기능을 연다고 쓰지 않는다.** 커플·가족 이용권과 초대 코드도
  다시 적지 않는다(2026-10-20 종료).
- 강제(무엇이 실제로 막는가 — 위 「구현 지도」 의 '강제' 줄):
  - **서버**가 실질 차단이다(옛 앱이 남는다): 코드 등록은 어떤 코드든 `CODE_NOT_FOUND`, 발급 코드 목록은 언제나
    빈 배열, 개인 월간 구독 밖의 상품은 `UNKNOWN_PRODUCT`. 회귀 `packages/backend/test/gift-codes-retired.test.ts`·
    `code.test.ts`(필수 `test` 잡).
  - **CI lint** `scripts/check-paid-unlock-codes.py`(필수 `lint` 잡): (a) 두 앱의 화면 문구와 (c) 스토어 문구 원본에
    선물·프로모·쿠폰·바우처·redeem·이용권 코드·초대 코드·커플·가족 이용권 어휘, (b) 앱·서버 코드에 은퇴한 상품
    id(선물·커플·가족)·`GIFT-` 형식·선물 에러 코드·이름 속의 gift·서버의 gift 라우트 경로·초대 코드 발급 경로
    (`family-share`), (d) 서버에 초대 코드 형식·검증 함수가 남지
    않았는지(2026-10-20 — 그 전에는 형식이 INV- 4-4-4 그대로인지를 봤다), (e) 두 앱의 유료 게이트에 입력 칸·코드 등록이
    없는지. 아는 어휘·형식·자리만 본다 — 새 이름·새 자리는 리뷰가 본다(`AGENTS.md` 「리뷰에서 막을 것」).
    ⚠ 관계 라벨의 '가족'(목소리 등록의 관계·호칭)은 막지 않는다 — 막는 것은 이용권 이름이다.
  - **두 앱의 단위 테스트**: Android `GiftCodeRemovalTest`(`android-build.yml`), iOS `GiftRemovalTests`(`ios-build.yml`).
    둘 다 필수 체크가 아니다.
  - 못 보는 것: 심사 노트와 App Store '이 버전의 새로운 기능' 의 실제 입력값(저장소 밖) — 제출 전에 사람이 읽는다
    (`docs/qa/dev-test-handoff.md`).

## 커플·가족 이용권 — **폐지** (2026-10-20)

커플·가족 이용권(플랜 그룹)과 **그것에만 딸린 기능**을 서버·두 앱에서 지웠다 — 초대 코드, 목소리 공유, 가족
알람(남에게 보내는 알람과 받은 알람), 그룹 전용 설정(설정 불가능 시간·받기 허용), 그룹 직접 입력 한도 풀(커플
50·가족 100), 탈퇴한 그룹 주인의 등급 통지 대기열. 남는 이용권은 **무료**와 **개인**(`plans.key = 'personal'`,
`users.plan = 'plus'`) 둘이다. 오너 결정이고 이유는 **앱 안정화**다 — 서로 맞춰 주는 기능(공유·전달·그룹 전파)
때문에 버그가 계속 났다. 되살리는 변경은 리뷰가 P1 로 막는다(`AGENTS.md` 「리뷰에서 막을 것」).

- **운영 데이터**(2026-10-20 prod 읽기 전용 조회): 활성 그룹 구독 0, 그룹 플랜의 스토어 결제·보존 결제 기록 0,
  공유 목소리 0, 남에게 보낸 알람의 서버 행 0, 가족 알람 문구 0, 남의 목소리·문구를 가리키는 알람 0,
  `users.plan = 'family'` 0. 옮기거나 환불할 것이 없다(그룹 플랜의 구독 10행은 전부 해지된 지급분이었다 — 웰컴
  프로모·개발 도구).

### 서버 — 지운 것과 남긴 것

- **마이그레이션 #131(`drop-couple-family-plans`, 원자적 하나)** 이 지운다:
  - 표 — `plan_groups`·`plan_group_members`·`voucher_codes`·`voucher_redemptions`·`apple_gift_deliveries`·
    `alarm_recipient_state`·`targeted_alarm_slots`·`pending_plan_notifications`·`voice_profile_relationships`·
    `alarm_creation_order`(그 트리거 셋 포함)
  - 컬럼 — `alarms.target_user_id`·`alarms.delivery_version`·`voice_profiles.is_shared`·`subscriptions.plan_group_id`·
    `users.allow_family_alarms`·`users.family_alarm_quiet_windows`·`plans.max_members`
  - 행 — `plans` 의 `couple`·`family` 와 그 플랜의 구독 행(전부 해지됨), 보낸 가족 알람의 서버 행, `family`·
    `family-voice` 문구(녹음의 R2 키는 행보다 먼저 삭제 큐로 옮긴다), 그룹 풀의 직접 입력 한도 장부
- **남긴 것**: CHECK 의 `'family'` 리터럴(`plans.plan_type`·`users.plan`). 좁히려면 부모 표를 다시 만들어야 하는데
  FK 강제 때문에 마이그레이션 트랜잭션 안에서 못 한다 — 그 값을 쓰는 코드가 없어 무해하다. 관리자 프로모 콘솔
  (`/admin/promo`)의 옛 웰컴 코드 둘은 플랜 행이 없어 플랜 이름이 `?` 로 보인다(이력 표시뿐이다).
- ⚠ **배포가 마이그레이션보다 먼저 돈다**(CLAUDE.md 「배포 / 환경」). 그래서 새 코드는 지운 표·컬럼을 **하나도**
  부르지 않는다 — 옛 스키마 위의 그 1분에도 맞다. 개인 경로에 끼어 있던 그룹 문장 셋(같은 플랜 갱신의 초대 코드
  만료 연장, 해지·만료·환불의 미사용 초대 코드 만료, 무료 강등의 공유 해제)도 **같은 배포**에서 지웠다 — 하나라도
  남으면 #131 뒤 개인 갱신·해지·만료·환불·프로모 종료가 통째로 롤백된다. dev 배포로 먼저 확인하고 prod 는 그 뒤다.
- **목소리·문구 접근이 두 갈래로 줄었다**(쌍 규칙 — CLAUDE.md). 쓰기(`messageBelongsToCaller`·
  `voiceProfileBelongsToCaller`)와 읽기(`GET /tts/messages/:id/audio`)가 똑같이 **내 문구(내 목소리·시스템
  목소리) 또는 시스템 스톡 프리셋**만 받는다. 남의 목소리 갈래와 그 주인의 원시 플랜 규칙, 받은 알람의 음원
  갈래를 함께 지웠다.
  `PATCH /voice/:id/relationship` 은 남의 목소리(공유 보기) 갈래만 지우고 내 초안 갈래는 둔다(1.2.10 호환 —
  [voice-and-message.md](voice-and-message.md) 구현 지도의 '클론 문구의 결' 행).
- **무료 강등·목소리 삭제가 남의 알람을 건드리지 않는다.** 남의 계정 알람이 내 목소리·문구를 가리킬 길이
  없어졌으므로(운영 0행) '타인 알람 강등' 문장을 지웠다.
- `voice_share_changed` 푸시는 남는다 — 제자리 교체의 재렌더가 다 게시됐을 때 **목소리 주인의 기기**에만 간다
  (이름은 옛 앱 때문에 그대로 — [voice-and-message.md](voice-and-message.md) §4-1·§5-2).

### 스토어 상품 — 판매 중지가 prod 배포보다 먼저다

- 서버의 상품 매핑은 `personal_monthly` 하나다(애플 `com.alarmtalk.app.personal_monthly`, Play `personal_monthly`).
  커플·가족 상품(`couple_monthly`·`family_monthly`)의 확정은 400 `UNKNOWN_PRODUCT` 다. Play 는 Play 를 부르기 전에
  끝나 구매를 확인(acknowledge)하지 않으므로 3일 뒤 자동 환불되지만, **애플은 환불하지 않는다.**
- ⚠ 그래서 **두 스토어의 커플·가족 상품은 오너가 prod 배포 전에 판매를 내린다**(App Store Connect 판매 중지 ·
  Play 기본 요금제 비활성). 늦으면 옛 앱으로 산 사람이 애플에서는 돈만 내고 권한을 못 받고, 개인 구독자가 같은
  구독 그룹 안에서 '업그레이드' 하면 재조회가 모르는 상품을 만난다. 개인으로 매핑하지 말 것 — 개인 이용권에
  커플·가족 값을 받게 된다.

### 옛 앱에 남기는 응답 — 강제 업데이트가 끝날 때까지

옛 앱(그룹 기능이 남은 빌드 — 안드로이드 versionCode 35·iOS 빌드 13 까지)은 그룹·공유·받은 알람 조회를 **이용권
갱신과 한 묶음으로** 부른다. 하나라도 200 의 모양으로 답하지 않으면 개인 이용권 갱신까지 버려진다(안드로이드는
구독 응답을 함께 버리고, iOS 는 권한 스냅샷을 '미완' 으로 두어 `plan_changed` 의 예약 재조정을 건너뛴다). 그래서
아래는 **상태 없는 빈 응답**으로 남긴다 — DB 를 보지 않고, 지금 prod 의 모든 계정이 받던 값과 같아 옛 앱은 다른
점을 모른다.

| 요청 | 답 | 왜 남기나 |
| --- | --- | --- |
| `GET /family/groups/current` | 200 `{"group":null,"role":null,"members":[]}` | 실패하면 옛 안드로이드는 이용권 정보 오류를 띄우고 목소리 접근권 대조를 건너뛴다. 옛 iOS 는 권한 스냅샷이 미완으로 남는다 |
| `GET /billing/vouchers` | 200 `{"vouchers":[]}` | 두 앱이 구독 조회와 한 묶음으로 기다린다 — 실패하면 구독 답까지 버린다 |
| `GET /voice/family` | 200 `{"profiles":[]}` | 옛 안드로이드 접근권 워커가 실패마다 재시도하고, 옛 iOS 는 내 알람 대조를 건너뛴다 |
| `GET /alarm`(커서) | 200 `{"alarms":[],"has_more":false,"next_cursor":null}` — **인증 라우터 뒤에** 둔다 | 옛 안드로이드 주기 워커가 이 요청의 403 `ACCOUNT_PENDING_DELETION` 으로 탈퇴 신청을 알아듣는다([session-and-auth.md](session-and-auth.md) 「탈퇴 유예」). 실패하면 워커 재시도, 옛 iOS 는 저장마다 '알람 정보를 불러오지 못했어요' |
| `GET /alarm/declined` | 200 `{"alarm_ids":[],"revoked_alarm_ids":[],"has_more":false}` | 두 앱이 회차마다 부른다(옛 iOS 디코더는 세 키가 다 있어야 한다) |
| `POST /alarm/:id/decline` | 200 `{"success":true,"declined":true}` | 옛 앱에 남은 받은 알람을 지울 때 부른다 — 코드 없는 404 면 옛 안드로이드가 그 알람을 지우지 못한다 |
| `POST /code/register` | 404 `CODE_NOT_FOUND` — 어떤 본문이든 | 옛 앱의 '초대 코드 등록'. 두 앱이 예상된 거절로 읽는다(코드 없는 404 면 시도마다 Sentry 이슈) |
| `GET /billing/subscription` | `plan.max_members: 1` 을 리터럴로 계속 싣는다(컬럼은 지웠다) · `plan.plan_type` 은 그대로 · `subscription.plan_group_id` 는 뺀다 | 옛 iOS 디코더가 `max_members` 를 필수로 읽는다 — 없으면 결제 전 조회를 포함한 응답 전체를 못 읽는다 |
| `PATCH /user/me` | 가족 알람 설정 키를 무시하고 응답에서 뺀다 | 옛 앱은 그 키를 보내지 않는다(그 키만 오면 예전처럼 400 `NO_FIELDS_TO_UPDATE`) |
| `POST /voice/clone`·`PATCH /voice/:id` | `isShared`/`is_shared` 를 받고 무시한다 · 응답에 싣지 않는다 | 옛 앱의 목소리 등록이 언제나 보낸다 — 엄격히 거절하면 옛 앱 사용자 전원의 목소리 등록이 깨진다 |
| `POST /alarm` 의 `target_user_id` | 호출자가 아닌 계정(비어 있지 않은 문자열)이면 403 `NOT_CONNECTED`, 그 밖은 무시 | 그룹이 없을 때의 예전 답과 같다. 말없이 내 알람으로 만들지 않는다([alarm-lifecycle.md](alarm-lifecycle.md)) |
| `POST /tts/generate` 의 `target_user_id` | 무시 | 이미 은퇴한 동적 갈래만 읽던 값 |
| 로그인·가입·구글·애플·`/auth/me` 의 `user` | 가족 알람 설정 키를 뺀다 | 두 앱 모두 빠진 키를 견딘다 |

- 각 라우트에 "옛 앱 호환 — minSupported 가 현재 빌드를 넘으면 지운다" 를 적어 둔다. 라우트 등록 순서도 그대로다
  (Hono 는 등록 순서로 맞춘다 — `GET /voice/family` 를 `/:id` 라우트 뒤로 옮기면 다른 라우트가 받는다).
- 그룹 전용 경로는 **지웠다**(404): 그룹 나가기·구성원 내보내기·주인 넘기기, 가족 알람 보내기
  (`POST /family/alarms/voice`·`POST /voice/upload`), 초대 코드 공유(`POST /billing/vouchers/family-share`), 수신 확인
  (`POST /alarm/:id/received`). 옛 앱이 이 경로에 닿으려면 그룹이 있어야 하는데 위 빈 응답이 그룹을 주지 않는다.
- 그룹 갈래만 내던 에러 코드는 목록에서 지웠다(이름을 바꾼 것이 아니다 — [error-codes.md](error-codes.md) §2). 남은
  것은 `CODE_NOT_FOUND`(코드 등록 호환)·`NOT_CONNECTED`(위 `target_user_id`) 둘이다.

### 강제 업데이트 — 두 스토어 게재를 확인한 **뒤에**

이번 출시는 강제 업데이트를 건다 — 옛 앱은 커플·가족 카드와 초대 코드 칸을 그대로 그려 **팔지 않는 이용권**을
보여 준다(오너: 요금제가 앱에 남아 있으면 안 된다). 순서가 중요하다:

1. 이 서버(위 호환 응답 · 법무 문서 7판과 6판을 함께 받음)를 prod 에 낸다 — 운영 배포는 오너가 한다.
2. 새 앱(7판 문서 · 그룹 UI 없음 · 받은 알람 변환)을 두 스토어에 게재한다.
3. **두 스토어 게재를 확인한 뒤** `lib/app-version.ts` 의 `minSupported` 를 새 빌드로 올린다 — 먼저 올리면 받을 것이
   없는 강제 업데이트로 앱이 벽돌이 된다(CLAUDE.md).
4. 그 뒤의 서버 릴리스에서 위 호환 응답·`plan.max_members` 리터럴·`ACCEPTED_POLICY_VERSIONS` 의 `'6'` 을 지운다
   ([consent.md](consent.md) — 앞 버전은 그 문서를 실은 앱을 막은 뒤 목록에서 지운다).

3·4 는 이 변경과 **따로** 낸다. 그 사이 옛 앱은 위 응답으로 개인 기능을 그대로 쓴다.
**3 은 2026-10-26 에 냈다**(Play `36 (1.2.16)` PUBLISHED · App Store 1.2.16 READY_FOR_SALE 확인 뒤 Android 36·iOS 14).
4 는 이 값이 prod 에 나간 뒤의 서버 릴리스다.

### 앱 — 업데이트할 때 기기에서 일어나는 일

- **받은 알람은 내 알람이 된다** — 규칙은 [billing-lifecycle.md](billing-lifecycle.md) 「받은 알람은 내 알람으로 바뀐다」.
- **안드로이드 Room 27→28**: `alarms` 표를 **새로 만든다**(`alarms_new` 를 만들어 옮긴 뒤 옛 표를 지우고 이름을
  바꾸고 인덱스를 다시 만든다) — 그룹 전용 컬럼 `remoteDeliveryVersion`·`observedDeliveryVersion` 을 완전히 없앤다
  (API 34 아래의 SQLite 에는 `DROP COLUMN` 이 없다). 받은 알람 변환도 **같은 트랜잭션**의 SQL 이다. 파괴적 폴백이
  없어 어긋나면 모든 사용자가 실행하자마자 죽는다 — 마이그레이션 테스트가 고정한다. 앞 단계(23→24·24→25)는 그대로
  등록해 둔다(`AlarmDatabaseMigrationSafetyTest` 가 모든 단계를 요구한다).
- **iOS 저장소**: 지운 필드(전달 버전 둘)는 `decodeIfPresent`·모르는 키 무시라 옛 파일이 그대로 읽힌다. 받은 알람은
  **로드 뒤에** 변환하고 곧바로 저장한다. ⚠ 디코드를 던지게 만들지 말 것 — `LocalAlarmPersistence.load` 는 한 행이
  던지면 알람 **전부**를 버린다. `origin` 은 날것의 문자열로 두고 모르는 값은 내 알람으로 읽는다.
- **이름을 지키는 것**(옛 값·옛 앱이 남아 있어서):
  - 안드로이드 주기 워커 `RemoteAlarmSyncWorker` 와 그 고유 작업 이름 — 이제 계정 확인·토큰 갱신만 한다
    ([session-and-auth.md](session-and-auth.md) 「탈퇴 유예」).
  - 알림 채널 `voice_alarm_social_updates_v1` — 서버가 `billing_hold`·`voice_deletion_warning` 의 채널로 보낸다(채널
    이름·설명 문구만 바꾼다).
  - 강등 안내 원인 `SHARED_RELEASED`(안드로이드)·`sharedReleased`(iOS) — 내 목소리의 접근권 상실도 같은 칸에 세고,
    대기표 키가 이름에 묶여 있다.
- 지운 기기 설정(받은 알람 배지·가족 알람 설정·권한 스냅샷의 그룹 칸 등)은 더는 읽지도 쓰지도 않는다 — 남아 있어도
  해롭지 않다.

### 구현 지도 — 커플·가족 이용권 폐지

| 규칙 | 백엔드 | 안드로이드 | iOS |
| --- | --- | --- | --- |
| 상품 매핑 = `personal_monthly` 하나 | `APPLE_PRODUCT_TO_PLAN_KEY`(`lib/apple-storekit.ts`) · `googlePlanKeyFromProductId`(`lib/play-subscriptions.ts`) — 목록 밖은 400 `UNKNOWN_PRODUCT` | `PlayBillingProducts.all`(`billing/PlayBillingManager.kt`) | `SubscriptionProduct`(`Services/IAP/SubscriptionProduct.swift`) · `Configuration/StoreKitConfiguration.storekit` |
| 옛 앱 호환 응답(상태 없음 · DB 를 보지 않음) | `routes/family.ts`(`GET /groups/current`) · `routes/billing-query.ts`(`GET /vouchers` · `GET /subscription` 의 `max_members: 1`) · `routes/voice-profile.ts`(`GET /family`) · `routes/alarm-query.ts`(`GET /` · `GET /declined`) · `routes/alarm-mutation.ts`(`POST /:id/decline` · `target_user_id` 의 403) · `routes/code.ts`(`POST /register`) — 회귀 `test/code.test.ts` 와 각 라우트 테스트 | 부르지 않는다 | 부르지 않는다 |
| 서버 표·컬럼 삭제(원자적 하나) | `lib/migrations.ts` #131 `drop-couple-family-plans` — 회귀 `test/migrations.test.ts` | — | — |
| 개인 경로의 그룹 문장 제거(같은 배포) | `lib/store-billing.ts`(같은 플랜 갱신) · `lib/billing-cancel.ts`(해지 행 문장 · 무료 강등) · `routes/voice-profile.ts`(목소리 삭제) · `lib/voice-slots.ts` | — | — |
| 목소리·문구 접근 = 내 문구(내 목소리·시스템 목소리) 또는 시스템 스톡 프리셋(쌍 규칙) | `routes/alarm-mutation.ts` 의 `messageBelongsToCaller`·`voiceProfileBelongsToCaller` ↔ `routes/tts.ts` 의 `GET /messages/:id/audio`·`findUsableVoiceProfile` | — | — |
| Room 27→28 재생성 + 받은 알람 변환(같은 트랜잭션) | — | `data/AlarmDatabase.kt` 의 `MIGRATION_27_28` — 회귀 `AlarmDatabaseMigrationSafetyTest` 와 27→28 마이그레이션 테스트 | — |
| 저장소 변환(로드 뒤 · 던지지 않는 디코드) | — | — | `LocalAlarmStore` · `LocalAlarmRecord` — 회귀 `LocalAlarmRecordCodableTests` |
| 강제 업데이트(두 스토어 게재 확인 뒤 — 2026-10-26 Android 36·iOS 14 로 올렸다) | `lib/app-version.ts` 의 `minSupported` — 회귀 `test/app-version.test.ts` | — | — |
