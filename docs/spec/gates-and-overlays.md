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

**언제 뜨나 — 셋 다 참일 때**
1. 이 계정의 최신 계정 응답(`/auth/me`·로그인 응답의 `user`)에 `personal_promo` 가 있다.
2. 기기 시각이 `notice_from ≤ 지금 < ends_at` 이다(둘 다 서버 값 — 앱에 날짜를 두지 않는다).
3. 이 계정이 '다시 보지 않기' 를 누른 적이 없다.

**얼마나 자주**: **앱에 들어올 때마다 한 번**이다. '들어온다' = 콜드 스타트, 또는
백그라운드에서 **전경으로 돌아옴**(Android 프로세스 수명주기 ON_START, iOS `scenePhase`
`.active` 전환). 화면·탭 이동, 재구성(recomposition), 같은 진입 안의 재판정으로는 다시 뜨지
않는다. 한 진입 안에서 차단 게이트가 늦게 풀리면 **그 진입의 몫으로** 그때 뜬다.

**준비 신호 — 전부 끝난 뒤에만 판정한다**(아래 표의 신호 + 이 절)
- 세션이 있고, **이 계정의** 계정 상태 응답이 도착했다(`accountStatusChecked` /
  `/auth/me` 반영). 응답 전 기본값 `personal_promo = 없음` 을 '안내할 것 없음' 으로 읽고
  그 진입을 끝내지 말 것 — 응답이 오면 다시 판정한다(키에 넣는다).
- 최소지원버전 확인이 끝났고 강제 업데이트가 아니다(`versionChecked`).
- 동의 확인이 끝났고 동의 화면이 떠 있지 않다(`consentChecked`).
- 탈퇴 유예·목소리 받기 화면·기본 목소리 교체·**알람 권한 게이트**가 떠 있지 않다
  (`blockingGateActive` + Android `permissionGateRequest == null`). 권한 게이트는 알람 기능만
  막는 게이트지만 모달이라 겹치면 둘 다 못 읽는다.
- 강등 안내·민감 동의 같은 **다른 모달이 떠 있으면 기다렸다가** 닫힌 뒤 뜬다.

**모양**: 버튼 둘 — `다시 보지 않기` · `확인`. Android 는 `IosAlertDialog`(버튼 2개 = 가로),
iOS 는 시스템 `.alert`. 바깥 탭·뒤로가기는 `확인` 과 같다(이번 진입만 닫힘).
- `다시 보지 않기` → **계정별로 영구 저장**(키에 계정 id). 로그아웃해도 지우지 않는다 —
  같은 사람이 다시 로그인하면 또 묻지 않는다. 옛 `promo_prompted_*` 키를 재사용하지 않는다.
- 문구(ko — en·ja 는 같은 뜻으로):
  - 제목 "개인 플랜 무료 이용이 곧 끝나요"
  - 본문 "10월 31일까지 개인 플랜을 무료로 쓸 수 있어요. 11월 1일부터는 무료 플랜으로
    돌아가고, 등록한 목소리는 3일 보관 후 삭제돼요."
  - ⚠ **두 날짜는 리터럴이 아니다.** 앞의 날짜 = `ends_at − 1초`, 뒤의 날짜 = `ends_at` 를
    **기기 로케일·시간대**로 그린 월·일이다. 문자열 리소스에는 자리표시자만 둔다.

## 구현 지도

| 규칙 | Android | iOS |
| --- | --- | --- |
| 준비 신호 | `MainViewModel.consentChecked` / `versionChecked` / `accountStatusChecked` · `sync/StockReplacementStatus.kt` 의 `checkedUserId`(`AlarmTalkApp.kt` 의 `stockReplacementChecked`) | `AuthViewModel.consentStatusChecked` / `AppVersionGate.checked` · `StockReplacementStatus.isChecked(for:)`(`RootView.blockingGateActive`) |
| 차단 게이트 집합 | `AlarmTalkApp.kt` 의 `blockingGateActive` | `RootView.blockingGateActive` |
| 판정 키(재실행 트리거) | `LaunchedEffect(...)` 키 목록 | `RootView.promoGateKey`(강등 안내·종료 안내가 공유) |
| 종료 안내 — 진입 감지·'다시 보지 않기' 저장 | `AlarmTalkApp.kt` 의 종료 안내 이펙트 | `RootView` 의 종료 안내 판정 |
| 세션 정리 | `clearUserScopedRemoteState` | `AuthViewModel` 세션 정리 |

⚠ iOS 의 차단 게이트에는 **목소리 받기 화면**(`voiceSetupDone != true`)도 들어간다.
빼 두면 신규 가입 100% 에서 다운로드 화면 위에 안내가 얹혀 '다시 시도' 를 가린다.

웰컴 코드 안내(`PromoPromptStore`)는 2026-09-27 에 폐지했다 —
[`plan-gates.md`](plan-gates.md) 「웰컴 코드 안내 — 폐지」.

## 검증 방법

⚠ **느린 네트워크에서 봐야 한다.** 응답이 즉시 오면 창이 없어 버그가 안 보인다.
신규 계정으로 콜드 스타트하며, 응답 전에 오버레이가 뜨지 않는지 확인한다.
