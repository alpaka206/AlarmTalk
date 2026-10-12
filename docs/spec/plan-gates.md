# 로그인·이용권 게이트

> **단일 출처.** 구현이 이것과 다르면 구현이 틀린 것이다. → [README](README.md)

## 1. 상태는 **셋**이다 — 둘로 가르지 말 것

2026-08-07 사용자 문의: **"로그인도 했고 쿠폰도 등록했는데 '로그인이 필요하다' 모달이
뜬다."** 원인은 상태가 셋인데 분기가 둘이었던 것이다. 양쪽 앱 모두 같은 결함이 있었다.

| 상태 | 무엇이 문제인가 | 제목 | 확인 버튼이 가는 곳 | 코드 입력(선물·초대) |
| --- | --- | --- | --- | --- |
| **비로그인** | 세션이 없다 | "로그인이 필요해요" | 로그인 | **붙이지 않는다** — 등록할 계정이 없다 |
| **로그인 + 무료** | 이용권이 없다 | "유료 이용권이 필요해요" | 결제 | **여기서만** 뜻이 있다 |
| **로그인 + 유료** | 플랜 문제가 **아니다** | "기본 목소리로는 직접 입력을 쓸 수 없어요" | **목소리 등록** | 붙이지 않는다 — 이미 유료다 |

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
`computed_at` 이 우선이고(D7), 받은 시각이 아예 없는 캐시는 끝 전의 답으로 본다). 기간 중에는
보류 규칙도 그대로다 — 남은 구독 행·가족 그룹이 커플·가족을 열지 못한다(D9). '로그인 + 무료'
갈래는 지우지 않는다:
기간이 끝나면 같은 계정이 곧바로 그 갈래로 돌아온다.

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

'선물·초대 코드가 있어요'·'이용권 보기' 는 **이용권이 없어서 막힌 경우에만** 뜻이 있다.

- 비로그인에게 코드 입력을 붙이면 → 넣어도 **등록할 계정이 없다**
- 유료에게 코드 입력·결제를 붙이면 → 눌러도 **아무 일도 일어나지 않는다**

⚠ 이 액션의 이름은 **'선물·초대 코드'** 다 — '쿠폰'·'프로모션' 으로 되돌리지 말 것(아래 「프로모 코드 — 폐지」).

⚠ 게이트를 새로 만들 때 액션 목록을 그대로 복사하지 말 것. 상태를 먼저 정하고,
그 상태에 **실제로 도움이 되는 액션만** 붙인다.

## 3. 유료 판정이 무엇을 보는가

⚠ **판정 규칙의 유일 출처는 [`billing-lifecycle.md`](billing-lifecycle.md) 의
「유료 판정 — 우선순위 다섯 단」이다**(2026-09-01 통합). 이 문서는 그 결과를 **게이트가
어떻게 쓰는가**만 말한다. 아래는 예전에 여기 적혀 있던 규칙이 왜 바뀌었는지의 요약이다:

- 예전: "구독 응답만 본다 / **응답이 없으면 무료로 본다**".
- 지금: 스토어 → `users.plan = free` → 구독 응답(만료) → 남은 plan·그룹 → **모름**.
  - **응답이 없는 것은 '무료' 가 아니라 '모름' 이다.** 무료로 접으면 로딩 중에 유료
    사용자가 무료 안내를 보고, 되돌릴 수 없는 잠금까지 걸릴 수 있다.
  - 대신 `users.plan` 이 이미 free 라고 말하면 그걸 따른다 — 그건 서버가 준 답이다.
  - 만료 시각은 계속 본다(로컬에 남은 stale `active` 가 통과하지 않도록).
- 소비는 두 규칙뿐이다: **모르면 잠그지 않는다**(표시·울림·저장) /
  **확실히 무료일 때만**(되돌릴 수 없는 잠금·강등).

**코드 등록은 선물·초대 이용권 둘뿐이고, 등록하면 구독 행이 생긴다**(2026-10-12 — 프로모 코드 폐지).
- **이용권 코드(INV-/GIFT-)** → `subscriptions` 행을 만들고 `users.plan` 도 올린다 → 유료 판정 통과.
  둘 다 **스토어 결제에서 나온다** — GIFT- 는 보낸 사람이 산 선물(`billing-apple.ts`·`billing-google.ts`),
  INV- 는 커플·가족 이용권 주인의 초대다.
- 그 밖의 문자열은 전부 `CODE_NOT_FOUND` 다. 프로모 코드는 없다 — 아래 「프로모 코드 — 폐지」.
- 받는 사람에게 활성 구독이 있어도 **거절하지 않는다** — 기존 구독 행을 정리하고
  (`cancelActiveSubscriptionsForUser`) 새 행을 만든다. 막는 것은 **다른 사람이 함께 쓰는 그룹의
  주인**뿐이다(`OWNS_ACTIVE_GROUP` — 한 사람의 등록이 남의 구독을 깨지 않게). (2026-10-12 정정 —
  예전에는 "둘 다 활성 유료 구독이 있으면 거절한다" 고 적혀 있었는데, 거절은 프로모 갈래의
  `ACTIVE_SUBSCRIPTION_EXISTS` 뿐이었다.)
- ⚠ **기간 한정 개인 플랜은 구독이 아니다.** 원시 무료 계정은 기간 중에도 선물·초대 코드를 그대로
  등록할 수 있다(그 판정은 원시 구독 행만 본다). 등록한 이용권 구독은 자기 `expires_at` 대로
  가고, 기간과 겹치는 날은 그냥 소진된다.

## 4. 이용권·목소리 정보는 **언제 다시 받는가** (2026-09-29)

게이트는 받아 둔 값으로 판정한다 — 값이 낡으면 게이트가 틀린다. 그렇다고 화면이 뜰 때마다
다시 받으면 같은 응답을 몇 번씩 기다린다. 다시 받는 때는 넷이다.

- **진입 갱신** — 탭·화면에 들어갈 때. 같은 계정의 **완결된** 갱신이 같은 앱 진입 안에서
  **60초** 안에 있었으면 다시 받지 않는다. 목소리·더보기 탭과 화면(편집기·구성원·이용권)이
  모두 같은 창을 본다.
  - ⚠ **목소리 탭의 진입 갱신은 빼지 말 것**(2026-08-24 실기기). 예전에는 목소리 탭이 앱
    시작의 캐시 스냅샷에만 기대, 다른 기기에서 플랜이 바뀌면 가족 이용권 사용자가 '추가' 를
    눌렀는데 이용권 안내 모달이 떴다. 창은 그 낡음을 60초 이하로 묶을 뿐 없애지 않는다.
  - ⚠ **키에 토큰을 넣지 말 것.** `/auth/me` 는 부를 때마다 토큰을 굴린다 — 토큰을 키로
    쓰면 이용권 갱신 한 번에 **표가 통째로 무효**가 된다. 키는 **계정 + 로그인 한 번**이다
    (같은 계정으로 로그아웃→재로그인하면 창이 비워져야 한다 — 계정 id 만으로는 못 가르는
    쪽은 세션 세대를 함께 넣는다).
  - **실패했거나 반쪽인 갱신은 창을 열지 않는다** — 다음 진입이 곧바로 다시 받는다. 그래서
    '건너뛰기 표' 를 갱신 **전에** 적지 않는다. 먼저 적으면 실패한 뒤 60초 동안 재시도가 막힌다.
    도는 동안의 중복을 막으려고 먼저 적는 표(알람 탭 동기화)는, 회차가 **완결되지 않으면
    자기가 적은 칸을 지운다**(오프라인·저장소 로드 전·탭을 떠나 취소 — 놓친 가족 알람을
    따라잡는 자리다).
  - 창에 적는 진입·시각은 **요청을 보낼 때의 것**이다. 응답이 백그라운드를 건너 다음 진입에
    도착했을 때의 값을 적으면, 떠나 있는 동안 받은 옛 답이 돌아온 진입의 창을 연다.
  - 앱에 다시 들어오면(백그라운드를 거쳐) 창은 닫힌다.
- **쓰기 뒤 갱신** — 코드 등록·나가기·해지·구매·복원·목소리 삭제. 창을 무시한다.
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

**이용권 새로고침의 조회는 한꺼번에 보낸다**(2026-09-29 효율 감사 M7). 가족 그룹·구독·공유 코드·
`/auth/me` 넷은 서로의 결과를 입력으로 쓰지 않는다 — 차례로 기다리면 목소리 탭·이용권·가족 알람·
`plan_changed` 가 왕복 세 번을 기다린다(안드로이드는 처음부터 `async` 로 나란히 보낸다).
- **보내는 것만 한꺼번이다.** 받은 것을 쓰는 순서(그룹 → 구독·공유 코드 → plan·토큰)와 가드(계정·
  갱신 세대·결제 전 조회 수위·권한 스냅샷의 문)는 그대로다. 앞 단계의 가드에서 물러나면 떠 있던
  나머지는 취소되고 답은 쓰지 않는다.
- 결제 전 조회 수위와 계정 요청 표(순번·진입)는 **보내기 전에** 뜬다 — 구독 읽기와 `/auth/me` 가 맨
  처음에 출발하므로, 그 뒤에 성공한 결제 전 조회·뒤에 보낸 계정 요청의 답을 이 회차가 되돌리지 못한다.
- 구독·공유 코드 조회가 실패하면 `/auth/me` 의 답은 **세션의 plan·프로모와 이 진입의 결과로만** 쓴다 —
  이미 나간 계정 요청의 결과를 버리면 이 진입의 첫 결과가 비어, 뒤에 오는 응답이 세션 한가운데서 종료
  안내를 판정한다(D11, 코덱스 #827). 권한 스냅샷에는 쓰지 않고(구독 없는 반쪽 스냅샷 금지) 토큰도
  굴리지 않는다 — 무상태 JWT 라 지금 토큰이 그대로 유효하다([`session-and-auth.md`](session-and-auth.md)).

## 구현 지도

| 규칙 | Android | iOS | 백엔드 |
| --- | --- | --- | --- |
| 세 상태 열거 | `VoiceGateReason` (`ui/editor/AlarmEditorScreen.kt`) | `PlanAccess` (`Views/Editor/AlarmEditorSheet.swift`) | — |
| 게이트 표시 | `PlanGateDialog` (`ui/components/PlanGateDialog.kt`) | `showVoicePlanLockedAlert` (`AlarmEditorSheet.swift`) | — |
| 유료 판정 — **유일 출처** | `resolvePaidVoiceAccess` (`ui/util/PlatformAndLabelUtils.kt`) | `PaidVoiceGate.resolve` | `isPaidVoicePlan` |
| 판정 소비 — 표시·게이트 | `MainViewModel.isPaidVoiceEntitledOptimistic` · 커플·가족은 `hasCoupleOrFamilyAccess`(기간 한정 개인 플랜 중 보류 규칙 `MainViewModel.personalPromoTierHold` — `billing-lifecycle.md` D9) | `PlanTier.bestKnown`(보류면 남은 행으로 등급을 올리지 않는다 — 기간 중에는 `bestKnown(user:)`) · 그룹으로 여는 자리는 `PlanTier.personalPromoHoldActive`(D9) | — |
| 판정 소비 — 되돌릴 수 없는 잠금 | `MainViewModel.isDefinitelyFreePlan` · 갈래 `foregroundPlanLockAction` · 낡은 프로모 갈래는 이번 진입의 plan 반영 뒤에만(`freePlanLockMayApply` → `WaitForEntryPlan`, 재확인 `deferredPromoLapseLockDue` — `billing-lifecycle.md` D12) | `AlarmTalkApp.applyFreePlanVoiceLockIfNeeded` · 낡은 프로모 갈래는 이번 진입의 plan 반영 뒤에만(`PaidVoiceGate.freePlanLockMayApply`·`isFreeOnlyByPromoLapse`, `AuthViewModel.planAnsweredEntry`, 재확인 `promoLapseLockWaitKey` — D12) | — |
| 기간 한정 개인 플랜 — 낡은 캐시만 무료로(D1·D7: 받은 시각 = `computed_at`, 없으면 끝 전의 답) | `personalPromoLapsed`·`planAnswerStampMillis`(`ui/billing/PersonalPromo.kt`) | `PersonalPromo.isStale`·`PersonalPromo.fetchedAt` | `personalPromoField` 의 `computed_at` |
| 코드 등록(선물·초대) | `CodeRedeemField` → `POST /api/code/register` | 같은 라우트 | `routes/code.ts` → `voucher-redemption.ts` |
| 구독 조회 | `subscriptionResponse` | `socialFeatures.subscription` | `routes/billing-query.ts` |
| 진입 갱신 — 목소리·이용권(완결된 갱신만 · 60초 · 같은 계정·같은 앱 진입 · 보낼 때 적는다) | `ui/app/AlarmTalkApp.kt` 의 `lastTabRefreshAt`(키는 `tab to sessionEffectKey` — 계정 + 세션 세대라 규칙과 같다. ⚠ 표를 갱신 **전에** 적는다 — 실패 뒤 재시도 규칙은 아직 다르다) | `EntryRefreshFreshness` · `SocialFeatureViewModel.refreshOnEntry` · `VoiceStudioViewModel.refreshOnEntry` — 부르는 자리 `MainTabsView.refreshForSelectedTab`(목소리·더보기)·`MainTabsView.refreshAll`·`AlarmEditorSheet`·`MemberManagementView`·`BillingPanel` | — |
| 알람 탭 동기화 스로틀(키 = 탭 + 계정 — 토큰 아님 · 완결되지 않은 회차는 칸을 지운다) | 같은 `lastTabRefreshAt`(`tab to sessionEffectKey` — ⚠ 실패해도 칸을 지우지 않는다) | `MainTabsView.tabRefreshThrottleKey` · `AlarmTabSyncThrottle`(완결 판정은 `RemoteAlarmSyncViewModel.runFullSync` 의 반환값. 재로그인은 `MainTabsView` 가 새로 만들어져 표가 비워진다) | — |
| 쓰기·푸시 뒤 이용권 + plan(`/auth/me` 한 번 — 끝까지 못 가면 사용자 새로고침) | — | `SocialFeatureViewModel.refreshAllThenUserIfIncomplete` — 부르는 자리 `plan_changed`(`AlarmTalkApp` 의 `onPlanChanged`)·`BillingPanel` 의 구매·복원·구독 관리 시트 닫힘 | — |
| 이용권 새로고침의 조회는 한꺼번에(쓰는 순서·가드는 그대로 · 수위·계정 표는 보내기 전에) | `MainViewModelBillingActions.refreshShareCodeData`·`MainViewModelSocialActions` 의 `async` | `SocialFeatureViewModel.refreshAll`(`async let`); 회귀 `EntryRefreshFreshnessTests`(네 조회가 한꺼번에·표는 보내기 전에·구독 실패에도 계정 답을 이 진입의 결과로) | — |

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

**코드 입력(선물·초대)은 남는다** — 전부 `POST /api/code/register` 한 라우트로 간다:

| 입구 | Android | iOS |
| --- | --- | --- |
| 더보기(가족·연결 화면)의 코드 등록 | `FamilyConnectionPanel` 의 `CodeRedeemField` | `PeoplePanel` 의 `CodeRegisterRow` |
| 이용권 게이트의 '선물·초대 코드가 있어요'(§2 — 로그인 + 무료에서만) | `PlanGateDialog` | `AlarmEditorSheet`·`VoiceProfileManagementPanel` → `RedeemCodeSheet` |

## 프로모 코드 — **폐지** (2026-10-12)

운영자가 만든 문자열 코드(`promo_codes`)로 유료 이용권을 주던 기능을 **서버·두 앱에서 지웠다.**
iOS 1.2.11(빌드 8)이 App Store 심사 지침 **3.1.1**("인앱 결제가 아닌 수단으로 기능을 열면 안 된다 —
프로모 코드로 유료 기능을 연다")로 반려됐다. 운영 중인 프로모 코드는 그때 이미 0개였다(웰컴 그룹
3개는 #121 로 꺼져 있었다).

- **서버가 받지 않는 것이 실질 차단이다.** 앱 문구만 지우면 이미 깔린 옛 앱('프로모션 코드' 문구가
  남은 버전)으로 계속 열린다. `POST /code/register` 는 INV-/GIFT- 형식이 아니면 조회 없이
  `CODE_NOT_FOUND` 이고, 옛 경로 `POST /billing/promo/redeem` 은 라우트째 지웠다(404).
- **문구에 '프로모션'·'쿠폰' 을 되살리지 말 것.** 코드 칸의 이름은 '초대·선물 코드' 다(양 앱 ko·en·ja).
- **이력은 남긴다.** `promo_codes`·`promo_code_redemptions` 는 지우지 않는다 — 받은 사람의 구독 근거다.
  관리자 콘솔(`/admin/promo`)은 그 이력을 **읽기만** 한다. 발급·켜기 라우트는 지웠다 — 만들어도 아무도
  쓸 수 없는 코드가 생길 뿐이라서다.
- 프로모 갈래의 에러 코드(`ACTIVE_SUBSCRIPTION_EXISTS`·`CODE_EXHAUSTED`·`CODE_GROUP_ALREADY_REDEEMED`·
  `CODE_INACTIVE`·`CODE_MISCONFIGURED`·`CODE_NOT_IN_WINDOW`·`PROMO_REDEEM_FAILED`)는 목록·두 앱의
  문구 표·예상된 거절 목록에서 함께 지웠다 — 서버가 더는 내지 않는다(`error-codes.md`).
- 행사 혜택이 필요하면 **스토어의 오퍼 코드**(App Store 오퍼 코드 · Play 프로모션 코드)를 쓴다 —
  결제가 스토어를 거치므로 3.1.1 에 걸리지 않는다. 우리 서버에 코드 체계를 다시 만들지 말 것.
