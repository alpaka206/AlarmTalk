# 게이트와 1회성 오버레이 — 확인이 끝난 뒤에만 판단한다

> **단일 출처.** 구현이 이것과 다르면 구현이 틀린 것이다. → [README](README.md)

PR #660 에서 **같은 모양의 버그가 네 번** 나왔다(동의 → 버전 → 계정 상태 → 권한). 규약으로 고정한다.

문제의 형태: 게이트 상태(`updateRequired`·`pendingDeletion`·`needsConsent` …)는 서버 응답으로 채워지는데, **응답 전 기본값 `false` 가 '아니오' 와 구분되지 않는다.** 그 틈에 1회성 오버레이(웰컴 프로모, 첫 권한 안내)가 떠서 **소진 플래그까지 태우고**, 뒤늦게 응답이 와 차단 화면이 깔리면 그 위를 덮는다. 사용자는 본 적도 없이 잃고, 플래그는 계정/기기에 남아 앱을 업데이트해도 되살아나지 않는다.

- **소진되는 플래그를 태우는 오버레이는 관련 `checkXxx` 응답이 도착한 뒤에만 판단한다.** 현재 준비 신호 3종: `consentChecked`(`checkConsentStatus`) / `versionChecked`(`checkAppVersion`) / `accountStatusChecked`(`checkAccountStatus`). **iOS 도 같은 축이 필요하다** — `AuthViewModel.consentStatusChecked` 가 그 역할이고, 목소리 등록 폼이 이걸 봐야 응답 전에 동의 체크박스가 안 그려진 채 제출이 열리지 않는다.
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

## 구현 지도

| 규칙 | Android | iOS |
| --- | --- | --- |
| 준비 신호 | `MainViewModel.consentChecked` / `versionChecked` / `accountStatusChecked` | `AuthViewModel.consentStatusChecked` / `AppVersionGate.checked` |
| 차단 게이트 집합 | `AlarmTalkApp.kt` 의 프로모 가드 | `RootView.blockingGateActive` |
| 판정 키(재실행 트리거) | `LaunchedEffect(...)` 키 목록 | `RootView.promoGateKey` |
| 소진 플래그 | `PromoPromptStore` | `PromoPromptStore` |
| 세션 정리 | `clearUserScopedRemoteState` | `AuthViewModel` 세션 정리 |

⚠ iOS 의 차단 게이트에는 **목소리 받기 화면**(`voiceSetupDone != true`)도 들어간다.
빼 두면 신규 가입 100% 에서 다운로드 화면 위에 프로모가 얹혀 '다시 시도' 를 가린다.

## 검증 방법

⚠ **느린 네트워크에서 봐야 한다.** 응답이 즉시 오면 창이 없어 버그가 안 보인다.
신규 계정으로 콜드 스타트하며, 응답 전에 오버레이가 뜨지 않는지 확인한다.
