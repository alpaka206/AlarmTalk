# 게이트와 1회성 오버레이 — 확인이 끝난 뒤에만 판단한다

> **단일 출처.** 구현이 이것과 다르면 구현이 틀린 것이다. → [README](README.md)

PR #660 에서 **같은 모양의 버그가 네 번** 나왔다(동의 → 버전 → 계정 상태 → 권한). 규약으로 고정한다.

문제의 형태: 게이트 상태(`updateRequired`·`pendingDeletion`·`needsConsent` …)는 서버 응답으로 채워지는데, **응답 전 기본값 `false` 가 '아니오' 와 구분되지 않는다.** 그 틈에 1회성 오버레이(첫 권한 안내, 예전의 웰컴 프로모)나 반복 안내(개인 플랜 종료 안내)가 떠서 **소진 플래그까지 태우고**, 뒤늦게 응답이 와 차단 화면이 깔리면 그 위를 덮는다. 사용자는 본 적도 없이 잃고, 플래그는 계정/기기에 남아 앱을 업데이트해도 되살아나지 않는다.

- **소진되는 플래그를 태우는 오버레이는 관련 `checkXxx` 응답이 도착한 뒤에만 판단한다.** 현재 준비 신호 4종: `consentChecked`(`checkConsentStatus`) / `versionChecked`(`checkAppVersion`) / `accountStatusChecked`(`checkAccountStatus`) / **기본 목소리 교체 판정**(`StockReplacementStatus.checkedUserId` — 2026-09-03 리뷰 21차에 양 앱 모두 추가). **iOS 도 같은 축이 필요하다** — `AuthViewModel.consentStatusChecked` 가 그 역할이고, 목소리 등록 폼이 이걸 봐야 응답 전에 동의 체크박스가 안 그려진 채 제출이 열리지 않는다.
- **준비 신호는 성공·실패 모두 `true`.** 못 물어본 것이 앱을 못 쓰게 할 이유는 아니다 — 네트워크 실패로 영영 `false` 면 그 오버레이는 영영 안 뜬다.
- **가드만 넣지 말고 `LaunchedEffect` 키에도 넣어야 한다.** 키에 없으면 응답이 도착해도 효과가 재실행되지 않아, 게이트가 풀린 뒤에도 오버레이가 안 뜬다.
- **계정별 신호는 세션 정리에서 `false` 로 되돌린다**(`clearUserScopedRemoteState` — `consentChecked`·`accountStatusChecked`). 앞 계정의 '확인 끝남' 이 새 계정에 새면 안 된다. 반면 `versionChecked` 는 앱·기기 단위라 되돌리지 않는다(계정이 바뀐다고 설치 버전이 바뀌지 않는다).
- ⚠ **되돌리는 건 세션 정리뿐이다 — 같은 계정을 재확인한다고 `false` 로 내리지 말 것.** `checkConsentStatus` 는 토큰이 바뀔 때마다 다시 도는데, 그때 내리면 이미 홈을 쓰던 화면이 로딩 게이트로 덮인다. 그 화면은 뒤로가기를 삼키므로 **그 동안 앱이 안 닫힌다**(2026-08-05 재현). 그래서 판정은 `consentStatusChecked`(이 계정 응답을 실제로 받았나)로 하고, 캐시(`isConsentCachedDone`)로 하지 않는다 — 받을 게 남은 계정은 완료 캐시가 영영 안 만들어져 매번 다시 덮인다.
- **로딩 게이트에는 `GateBackGuard` 를 두지 않는다.** 그 가드는 *화면에 정식 선택지가 있어서* 실수로 나가는 걸 막는 장치다. 응답을 기다리는 로딩 화면에는 지킬 선택지가 없고, 삼키면 네트워크가 느릴 때 뒤로가기가 죽은 것처럼 보인다.

## 지금 있는 준비 신호

| 신호 | 무엇을 기다리나 | 세션 정리에서 되돌리나 |
| --- | --- | --- |
| `consentChecked` / `consentStatusChecked` | 동의 상태 응답 | **되돌린다**(계정별) |
| `accountStatusChecked` | `/auth/me` 응답 | **되돌린다**(계정별) |
| `versionChecked` / `AppVersionGate.checked` | 최소지원버전 정책 | 되돌리지 않는다(앱·기기 단위) |
| `stockReplacementChecked` / `stockReplacement.isChecked(for:)` | 기본 목소리 교체가 미완인지 판정 | **계정 id 를 들고 비교한다**(전역 Bool 이면 A 의 확인이 B 에 샌다). 실패한 시도도 '끝났다' 로 센다 |

## 개인 플랜 종료 안내 — **들어올 때마다**, 준비가 끝난 뒤에만 (2026-09-27)

기간 한정 개인 플랜([`billing-lifecycle.md`](billing-lifecycle.md) 「기간 한정 개인 플랜」)이
끝나기 전에 알린다. 약관 제10조의 '무료 전환으로 지워지는 데이터는 전환 전에 앱 안에서
안내한다' 를 지키는 자리다. 1회성이 아니라 **반복** 안내라 소진 플래그는 없지만, 차단
게이트 위에 겹치거나 옛 값으로 뜨는 사고는 같은 모양이라 같은 규약을 따른다.
두 앱이 **똑같이** 구현한다(아래 전부 — 스펙의 D3·D4·D11).

**언제 뜨나 — 셋 다 참일 때**
1. **이번 진입에서 새로 받은** 이 계정의 계정 응답(`/auth/me`, 로그인으로 들어온 진입이면 그
   로그인·가입 응답의 `user`)에 `personal_promo` 가 있다. 두 앱 모두 로그인·가입(구글 포함) **성공**
   응답을 이번 진입의 답으로 적는다(안드로이드 `recordSignInAnswer`, iOS `recordAccountAnswer`) — 뒤이은
   `checkAccountStatus`·`refreshUser` 는 더 옛 순번이 되어 버려진다. 로그인·가입 **실패**는 진입 결과가
   아니다 — 계정이 아직 없고, 같은 진입에서 다시 시도해 성공하면 그게 첫 결과여야 한다.
2. 기기 시각이 `notice_from ≤ 지금 < ends_at` 이다(둘 다 서버 값 — 앱에 날짜를 두지 않는다).
3. 이 계정이 **이 `ends_at` 에** '다시 보지 않기' 를 누른 적이 없다.

**'들어온다' = 콜드 스타트, 또는 백그라운드에서 전경으로 돌아옴 — 이것뿐이다.**
- Android: 프로세스 수명주기 `ON_START`(`AppSignals.appEntries`).
- iOS: `scenePhase` 가 **`.background` → `.active`** 로 바뀔 때(콜드 스타트의 첫 활성 포함). ⚠
  **`.inactive` → `.active` 는 진입이 아니다** — 제어 센터·알림 센터·시스템 알럿(권한 요청 포함)·
  Face ID·전화 배너를 닫을 때마다 그렇게 바뀐다. `.active` 전환만 보면 그때마다 안내가 다시
  뜬다(리뷰). ⚠ **진입은 한 곳에서만 센다** — 앱 장면의 `scenePhase`(`AlarmTalkApp` →
  `AppEntrySignal.shared`)가 유일한 출처이고 화면(`RootView`)은 읽기만 한다. 둘이 따로 세면 한
  번의 복귀가 두 진입이 되어, 복귀의 `/auth/me` 가 앞 번호로 찍혀 '이 진입의 답' 이 영영 오지 않는다.
- 화면·탭 이동, 재구성(recomposition), 같은 진입 안의 재판정으로는 다시 뜨지 않는다.

**판정 시점 — 이번 진입의 계정 응답이 온 뒤에만**
- 백그라운드에서 돌아오면 세션에는 **지난번** `personal_promo` 가 남아 있다. 그 값으로 판정하면
  다른 기기에서 결제·쿠폰 등록을 마친 사람에게 "무료 이용이 곧 끝나요" 가 뜬다. 그래서 **이번
  진입의 `/auth/me`(또는 같은 값을 주는 계정 응답)가 도착한 뒤에만** 판정한다 — 진입마다 새로
  세우는 '이번 진입의 계정 응답' 신호가 준비 신호다(계정 단위 `accountStatusChecked` 는 진입마다
  다시 세워지지 않아 이 역할을 못 한다).
- 그 응답이 **실패**하면 이번 진입은 띄우지 않는다(옛 값으로 판정하지 않는다). 반복 안내라
  다음 진입이 다시 판정한다 — 준비 신호의 '실패도 도착' 원칙과 다르게 두는 이유는, 이 안내는
  빠뜨려도 다음 진입이 있지만 틀린 안내는 되돌릴 수 없어서다.
  - **D11 — 이 진입의 첫 결과가 이 진입을 끝낸다(성공이든 실패든, 두 앱 같은 규칙).** 이번 진입에
    보낸 계정 요청의 결과 중 **먼저 도착한 것** 하나가 이 진입의 판정을 정한다. 실패가 먼저면 같은
    진입에 뒤따라 오는 성공 응답(쿠폰·결제 뒤의 재조회, `plan_changed` 신호, 결제 권한 재확인,
    iOS 의 `.inactive → .active` 새로고침)으로 다시 판정하지 않는다 — 그러면 세션 한가운데서 안내가
    뜬다(리뷰). 두 앱 모두 진입의 결과를 **첫 것만** 적는 같은 모양(`AccountEntryAnswer` — 안드로이드
    `Answered`·`Failed`, iOS `answered`·`failed`)을 쓰고, 실패로 끝난 진입은
    `PersonalPromoNoticeDecision.NothingToShow` / `PersonalPromoNotice.Decision.nothingToShow` 와 같다.
    - '계정 요청' = 이 계정의 plan·`personal_promo` 를 싣는 요청이다 — 보내기 직전에 표(아래
      `beginAccountRequest`)를 뜨고, 성공과 실패를 **둘 다** 이 진입의 결과로 적는다. 안드로이드:
      `checkAccountStatus`·`refreshAppSessionNow` 의 `/auth/me`(성공 `recordAccountAnswer`, 실패
      `recordAccountFailure`)와 로그인·가입의 성공 응답(`recordSignInAnswer`). iOS: `refreshUser` 의
      `/auth/me`·로그인·가입의 성공 응답, 세션 밖의
      `SocialFeatureViewModel` `/auth/me`·결제 전 조회(`refresh_store=1` — iOS 는 이 응답의 `user_plan`
      도 세션에 쓴다; 성공 `applyFreshPlan`, 실패 `onAccountRequestFailed` →
      `AuthViewModel.noteAccountRequestFailure`). iOS 의 조용한 구독 조회는 표를 뜨지만 plan 을 싣지
      않아 계정 요청이 아니다 — 결과로 세지 않는다.
    - **세션이 끝나는 실패**(401·파기된 계정의 404)와 **계정이 바뀐 뒤·로그아웃 중**의 실패는 이 계정의
      진입 결과가 아니다 — 적지 않거나(iOS `refreshUser`·로그인·가입, 안드로이드의 404·계정 전환·
      로그아웃 중), 적혀도 곧 세션 정리가 진입 기록을 지운다(안드로이드 401 — 인증기가 세션을 정리하고,
      정리가 먼저 끝났으면 앞지른 순번이 그 실패를 버린다. iOS 세션 밖 `SocialFeatureViewModel` 의
      401·404 — `handleUnauthorized` 가 뒤이어 로그아웃하며 지운다). 옛 순번(더 새 답이 이미 적힌 요청·계정 전환 전에 뜬 요청)의
      실패도 버린다.
    - 안내만 끝난다 — 같은 진입의 뒤 성공은 '가장 최근 계정 응답'(떠 있는 안내 맞추기)과 plan 반영
      (전경 잠금의 기다림 — [`billing-lifecycle.md`](billing-lifecycle.md) D12)으로는 그대로 쓴다.
  - **결과는 어느 경로로 반영되든, 버려지든 적는다.** 이번 진입에 보낸 요청의 답이 세션 밖 경로로
    반영되거나(iOS `SocialFeatureViewModel` 의 `/auth/me` → `applyFreshPlan(…request:)` — 순번에 밀려
    짝을 쓰지 않아도), 이 계정의 토큰이 그 사이 굴러 응답 본문을 버리는 경우에도(iOS
    `refreshUserApplyingToken` 의 `isTokenRolledWithinSignIn` — 성공이면 짝을 반영하고 적고, 실패면
    실패로 적는다) **이 진입의 결과**는 적는다 — 안 적으면 진입이 '대기' 로 남아, 같은 진입의 나중
    응답이 첫 결과가 되어 세션 한가운데서 판정한다(리뷰). 안드로이드는 세션을 세대로 가르므로
    (`saveSessionIfAlive`) 토큰이 굴러도 응답이 버려지지 않는다.
- **'이번 진입의 응답' = 이번 진입에 보낸 요청이 이번 진입에 도착한 것.** 앞 진입에 보낸 요청이
  백그라운드를 건너 늦게 도착한 것은 세지 않는다(그 사이 다른 기기에서 결제했을 수 있다). 순서가
  뒤집혀 늦게 온 옛 요청의 응답은 새 응답을 덮지 않는다.
  - 요청을 **보내기 직전에** 표(보낸 진입·순번)를 뜨고 응답까지 들고 간다 — 안드로이드
    `beginAccountRequest` → `AccountRequest`(`PersonalPromoLedger`), iOS
    `AuthViewModel.beginAccountRequest` → `AuthViewModel.AccountRequest`. 도착했을 때의 진입이 보낸
    진입과 같을 때만 그 진입의 답이다(안드로이드 `accountAnswerEntryFor`, iOS
    `AppEntryCounter.entryForRequest` — 백그라운드에서 보낸 요청은 어느 진입의 답도 아니다).
  - 옛 순번의 응답은 버린다 — 안내 판정뿐 아니라 **plan·프로모 쓰기**(세션 plan · 판정 스냅샷의
    plan 과 프로모 표지 · 이번 진입의 plan 반영 표시)에서도 두 앱 모두. 안드로이드: 안내는
    `PersonalPromoLedger.recordAccountAnswer`(결과 `Boolean` 을 부르는 쪽이 쓴다), plan 쓰기는 쓰기 전에
    `PersonalPromoLedger.claimPlanAnswer`(plan 순번은 따로 — `checkAccountStatus` 는 plan 을 쓰지
    않는다), plan 반영 표시는 `recordPlanApplied`(밀린 요청을 다시 거른다). iOS:
    `AuthViewModel.applyFreshPlan(…request:)` 과 `refreshUserApplyingToken` 이 한 순번으로 가른다. 더 새
    답이 이미 반영됐으면 그 plan·프로모 짝을 지킨다 — 탈퇴 유예는 그대로 반영한다. 규칙 전문은
    [`billing-lifecycle.md`](billing-lifecycle.md) 「앱」의 순번 가드.
  - 세션 밖에서 계정 답을 받는 경로(iOS `SocialFeatureViewModel` 의 `/auth/me`·결제 전 조회)도 같은
    표를 받는다(`SocialFeatureViewModel.beginAccountRequest` → `onFreshPlan`·`onAccountRequestFailed`).
  - 계정이 바뀌면(세션 정리) 진입 기록을 지우고 떠 있던 요청의 순번을 앞지른다 — 앞 계정의 응답이
    새 계정의 판정이 되지 않게(안드로이드 `PersonalPromoLedger.resetForAccountSwitch`, iOS
    `AuthViewModel.signOut` — 같은 계정으로 다시 로그인해도 로그아웃 전에 뜬 표는 `signedOutRequestSeq`
    로 가른다).
- **판정은 진입마다 한 번이다.** 이번 진입의 응답으로 판정해 **띄울 것이 없으면**(프로모 없음·기간
  밖·'다시 보지 않기') 이번 진입은 그걸로 끝난다 — 같은 진입의 뒤 계정 응답(`plan_changed`·결제
  신호·iOS 의 `.inactive → .active` 새로고침 등)으로 다시 판정하지 않는다. 안 그러면 제어 센터를
  닫거나 결제 신호가 온 순간 안내가 세션 한가운데 튀어나온다(리뷰). 안드로이드
  `PersonalPromoNoticeDecision.NothingToShow` 가 원본이다. **예외는 '띄우려다 다른 창에 막힌'
  경우뿐이다**(아래 — 그 창이 닫히면 같은 진입에서 뜬다).
- 문구의 "등록한 목소리는 3일 보관 후 삭제돼요" 는 서버가 지킨다 — 종료 전환의 `delete_after` 는
  끝 + 3일보다 **이르지 않다**([`billing-lifecycle.md`](billing-lifecycle.md) 「종료」, D6).

**다른 창 위에 띄우지 않는다 — 기다렸다가, 막히면 버린다**
- 판정이 참이어도 **다른 모달·다이얼로그·시트·전체화면 커버·시스템 권한 요청**이 떠 있으면
  띄우지 않고 **대기**한다. 대기 중인 안내는 그 창이 닫히면 뜬다(같은 진입 안에서).
  - 차단 게이트(강제 업데이트·동의·탈퇴 유예·목소리 받기 화면·기본 목소리 교체·알람 권한
    게이트)와 다른 모달(강등 안내·민감 동의·목소리 등록 창·쿠폰 입력 시트·편집기 시트 등)이 다
    여기 든다. 앱 밖 화면(문서 선택기·설정·브라우저)에서 돌아온 것도 진입이므로, 돌아온 자리에
    열려 있던 창이 먼저다.
  - iOS 는 첫 알림 권한 요청이 메인 탭이 뜨는 순간 함께 나가므로, 그 요청이 끝난 뒤에 판정한다.
  - ⚠ **안드로이드는 '다른 창이 떠 있다' 를 창이 스스로 적는다**(`TrackOpenModal()` →
    `OpenModalRegistry`). 껍데기(`IosAlertDialog`·`WakerSelectionSheet`·`WakerFormSheet`)는 이미
    부른다. **`Dialog`·`ModalBottomSheet` 를 직접 새로 만들면 그 안에서 `TrackOpenModal()` 을 불러야
    한다** — 빠뜨리면 그 창 위로 진입 안내가 겹쳐 뜬다(CLAUDE.md 에도 같은 규칙).
- ⚠ **대기가 걸린 채로 남으면 안 된다.** 대기 중인 안내가 다른 안내(강등 안내 등)를 막거나,
  보이지 않는 채 '띄운 것' 으로 남아 다음 진입의 안내까지 삼키면 안 된다. 이번 진입에 띄우지
  못하고 진입이 끝나면(앱이 다시 백그라운드로 가면) 대기를 **지우고** 다음 진입에 다시
  판정한다. '이번 진입에 띄웠다' 는 표시는 **실제로 화면에 나온 뒤에만** 남긴다.
  - 안드로이드: 떠 있는 안내 위로 다른 창·게이트·권한 창이 올라오면 안내를 걷고 이 진입을 '판정
    전' 으로 되돌린다(`PersonalPromoLedger.evaluateEndNotice` → `deferEndNotice`) — 가린 것이 닫히면 같은
    진입에서 다시 뜬다.
  - iOS: `show` 판정은 진입을 끝내지 않는다. 표시(`marker`)는 알럿이 **화면에 보인 것을 확인한 뒤**
    (`RootView.verifyShownNoticeIsVisible`) 또는 사용자가 닫을 때(`RootView.closePersonalPromoNotice`)
    적는다. SwiftUI 가 같은 프레임의 다른 시트 때문에 알럿을 조용히 건너뛰면 표시 없이 걷어, 그 창이
    닫힌 뒤 같은 진입에서 다시 뜬다. 한 진입에서 **세 번**(`maxUnseenPromoNotices`) 보이지 않으면
    그 진입은 포기한다(감지가 빗나가도 1초마다 깜빡이지 않게 — `noteUnseenPromoNotice`).
- 떠 있는 안내는 **새 계정 응답에 맞춘다** — 같은 종료 시각이면 새 값(삭제 문장 갈래가 바뀌었을 수
  있다), 프로모가 사라졌거나(결제·쿠폰) 끝났거나 종료 시각이 바뀌었으면 닫는다(안드로이드
  `reconcileShownPersonalPromoNotice`, iOS `PersonalPromoNotice.reconcileShown`).

**모양**: 버튼 둘 — `다시 보지 않기` · `확인`. Android 는 `IosAlertDialog`(버튼 2개 = 가로),
iOS 는 시스템 `.alert`. 바깥 탭·뒤로가기는 `확인` 과 같다(이번 진입만 닫힘). **아이콘은 없다**
(양 앱 — 이용권 화면의 프로모 문구도 같다).
- `다시 보지 않기` → **계정별 + 그 `ends_at` 별로** 저장(키에 계정 id, 값에 `ends_at`). 서버가
  기간을 늘려 `ends_at` 이 바뀌면 새 종료를 한 번 더 알린다 — 사용자가 끈 것은 "이 종료 안내" 다.
  로그아웃해도 지우지 않는다 — 같은 사람이 다시 로그인하면 또 묻지 않는다. 옛
  `promo_prompted_*` 키를 재사용하지 않는다.
- 문구(안드로이드 리소스가 원본, iOS 카탈로그는 ko·en·ja 모두 **글자까지** 같게):

| | 제목 | 본문(`deletes_voices_at_end = true`) | 본문(`false` — 삭제 문장을 뺀다) |
| --- | --- | --- | --- |
| ko | 개인 플랜 무료 이용이 곧 끝나요 | {lastDay}까지 개인 플랜을 무료로 쓸 수 있어요. {nextDay}부터는 무료 플랜으로 돌아가고, 등록한 목소리는 3일 보관 후 삭제돼요. | {lastDay}까지 개인 플랜을 무료로 쓸 수 있어요. {nextDay}부터는 무료 플랜으로 돌아가요. |
| en | Your free Personal plan ends soon | You can use the Personal plan for free until {lastDay}. From {nextDay}, you'll return to the Free plan, and voices you registered will be kept for 3 days and then deleted. | You can use the Personal plan for free until {lastDay}. From {nextDay}, you'll return to the Free plan. |
| ja | パーソナルプランの無料利用がまもなく終了します | {lastDay}までパーソナルプランを無料でご利用いただけます。{nextDay}からは無料プランに戻り、登録した声は3日間保管した後に削除されます。 | {lastDay}までパーソナルプランを無料でご利用いただけます。{nextDay}からは無料プランに戻ります。 |

  - 버튼: ko `다시 보지 않기` · `확인` / en `Don't show again` · `Confirm` / ja `今後表示しない` ·
    `確認`(확인은 안드로이드 `auth_confirm` 과 같은 문구).
  - ⚠ **두 날짜는 리터럴이 아니다.** `lastDay` = `ends_at − 1초` 를 **기기 시간대**의 날짜로,
    `nextDay` = `lastDay` 의 **다음 달력일**. 둘 다 기기 로케일의 월·일이다. `nextDay` 를 `ends_at`
    의 날짜로 그리면 한국이 아닌 시간대에서 두 날짜가 같은 날로 읽힌다("10월 31일까지 … 10월
    31일부터"). 문자열 리소스에는 자리표시자만 둔다.
  - `deletes_voices_at_end` 가 `false` 인 사람(결제 보류 — `active` 구독 행이 남아 있다)은 끝에
    목소리가 삭제 예약되지 않는다. 그 문장을 보여 주면 틀린 삭제 예고다. 키가 없으면(구서버)
    `true` 로 읽는다 — 예전 안내 그대로다.

## 구현 지도

| 규칙 | Android | iOS |
| --- | --- | --- |
| 준비 신호 | `MainViewModel.consentChecked` / `versionChecked` / `accountStatusChecked` · `sync/StockReplacementStatus.kt` 의 `checkedUserId`(`AlarmTalkApp.kt` 의 `stockReplacementChecked`) | `AuthViewModel.consentStatusChecked` / `AppVersionGate.checked` · `StockReplacementStatus.isChecked(for:)`(`RootView.blockingGateActive`) |
| 차단 게이트 집합 | `AlarmTalkApp.kt` 의 `blockingGateActive` | `RootView.blockingGateActive` |
| 판정 키(재실행 트리거) | `LaunchedEffect(...)` 키 목록 | `RootView.promoGateKey`(강등 안내·종료 안내가 공유) |
| 종료 안내 — 진입 감지 | `core/AppSignals.kt` `AppSignals.appEntries`(`ON_START`) · `personalPromoNoticePendingForEntry` | `PersonalPromoNotice.swift` `AppEntrySignal`(`AlarmTalkApp` 의 `scenePhase` 한 곳이 센다) · `AppEntryCounter`(`.background` → `.active` 만) |
| 종료 안내 — 이번 진입의 계정 응답(보낸 진입 = 도착 진입 · 첫 결과만 — D11 · 옛 순번 버림) | `ui/billing/PersonalPromoLedger.kt` `AccountRequest` · `PersonalPromoLedger.beginAccountRequest`·`recordAccountAnswer`(결과 `Boolean`)·`recordAccountFailure`·`accountEntryAnswer`·`latestAccountPromo` · plan 쓰기 순번 `PersonalPromoLedger.claimPlanAnswer`·`recordPlanApplied` · `ui/billing/PersonalPromo.kt` `AccountEntryAnswer`(`Outcome` — `Answered`·`Failed`)·`accountAnswerEntryFor` · 부르는 자리 `MainViewModelAuthActions` 의 `checkAccountStatus`·`refreshAppSessionNow`(성공·실패 모두 — `MainViewModel` 이 `recordAccountAnswer`·`recordAccountFailure`·`accountEntryAnswer` 로 위임) | `AuthViewModel.beginAccountRequest`·`AuthViewModel.AccountRequest`·`accountEntryAnswer`(`AccountEntryAnswer` — 첫 결과만)·`appEntryState`·`applyFreshPlan(userID:from:plan:personalPromo:request:)`(진입 결과를 적는다 — 밀린 답도)·`noteAccountRequestFailure`(세션 밖 요청의 실패) · `refreshUserApplyingToken` 의 토큰만 구른 답(`isTokenRolledWithinSignIn` — 성공·실패 모두 적는다) · `AppEntryCounter.entryForRequest` · `PersonalPromoNotice.entryAnswer(_:entry:)`·`PersonalPromoNotice.EntryAnswer` · `SocialFeatureViewModel.beginAccountRequest`·`onFreshPlan`·`onAccountRequestFailed`(`refreshAll` 의 `/auth/me`·결제 전 조회) |
| 종료 안내 — 판정·준비 신호·다른 창 | `AlarmTalkApp.kt` 의 종료 안내 이펙트(게이트를 모아 넘기기만 한다) · `ui/billing/PersonalPromo.kt` `PersonalPromoNoticeGates`·`decidePersonalPromoEndNotice`(`entryAnswer` 를 받는다 — `PersonalPromoNoticeDecision` — `NotNow`·`NothingToShow`·`Show`)·`reconcileShownPersonalPromoNotice` · `MainViewModel.evaluatePersonalPromoEndNotice` → `PersonalPromoLedger.evaluateEndNotice`(막혔으면 `deferEndNotice`, 열렸으면 `maybeShowEndNotice`) · `MainViewModel.personalPromoEndNotice` · 다른 창: `ui/components/OpenModalRegistry.kt` `TrackOpenModal`·`OpenModalRegistry`(강제 `scripts/check-open-modal-tracking.py`) | `RootView.runOverlayNotices`·`verifyShownNoticeIsVisible`·`noteUnseenPromoNotice`(`maxUnseenPromoNotices`) · `PersonalPromoNotice.decide`(`PersonalPromoNotice.Decision` — `skip`·`nothingToShow`·`wait`·`show`)·`shouldShow`·`reconcileShown` · 다른 창: `ForegroundModalState.swift` `ModalPresentationProbe`·`SystemPermissionPrompts` |
| 종료 안내 — 기간·날짜(`lastDay`·`nextDay`) | `ui/billing/PersonalPromo.kt` `isPersonalPromoEndNoticeDue` · `personalPromoLastDay`·`personalPromoFreeFromDay` · `formatPersonalPromoDay` | `PersonalPromoNotice.dayLabels` · `PersonalPromo.dayLabel`·`lastFreeDate`·`isInEndNoticeWindow` |
| 종료 안내 — '다시 보지 않기'(계정 + `ends_at`) | `PersonalPromoNoticeStore`(`ui/billing/PersonalPromo.kt`) · `MainViewModel.dismissPersonalPromoEndNotice`(`PersonalPromoLedger.dismissEndNotice`) | `PersonalPromoNoticeStore`(`PersonalPromoNotice.swift`) · `RootView.closePersonalPromoNotice` |
| 종료 안내 — 문구(삭제 문장 갈래) | `res/values*/strings.xml` `personal_promo_end_notice_*` · 확인 `auth_confirm` · `personalPromoDeletesVoicesAtEnd` | `Localizable.xcstrings`(ko·en·ja) · `PersonalPromo.deletesVoicesAtEnd` |
| 종료 안내 — 회귀 테스트 | `PersonalPromoNoticeTest`(첫 결과 실패 → `NothingToShow`) · `PersonalPromoLedgerTest`(옛 순번 버림·계정 전환·다른 창에 밀린 안내·띄울 것 없음으로 진입 끝·앞 진입 응답·**첫 결과 실패**·plan 순번·`evaluateEndNotice`) | `PersonalPromoTests`(진입·응답·판정) · `AuthViewModelTests`(계정 요청 표·순번·세션 밖 답과 실패·토큰만 구른 답·끝난 로그인의 답) · `BillingPreflightTests`(`test_failedAccountRequestsReportTheirTicket`) · `PersonalPromoNoticeUITests` |
| 세션 정리 | `clearUserScopedRemoteState`(→ `PersonalPromoLedger.resetForAccountSwitch` — 진입 기록을 지우고 계정 응답·plan 두 순번을 앞지른다) | `AuthViewModel.signOut`(`accountEntryAnswer`·`planAnsweredEntry` 를 지우고 순번을 앞지른다 — `signedOutRequestSeq` 로 끝난 로그인의 표를 가른다) |

⚠ iOS 의 차단 게이트에는 **목소리 받기 화면**(`voiceSetupDone != true`)도 들어간다.
빼 두면 신규 가입 100% 에서 다운로드 화면 위에 안내가 얹혀 '다시 시도' 를 가린다.

웰컴 코드 안내(`PromoPromptStore`)는 2026-09-27 에 폐지했다 —
[`plan-gates.md`](plan-gates.md) 「웰컴 코드 안내 — 폐지」.

## 검증 방법

⚠ **느린 네트워크에서 봐야 한다.** 응답이 즉시 오면 창이 없어 버그가 안 보인다.
신규 계정으로 콜드 스타트하며, 응답 전에 오버레이가 뜨지 않는지 확인한다.
