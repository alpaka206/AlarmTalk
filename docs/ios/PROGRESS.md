# iOS 되살리기 — 진행 상황

> **보관 문서(2026-08-06):** iOS 복구 작업 당시의 스냅샷이다. 현재 출시 준비 상태는
> [`../qa/dev-test-handoff.md`](../qa/dev-test-handoff.md), 동작 계약은 [`../spec/`](../spec/README.md)를 본다.

> ⚠ **이 브랜치를 머지하면 정책버전 4→5 로 전원 재동의가 발생한다.**
> iOS 와 무관한 안드로이드 베타 사용자도 동의 게이트를 다시 본다.
> **머지 시점은 사람이 정한다.** 브랜치 안에 있는 동안은 영향 0.
> (4단계 착수 시점에 이 줄을 다시 확인할 것 — 아직 v5 로 올리지 않았다면 이 경고는 예고다.)

브랜치: `feat/ios-revive` (develop 기준) · **push 안 함** · 작은 단위 커밋

## 현재 게이트 상태 (2026-08-06, `origin/develop` 리베이스 후)

```
iOS 빌드      : ** BUILD SUCCEEDED **  (iPhone 17 Pro / iOS 26.5)
iOS 테스트    : 354 tests, 0 failures      (되살린 직후 286 중 5 실패 → 지금 354/0)
iOS 앱 실행   : 시뮬레이터 설치·기동 확인, 랜딩/로그인 렌더, 크래시 없음
백엔드 vitest : 85 files, 1333 passed | 64 skipped   (기준선 1301 → +32)
shared/voice  : 16 passed / 11 passed
npm run lint  : 0 errors, 1 warning (기존 voice-profile.ts:1392 — 새로 생긴 게 아님)
npm run typecheck : 통과
안드로이드 변경 : 0 파일  (git status --short -- apps/android-native/ → 없음)
커밋          : 39개, push 안 함
```

### 2차 채굴 결과 적용 완료 (커밋 `e5a3b088` · `6681dff7` · `34cb0831` · `94919a02` · `b0f8a2fe`)

리뷰 워크플로가 3개 축(죽은 코드 / 적용 정확성 / 권한 문구)에서 낸 지적을 전부 검토해
적용했다. **적대적 검증이 뒤집은 것 1건 포함** — 아래 「되돌린 지적」 참조.

고친 것 중 사용자에게 실제로 보이는 것:
- **pull 이 돌 때마다 날씨/운세 알람이 고정 문구로 바뀌었다.** merge 가 지키는
  '서버에 사본이 없는 값' 목록에 동적 문구 설정 13개가 빠져 있었다.
- **무료 전환이 '받은 알람' 까지 지웠다.** 발신자 구독으로 성립하는 알람이라 대상이
  아닌데 `paidAlarmTalks()` 에 origin 필터가 없었다.
- **받은 알람 알림이 신규 설치에서 100% 무음 폐기됐다.** 권한을 요청하는 코드가
  한 번도 불리지 않았다(`.notDetermined` → 게이트 false).
- **목소리 등록 실패가 성공으로 읽혔다.** 실패 문구 "2분 이하 음성으로 **등록**할 수
  있어요." 가 `contains("등록")` 에 걸려, 녹음이 사라진 채 목록으로 넘어갔다.
- **권한 없이 토글을 켜면 켜진 채 남았다**(`markFailed` 는 enabled 를 안 건드린다).
- **저장이 권한 확인 전에 TTS 를 만들어** 결국 저장되지 않을 알람에 월 한도를 썼다.
- **거부가 굳으면 홈 버튼들이 무반응이었다**(iOS 는 프롬프트를 한 번만 띄운다).

### 되돌린 지적 — 행마다 권한 경고 붙이기

처음엔 지적대로 `AlarmRow` 에 권한 경고를 넣었다가 **되돌렸다.** 적대적 검증이
안드로이드 이력을 짚었다: 86bf9d90(16:22)이 행별 경고를 넣고 **7b1a967c(16:31)가
9분 만에 되돌리며** 이유를 못 박았다 — *"권한은 알람 하나가 아니라 전부에 걸리는
문제인데 행마다 안내를 붙였다. 되돌리고 헤드라인 한 곳에서 말한다."*
실제로 `common_alarm_warning_permission_off` 는 레포에 0건이다. 살아남은 규약을
따라 **홈 히어로 헤드라인 한 곳**에서만 말한다.

⚠ 문구는 안드로이드와 **반대**다. 규칙("사실을 말한다")은 같은데 사실이 다르다 —
안드로이드는 권한이 없어도 `RingingService` 가 소리를 내지만, iOS 는
`AlarmManager.schedule` 이 던져 **예약조차 되지 않는다.** 그래서 iOS 만
"울리지 않아요" 가 참이다. 회귀 방지 테스트: `AlarmUserCopyTests`.

---

## 리뷰 이력 채굴 — 2026-08-06

iOS 스냅샷(2026-07-21) 이후 **327커밋 중 Codex 리뷰 수정이 157건**이다. 그 지적들을 다시
받는 대신 **캐내서 되살린 iOS 에 같은 문제가 있는지** 확인했다. 아울러 **내가 이번에 만든
커밋 자체도 적대적으로 재검토**했다. 아래는 그 결과 고친 것들이다.

### 🔴 내가 만든 것의 결함 (커밋 `48a3ad68`)

| | 증상 |
|---|---|
| **Apple 로그인 100% 실패 ①** | 클라가 `idToken/name/email` 을 보내는데 서버 스키마는 `identity_token/full_name` — safeParse 실패로 항상 400. 심사 자체를 못 넘는 상태였다 |
| **Apple 로그인 100% 실패 ②** | 앱은 raw nonce 를 보내는데 토큰에는 sha256(raw) 가 들어 있다. 내 서버가 그대로 비교해 항상 401. `NonceGenerator.swift` 주석이 이미 "서버는 raw 를 다시 해싱해 검증한다" 는 계약을 선언해 뒀는데 내가 어겼다 → **서버가 해싱하도록** 고침 |
| **닉네임 상한 단위 불일치** | Swift `count`(grapheme) vs 서버 `length`(UTF-16). 이모지 20개 = 앱 20(통과)/서버 40(거절) → 저장이 안 되는데 이유를 알 수 없어 갇힌다. **내가 단 주석이 정반대**였다("그 방향은 안전하다") |
| **목소리 철회가 실제로 안 걷힘** | 로컬 행만 고치고 AlarmKit 예약을 그대로 뒀다. iOS 는 발사 시점에 코드가 안 도는데 — 내가 `PaidVoiceGate` 주석에 직접 쓴 전제를 여기서 놓쳤다. 반복 알람은 탈퇴자 목소리로 사실상 무기한 울린다. staged 사본도 디스크에 남았다 |
| **유료 게이트 우회** | 울림시점 in-app 폴백이 store 원본을 다시 읽어 유료 목소리를 재생 |

### 🔴 업스트림 최신 수정과 같은 버그 (커밋 `eb70f2f2`)

안드로이드가 2026-08-06 에 고친 sync 3건이 **되살린 iOS 에 그대로** 있었다.
`RemoteAlarmSyncViewModel` 과 `AlarmTalkApp` 부트스트랩이 **서로 다른 인스턴스**를 만드는데
`LocalAlarmStore` 는 하나라, 인스턴스 플래그로는 못 막는다 → **타입 단위 게이트**로 직렬화.
겹친 요청은 버리지 않고 미뤄 두고(`repeat/while`), 세션은 **회차마다 다시 읽는다**.
BGAppRefreshTask 가 실행 중 Task 를 취소하지 않던 것도 함께 고쳤다.

### 🔴 받은 알람 소유권 (커밋 `1f195191`) — Codex #675 계열

안드로이드가 **네 번** 잡았던 버그 계열이 그대로 있었다.

- `merge` 가 '보존할 필드를 세는' 방식이라 **시각·요일·스누즈 간격·스누즈 토글**을 빠뜨려
  서버 값으로 덮었다 → 수신자가 07:00 을 06:30 으로 고쳐도 다음 pull 에 되돌아간다.
  **방향을 뒤집었다** — 받은 알람은 일정까지 수신자 것이 기본.
- 스누즈 회차가 깨졌다(상태만 지키고 마감을 갈아 끼워 '5분 뒤' 가 사라짐) → 한 묶음으로 유지.
- **울리는 중인 알람을 pull 이 껐다** — 재예약이 alerting 중인 AlarmKit 알람을 취소하는데
  그 취소가 dismiss 로 기록되지도 않는다 → `isInFlight` 로 두 번 거른다.
- 다운로드(수 초) 전 스냅샷으로 판단·머지해서 **지운 알람이 되살아나고 껐던 알람이 켜졌다**
  → 반영 직전 재조회.
- 겹친 pull 이 같은 알람을 **두 행**으로 임포트해 두 번 울리던 것 → 신규 분기도 재조회.

### 🔴 제품에서 사라진 것을 iOS 만 붙들고 있던 것 (커밋 `d56d7daf`)

문구 종류에 `meal`/`sleep`/`exercise` 가 남아 있었다. 서버 화이트리스트는
`preset/wake_weather/wake_fortune/love`(+`medication`→preset)뿐이라 **고르면 저장이 100% 실패**한다.
반대로 실제로 있는 **'약'(medication)은 iOS 에서 고를 수조차 없었다.** 라벨도 안드로이드와
달랐다. `DynamicVoiceRefreshService` 가 같은 매핑을 복사해 갖고 있던 것도 enum 에 위임.

### 🟡 편집기 (커밋 `6bf769b0`, `03a7fb7a`)

- 스톡 클립 알람을 다시 열면 **유료 전용 '직접 입력' 창**이 뜨고, 한 글자만 고쳐도 고른
  클립과 문구가 없이 **일반 프리셋으로 조용히 덮였다** → `isActiveStockClipAlarm` 술어 도입.
- 저장 중 닫기(X)·스와이프가 안 잠겨 **취소한 줄 알았는데 알람이 저장**됐다.
  (단 `voiceStudio.isBusy` 까지 잠그면 미리듣기·새로고침에 갇히므로 `isWorking` 만.)

### 🟡 「직전 선택 유지」 규약 (커밋 `6c4af8b4`)

`DynamicPromptPreferenceStore` 가 iOS 에 **아예 없었다** — 문구 종류도 직접 입력 문구도
기억하지 않아 새 알람이 매번 '기본 인사말' 로 열렸다. 안드로이드와 키를 동일하게 구현.
목소리 last-used 는 **`default_voice_` 와 다른 키**로 뒀다 — 그 키는 온보딩 완료 판정이라
알람 저장이 덮으면 온보딩을 건너뛴 사용자가 '완료' 로 바뀐다.

### 남은 채굴 결과 (미착수, 근거는 위 워크플로 기록에)

- **화자 분리(목소리 나누기) 제거** — 백엔드 라우트·테이블이 전부 사라졌는데 iOS 는
  824줄짜리 `SpeakerSeparationFlow.swift` + API 3종을 그대로 들고 있다. 누르면 404.
- `POST /alarm/source`·`raw_audio_url`·`raw_audio_duration_ms` 잔재 (마이그레이션 #84 로 제거됨)
- 목소리 성별·말투 정중체 UI (마이그레이션 #83 으로 컬럼 DROP, 대체재는 자동 분석)
- `upsertPreservingServerSyncFields` — 편집 커밋이 sync 전용 필드를 stale 값으로 되돌려
  **중복 create 의 두 번째 경로**가 된다
- 받은 알람 삭제가 `DELETE /alarm/:id` 로 나가 404 → decline 미기록 → 다음 pull 재임포트
  (`POST /alarm/:id/decline` 를 써야 한다)
- 권한 문구·버튼 3건(거부로 굳은 권한 안내, 상태 라벨이 결과를 말하지 않음 등)

---

## 0단계. 환경 — 완료

상세: [`ENVIRONMENT.md`](ENVIRONMENT.md). 요약: 처음엔 **시뮬레이터 런타임이 0개**라 어떤
iOS 빌드도 불가능했다. 런타임 8.52GB + XcodeGen + npm 의존성을 설치하고, `xcode-select` 를
Xcode 26.6 으로 맞추고, `caffeinate` 로 밤샘 절전을 막았다.

**사람이 해야 하는 것 (물리적으로 에이전트가 못 함)**
- 전원 어댑터 연결 · 덮개 열어 두기
- **Apple Developer Program(연 $99) 가입** — 무료 Apple ID 로는 이 앱의 엔타이틀먼트
  (App Groups + Sign in with Apple)를 못 써서 실기기 실행조차 안 된다.
  가입 후 채울 값과 넣을 자리는 4단계 이후에 `APPLE-ACCOUNT-SETUP.md` 로 정리한다.

---

## 1단계. 첫 그린 빌드 — 완료 ✅

`git revert --no-commit 9f427c69` → 189파일 복원, 충돌 0 (`abfa9a9d`).

**옛 브리프의 "34k줄이 한 번도 컴파일된 적 없다 / Swift 6 에러 수십~수백 건 각오" 는 틀렸다.**
옛 `apps/ios-native/README.md` 의 *"not built in this **Windows** workspace"* 를 오독한 것이고,
이 코드는 GitHub Actions macOS 러너에서 빌드·테스트가 돌던 코드다
(`3b8788d3`, `0bb451f7 fix: iOS Swift 6 동시성 빌드 오류 정리`, `89988c16 fix/ios-ci-test-greenup`).

**실제 에러 3곳** (`90009b0d`):

| 파일:줄 | 수정 |
|---|---|
| `AudioCacheStore.swift:58` | `shared` 를 `nonisolated static let` 으로. 이 타입은 멤버가 사실상 전부 `nonisolated`(FileManager/AVAsset 만 사용)이고, 주석이 "nonisolated 캐싱 경로가 `Self.shared` 를 await 없이 접근" 하는 것이 설계 의도라고 명시한다 |
| `AlarmTalkApp.swift:232` | 인라인 `group.addTask { @MainActor in }` → 이름 붙은 `@MainActor` 정적 메서드. 인라인은 Swift 6.3 region isolation checker 가 이해 못 해 거부한다(컴파일러 한계) |

**격리를 낮추는 방향으로 고치지 않았다.** `AlarmTalkApp.swift:232` 는 시간대 변경 시 알람
재예약 경로라 경쟁 상태가 생기면 "안 울림" 으로 나타난다.

> ⚠ `AlarmTalkApp.swift:232` 는 `swiftc -typecheck` 로는 안 잡힌다(SIL 단계 진단).

---

## 2단계. 테스트 — 완료 ✅ (288/288)

테스트 타깃 컴파일 에러 1건(`@MainActor` 누락) 해결 후 **286 tests / 281 passed / 5 failed**
로 시작. 5건을 전부 판별했다 — **초록을 만들려고 단언을 고치지 않았다.**

### 🔴 그중 1건은 진짜 코드 버그였다 (`6306c99b`)

**음력 엔진이 중국 자오선을 쓰고 있었다.** `Calendar(identifier: .chinese)` 에
`timeZone = Asia/Seoul` 을 물리면 KASI 경계에 정렬된다고 파일 주석에 적혀 있었는데 **틀렸다** —
`timeZone` 은 instant 를 어느 민용일에 담을지만 정하고, 음력 월의 경계(삭 순간)는 ICU 가
그 역법의 기준 자오선으로 계산한다. `.chinese` 는 중국(120°E), 한국 민용력은 135°E 다.

결과: **2027 설날을 2/6, 2028 설날을 1/26 으로 계산했다.** KASI 공식은 2/7, 1/27 이다.
알람 앱에서 이게 틀리면 "공휴일엔 알람 끄기" 가 **엉뚱한 날 꺼지고 설날 당일에 울린다.**

수정: ICU **dangi**(단기력) 캘린더로 교체. 2025~2031 전수 확인 결과 dangi 는 KASI 와
7개 연도 전부 일치하고 `.chinese` 는 2027·2028 두 해가 어긋난다. 안드로이드 ground truth
(`LunarHolidayCalendarTest.kt` 의 `seollalByYear`)와도 같은 값이다.

> ⚠ **되돌리기 주의.** 처음에 이 실패를 "묵은 골든벡터" 로 오판하고 기대값을 `.chinese`
> 출력(2/6·1/26)에 맞춰 고쳤었다. 그건 **구현 버그를 테스트로 덮는 것**이었다.
> 안드로이드 ground truth 대조로 뒤집었다. **기대값을 엔진에 맞추지 말 것.**

이 한 건을 고치자 `test_seollal_goldenVectors` 와 `test_substitute_goldenVectors` 가
**함께** 통과했다(2027 설날이 일요일이라 대체공휴일 2/9 가 성립).

### 나머지 4건 — 묵은 기대값 (코드 무변경)

| 테스트 | 판정 근거 |
|---|---|
| `VoiceStudioViewModelTests.test_isProfileLimitReached_andRemainingSlots` | 기대 5, 실제 1. 단일 출처는 서버 `voice-profile.ts:38 MAX_VOICE_PROFILES = 1`, 안드로이드도 `NavigationModels.kt:40` 에서 1. 리터럴 대신 `VoiceProfileLimits.maxProfiles` 를 쓰도록 수정 |
| `LocalAlarmRecordCodableTests.test_legacy17FieldJSONCompatibility` | 옛 17필드 legacy 디코더는 `4d5004a2` 가 의도적으로 삭제. 그 포맷 수명은 `7c9fcd7f`~`e350ee63` 로 **같은 날 9시간 남짓**이었고, 호환 디코더와 테스트는 포맷을 갈아엎은 커밋이 **동시에** 만든 투기적 호환이었다. 당시 Windows 라 컴파일도 안 됐고 출시 이력 0 → 그 포맷의 기기는 세상에 없다. 살아 있는 보정 3종만 지키도록 교체 |
| `test_timezoneIndependence_extremeDeviceTimezones` | 두 축을 섞고 있었다. ①"기기 시계를 바꿔도 같은 판정"(참) ②"여러 존의 정오가 전부 같은 한국 민용일"(**거짓** — 각 존의 정오는 서로 다른 순간). Pago_Pago(UTC-11) 정오는 KST 로 이미 다음 날 아침이라 하루 뒤가 맞다. 두 테스트로 분리 |

---

## 3단계. 백엔드 — 완료 ✅

### 마이그레이션 #94~#96 (전부 append-only, prod 데이터 보존)

| # | 이름 | 내용 |
|---|---|---|
| 94 | `restore-ios-push-platform` | `push_tokens.platform` CHECK 에 `'ios'` 복구. #88 이 좁혀 둔 탓에 **DB 가 iOS 토큰을 거절**하던 상태였다. CHECK 변경이라 테이블 재작성이지만 **넓히는 방향이라 필터 없이 전 행 이관** — 기존 토큰 보존. 인덱스는 지금 살아 있는 2개만 재생성(`idx_push_tokens_user` 는 #89 가 중복이라 지운 것) |
| 95 | `restore-apple-identity` | `users.apple_id` + 부분 UNIQUE 인덱스 복구(#82 가 떨궜던 것). NULL 행끼리 충돌 안 하므로 기존 계정 영향 0 |
| 96 | `restore-apple-billing` | `subscriptions` 의 apple 컬럼 3개 + 인덱스 2개, `store_transactions.provider` CHECK 를 `('apple','google')` 로 확대. 구글 결제 이력 전부 보존 |

> ⚠ **이 마이그레이션들은 이 브랜치에서 한 번도 실행되지 않았다.** push 금지라 dev 배포가
> 없고, vitest 는 로컬 DB 를 쓴다. "작성 완료, 미실행" 이 정확한 표현이다.
> 되돌릴 수 없는 DDL 이므로 `CLAUDE.md` 규약대로 **dev 배포로 먼저 검증**해야 한다.

### 코드

- **`app-version.ts` iOS 분기** — `appVersionPolicy` 가 platform 을 실제로 보고 분기한다.
  iOS 는 `minSupported/latest = 1`. App Store 에 올라간 적이 없어 막을 사용자가 없고,
  Android 하한(21)을 물려주면 iOS 빌드번호 1 이 즉시 강제 업데이트 차단 화면에 걸린다.
  모르는 플랫폼은 Android 폴백 유지(iOS 의 느슨한 하한이 새면 구버전 Android 가 빠져나간다).
- **`POST /auth/apple`** + `lib/apple-oauth.ts` — 애플 JWKS 로 identity token 서명을 직접
  검증한다. **비밀키(.p8)가 필요 없다** — 네이티브 로그인은 공개키 검증만 한다.
  alg 를 RS256 으로 고정(alg=none/HS256 혼동 공격 차단), iss/aud/exp/nonce/email_verified 검증,
  JWKS 10분 캐시하되 **실패는 캐시하지 않는다**(애플의 일시적 5xx 가 로그인을 막으면 안 된다).
  ⚠ 구글과 달리 **email 을 덮어쓰지 않는다** — 애플은 재로그인 때 이메일을 안 주기도 해서
  합성 주소로 갱신하면 저장된 진짜 주소가 지워진다.
- **`POST /billing/apple/confirm`** + `lib/apple-storekit.ts` — App Store Server API 로 검증.
  클라가 보낸 JWS 를 직접 검증하려면 x5c 체인을 Apple Root CA 까지 ASN.1 로 파싱해야 하고,
  시뮬레이터 로컬 StoreKit 은 애플 루트가 아닌 로컬 인증서로 서명해 어차피 통과하지 않는다.
  대신 transactionId 로 **애플에 직접 물어본다**(구글이 Play Developer API 를 믿는 것과 같다).
  ⚠ `providerTransactionId` 로 **originalTransactionId** 를 쓴다 — `transactionId` 는 갱신마다
  바뀌어서 그걸 키로 삼으면 매달 새 구독이 생긴다.
  프로덕션 404 → 샌드박스 폴백(심사·TestFlight 대응), 환불·만료·비구독 상품 거절.
- `StoreProvider` 에 `'apple'` 추가. `applyStoreEntitlement` 는 원래부터 provider-agnostic
  이라 로직 변경 없음. **기존 구글 경로는 건드리지 않았다.**

신규 테스트 31건(Apple JWKS 15 · StoreKit 11 · app-version/push 5). 실제 RSA/P-256 키쌍을
만들어 서명 경로를 진짜로 태운다 — **유료 계정 없이 검증된다.**

---

## 4단계. 법무문서 v5 — 완료 ✅ (`b4f6b861`)

**한국어 문서만 개정했다.** `docs/legal` 에 `.en.md`/`.ja.md` 는 **존재하지 않는다** —
옛 브리프가 "en/ja 도 개정" 이라고 지시했지만 없는 문서다. 법적 효력이 있는 문서를
원본 없이 창작하지 않았다.

- `privacy-policy.ko.md` — Apple 로그인 수집 항목 복구(이메일 가리기·이름 1회 제공 명시),
  결제를 앱 마켓별 경로로 정정, 위탁/국외이전 표에 Apple 행 추가, 개정 이력에 v5 추가
- `terms-of-service.ko.md` 제10조 — 마켓별 결제 + "구매한 마켓으로만 해지·환불"
- `compliance-notes.ko.md` · `store-disclosures.ko.md` — "구글 단일 경로" 기재 정정,
  App Store 제출 시 App Privacy 항목이 Play Data safety 와 다르다는 경고 추가
- `consent.ts` `CURRENT_POLICY_VERSION` `'4'` → `'5'`, 테스트 가드도 `'5'` 로
  (이건 "테스트가 깨져서 고쳤다" 가 아니라 **의도된 정책 변경**이다)

### ⚠ 배포 순서 — 이것 때문에 머지 타이밍이 갈린다

안드로이드는 `BuildConfig.LEGAL_POLICY_VERSION` 을 `privacy-policy.ko.md` /
`terms-of-service.ko.md` 의 `정책 버전: N` 줄에서 **빌드 시 파싱**한다
(`app/build.gradle.kts:101`, 두 문서 버전이 다르면 빌드가 실패하도록 되어 있다).

→ **안드로이드 코드를 고칠 필요는 없다**(고치지도 않았다). 하지만 이 백엔드가 배포된 뒤
**v5 본문을 담은 안드로이드 빌드를 스토어에 올리기 전까지는**, 동의를 새로 제출해야 하는
사용자(신규 가입·목소리 등록 민감동의)가 `409 POLICY_VERSION_MISMATCH` 를 받고
업데이트 게이트에 걸린다. **이미 동의를 마친 기존 사용자는 영향 없다.**

### ⚠ 법무 판단 — 사람이 확인할 것

`CONSENT_MIN_POLICY_VERSION` 은 **올리지 않았다**(전부 3 유지).

v5 는 Apple 을 국외이전 수탁자로 추가하므로 형식상 "새 국외이전" 이다. 그러나 Apple 로
나가는 데이터는 **iOS 이용자의 것뿐**이고, 지금 동의 기록을 가진 사용자는 전원 Android 라
그들의 데이터 처리는 아무것도 바뀌지 않았다. 기존 기준(`consent.ts` 주석: "그 유형의 동의
내용이 실제로 바뀔 때만 올린다")에 해당하지 않는다고 판단했다. iOS 이용자는 가입 시점에
v5 본문으로 동의하므로 기록이 5 로 남아 정확하다.
**되돌리려면 `overseas_transfer` 를 5 로 올린다** — 그러면 Android 전원이 재동의 게이트를 본다.

---

## 계정 준비 문서 — 작성 완료

- [`APPLE-ACCOUNT-SETUP.md`](APPLE-ACCOUNT-SETUP.md) — **가입 후 값만 채우면 되는 상태**로
  정리했다. Team ID / App ID 2개 / Capability 3종 / App Group / 상품 ID 3개 /
  App Store Server API 키 → 각각 **어느 파일 어느 키에 넣는지**까지.
  시크릿 키 이름은 이미 등록해 뒀다(`sync-worker-secrets.ts`, `wrangler.toml`,
  `.dev.vars.example` — `7f33eb68`). 등록을 빼먹으면 값을 채워도 워커로 안 올라간다.
- [`DEVICE-SPIKE.md`](DEVICE-SPIKE.md) — 실기기로만 되는 검증 6종. 코드는 손대지 않았다.

---

## 5단계. 계약 P0 — 완료 ✅

> **옛 브리프의 P0 목록은 실제보다 과장돼 있었다.** 실측 결과:
> `GET /user/me → /auth/me` 는 **이미 되어 있었고**(부트스트랩이 `auth/me` 를 부른다),
> 삭제된 라우트 7개 호출부도 대부분 0건이었다(library·friend·stats·family-invite·
> alarm-source·alarm/tick·tts/presets 전부 0). 표시 이름도 "64자·trim 없음" 이 아니라
> 이미 30자였다. **실제로 비어 있던 것은 아래 3건**이다.

### 🔴 rolling refresh 누락 (`93aa898a`) — 가장 무거운 P0

`GET /auth/me` 는 매 호출마다 새 토큰을 함께 내려준다(`auth.ts` 의 `rolledToken`).
그런데 iOS 는 응답에서 `user` 만 꺼내고 **token 을 버린 뒤 쓰던 토큰을 그대로 다시 넣고**
있었다(`AuthViewModel.swift:385`).

결과: 최초 발급 토큰이 90일 뒤 그대로 죽는다. 그 순간 조용히 로그아웃된 상태가 되고,
1.2.1 부터 들어간 소유자 게이트에 걸려 **알람이 목록에서 사라지고 울리지도 않는다.**
앱을 매일 열어도 만료가 밀리지 않아 전원이 90일째에 같은 일을 겪는다.

- `me()` 가 `(token: String?, user: AuthUser)` 를 돌려주고 `refreshUser()` 가 갈아 끼운다.
- 서버 재발급 실패(`token` 키 없음)·빈 문자열이면 쓰던 토큰 유지 —
  빈 토큰으로 갈아 끼우면 이후 전 요청이 401 이 되어 즉시 로그아웃된다.
- 회귀 테스트 3건.

### 🔴 동의에 `document_version` 미전송 (`b53f5d54`)

서버는 이 필드가 없으면 400, 게시본과 다르면 409 로 거부한다. iOS 는 **아예 안 보내고
있었다** — 동의 기록이 통째로 불가능했고, 필수 동의를 못 하면 가입·목소리 등록이 막힌다.

- `scripts/generate-legal-version.sh` 신규 — `docs/legal` 의 `정책 버전: N` 을 읽어
  `Generated/LegalPolicyVersion.swift` 를 만든다. **두 문서 버전이 다르면 빌드를 세운다.**
  `project.yml` 의 `preBuildScripts` 로 물려 빌드마다 재생성 → 드리프트 불가.
  **안드로이드 `app/build.gradle.kts:101` 과 같은 구조**다.
- `AuthViewModel.currentPolicyVersion` 이 `"3"` 리터럴이었다 → 같은 출처로 통일.
- 409/400 처리 추가(`consentUnsupported`). 안드로이드 `handleConsentVersionMismatch` 와
  같은 판단 — **서버가 앞서면** 업데이트 게이트, **앱이 앞서면**(백엔드 배포 진행 중)
  업데이트해도 안 풀리므로 그렇게 말하지 않는다.

### 🟡 입력 정리 규칙 부재 (`25c8e3c1`)

길이(30/50)는 맞았지만 **정규화가 전혀 없었다** — 제어문자·제로폭·양방향 문자가 그대로
통과했고, 상한 리터럴이 5개 화면에 흩어져 있었다.

`InputSanitizer.swift` 신규 — 서버 `normalizeDisplayName`, 안드로이드
`CodeRedeemField.kt` 와 같은 규칙. 호출부 5곳 통일, 테스트 14건.

- **뒤쪽 공백은 남긴다**(안드로이드와 동일 `trimStart`). 입력 중에 trailing space 를
  먹으면 "김 규원" 같은 이름을 아예 칠 수 없다.
- Swift `String` 은 grapheme 단위라 `prefix` 가 이모지를 반으로 가르지 않는다 —
  JS `slice`·코틀린 `take` 가 겪던 문제가 여기선 안 생긴다. 테스트로 고정.

**Apple 로그인 클라 경로**는 옛 코드에 이미 있다(`handleAppleAuthorization`,
`KeychainStore`, `NonceGenerator`). 서버가 3단계에서 준비됐으므로 실기기에서 연결 확인만
남는다(`DEVICE-SPIKE.md` 6번).

---

## 시뮬레이터 실행 검증 — 2026-08-06

**테스트만 돌리던 것을 넘어 앱을 실제로 띄웠다.** 그러자 단위 테스트로는 절대 안 나올
문제가 두 개 나왔다.

### 🔴 Debug 빌드가 **prod 백엔드**를 때리고 있었다 (`3c2e8810`)

`Info.plist` 에 `https://api.alarm-talk.com/api` 가 하드코딩돼 있었다. prod 에는 베타
테스터 실데이터가 있다. 인수인계 문서는 "앱이 dev 를 바라본다" 고 적었는데 **사실이 아니었다.**

→ 안드로이드 dev/prod product flavor 와 같은 분리를 줬다(`project.yml` configuration 별
`VOICE_ALARM_API_BASE_URL`). os_log 의 `nw_connection` url 로 dev 호스트 전환을 실증했다.

### 🔴 앱이 **첫 화면에서 막힌다** — 백엔드 배포 대기

앱을 띄우면 **"업데이트가 필요해요" 차단 화면**이 뜬다. 원인은 서버다:

```
$ curl "https://api-dev.alarm-talk.com/api/app/version?platform=ios"
{"platform":"ios","min_supported_version":21,"latest_version":24,
 "store_url":"https://play.google.com/store/apps/details?id=com.alarmtalk.app"}
```

iOS 빌드번호는 1 이라 `1 < 21` → 강제 업데이트. 게다가 **iOS 에 Play 스토어 URL** 을 준다.
클라는 이미 `platform=ios` 를 정확히 보내고 있다(`AlarmTalkAPI.swift:450`) — 서버가 무시할 뿐이다.

→ **이게 바로 `app-version.ts` iOS 분기(`fbe27826`)가 고치는 문제다.** 다만 그 수정이
dev 에 배포되지 않아 지금은 증상이 그대로다(push 금지라 배포 경로가 없다).

**실증**: 빌드번호를 99 로 올려(검증 전용, 커밋 안 함) 게이트를 통과시키니 랜딩·로그인
화면이 정상 렌더된다. 앱은 살아 있고 크래시도 없다(StoreKit 초기화까지 정상).

> ⚠ **다음 사람이 반드시 알아야 할 것**: dev 백엔드에 이 브랜치가 배포되기 전까지
> **iOS 앱은 첫 화면을 넘어갈 수 없다.** 코드 문제가 아니라 배포 의존성이다.
> 임시로 보려면 `xcodebuild ... CURRENT_PROJECT_VERSION=99` 로 빌드하면 된다.

### 디자인 격차 (8단계) — 육안 확인

랜딩/로그인 화면이 **흰 바탕 + 파랑**인데, 안드로이드는 **딥네이비**
(`AlarmListScreen` 의 `HomeGradientDark/Light` — "로그인 딥네이비 감성을 알람/목소리/더보기
탭 전체에 재현"). 색 체계부터 다르다. 8단계에서 `AlarmTalkTheme.kt` 의 `colorScheme` 을
기준으로 맞춰야 한다.

---

## 리베이스 — 2026-08-06

`origin/develop` 에 10커밋이 들어왔다(1.2.4 릴리스 포함). `git rebase origin/develop` 으로
14커밋을 그 위에 올렸다 — **충돌 0**. 겹친 파일은 `app-version.ts`/`app-version.test.ts`
둘뿐이었고(업스트림의 `latest: 23 → 24` vs 내 iOS 분기), git 이 정확히 병합했다.

새로 들어온 규약 중 **iOS 도 맞춰야 하는 것**: 「직접 입력은 문구까지 기억한다」
(2026-08-06 변경, `last_manual_text_<userId>`). 그전에는 "기억하지 않는다" 였다 →
9단계에서 반영할 것.

---

## 6단계. 계약 P1 — 부분 완료

> 다시 한 번, **옛 목록이 실제보다 컸다.** 실측: `code/register`·`family/alarms/voice`·
> `billing/apple/confirm` 은 **이미 올바른 경로**였고, 삭제된 라우트 호출부도 대부분 0건이었다
> (`gift` 로 잡힌 1건은 라우트가 아니라 SF Symbol 아이콘 이름이었다).

### ✅ `GET /alarm/declined` 소비 (`6c87c56e`)

iOS 는 이 엔드포인트를 **아예 소비하지 않았고**, 대신 "서버 목록에 없으면 지운다" 로
처리하고 있었다. 그래서 **발신자가 지운 알람까지 수신자 기기에서 사라졌다** —
받은 뒤부터는 받는 사람 것인데.

- `alarm_ids`(그만받기) → 지운다 / `revoked_alarm_ids`(발신자 탈퇴) → **목소리만** 걷어낸다
- 페이지를 끝까지 받고, offset 은 **두 배열의 합**만큼 전진(서버가 한 페이지에 섞어 보낸다)
- **못 물어보면 아무것도 지우지 않는다**
- 철회 대상은 `hasSenderVoice`(캐시키 `remote-message-` 접두사)로 좁힌다. '목소리가 있는 행'
  으로 넓게 잡으면 수신자가 나중에 넣은 자기 목소리까지 매 pull 마다 걷어낸다
- 목소리를 걷어내도 **시각·요일은 남긴다** — 통째로 지우면 그날 못 일어난다

### ✅ 죽은 `POST /billing/redeem` 호출부 제거
UI 호출부가 없는 죽은 코드였다(살아 있는 경로는 `code/register`).

### ⬜ 남은 것
`bucket_id`(iOS 에 **개념 자체가 없다** — 무료 버킷 회전 미구현) · 동의 상태 신규 필드
(`needs_collection`/`sensitive_missing`/`has_prior_consent`/`optional`) ·
`GET /voice/draft-quota` · FCM 4종(→ 아래 참고).

---

## 7단계. 알람 발사 재설계 — 핵심 1건 완료

### ✅ 유료 목소리 게이트를 예약 시점으로 (`f91e75dc`)

**이 단계에서 가장 값어치 있는 항목이었다.** 안드로이드는 `RingingService` 가 **울릴 때**
로컬 영속 구독으로 유료 권한을 재확인해 강등한다. **iOS 에는 그 자리가 없다** —
AlarmKit 은 발사 시점에 우리 코드를 실행하지 않는다(해제 시점 `stopIntent` 뿐).

iOS 에는 이 게이트가 **아예 없었다.** 구독이 만료돼도 유료 클론 목소리로 계속 울린다.
빌드·테스트·lint 가 전부 초록이라 이런 종류는 조용히 오작동한다.

→ `PaidVoiceGate.swift` 로 같은 판정을 **예약 시점**에 한다. fail-open(판단 불가 시 강등
안 함), 본인 소유 알람만, 무료 시스템 보이스 제외, 회복형 상태(ON_HOLD/PAUSED) 유지,
그룹 접근 인정. **강등해도 알람은 그대로 울린다**(목소리만 빼고 기본 톤). 테스트 13건.

> ⚠ **알려진 한계(버그 아님)**: 판정이 예약 시점이라 이미 예약된 알람은 다음 재예약 전까지
> 유료 목소리로 울릴 수 있다. iOS 구조상 불가피하고, 반대 방향(멀쩡한 알람 무음화)보다 안전하다.

> ⚠ `AGENTS.md` 「알람 엔진 변경은 실기기에서 검증한다」 대상이다. 단위 테스트로 판정
> 로직은 고정했지만 실제 발사는 `DEVICE-SPIKE.md` 로 확인해야 한다.

### ⬜ 남은 것
**무료 버킷 회전**(울릴 때마다 클립 순차 이동)과 **당일 문구 갱신**도 예약 시점으로 옮겨야
한다. 다만 iOS 는 `bucket_id` 자체가 없어서, "옮기는" 작업이 아니라 **처음 만드는** 작업이다
(6단계 `bucket_id` 와 같은 일). 여기서 멈춘 이유는 그것이 기능 추가라 알람 엔진을 크게
건드리는데, 실기기 검증 없이 밀어붙이는 것이 `AGENTS.md` 규약에 어긋나기 때문이다.

---

## 미착수 항목 진행 — 2026-08-06 (2차)

### 완료

**동의 계약 전면 정비** (`46bbbf11` · `d1444b58`)
iOS 는 `/user/consents/status` 의 9개 필드 중 4개만 읽고 있었다. 드러난 문제 셋:
1. **음성 생체정보를 필수로 강제**하고 있었다 → 개인정보보호법 제22조제5항 위반 소지.
   필수/선택은 서버 `optional` 로 가른다(화면이 목록을 들고 있으면 서버와 어긋난다).
2. **재동의가 기존 마케팅 동의를 조용히 철회**했다. 6종을 항상 제출해서, 마케팅만
   재수집하는 화면이 묻지도 않은 항목을 화면 초기값(false)으로 함께 기록했다.
3. **선택 유형만 재수집하면 화면이 영영 안 떴다**(`needs_consent` 는 false 다).
   게이트를 `showConsentScreen` 으로 옮겼다.
그리고 ①을 고치면 거절이 가능해지므로 **회복 경로가 필수가 된다** — 403 이 지목한
민감 동의만 받는 `VoiceConsentSheet` 를 만들었다(없으면 같은 403 무한 반복).

**목소리 쿼터** (`4b1b3e36`) — `GET /voice/draft-quota` 를 아예 안 부르고 있었다.
'이번 달 n/1' 표시 + 소진 시 버튼 잠금 + 삭제 전 경고. 판정은 **정식 등록 쿼터**로 한다
(초안 쿼터의 remaining 은 호환용 0 고정이라 그걸 쓰면 항상 소진으로 읽힌다).

**탭 구성 = 안드로이드** (`ac791c64`) — 스크린샷 대조로 **구조 자체가 다른 것**을 찾았다.
  안드로이드: 알람 / 목소리 / 더보기   ·   iOS(기존): 홈 / 목소리 / 알람
'홈' 탭을 걷고 첫 탭을 알람으로, '더보기'(MenuView)를 새로 만들고, ＋ 는 "누구를
깨울까요?" 를 먼저 묻게 했다. 남은 시간 헤드라인도 알람 탭 위로 올렸다.

### 남은 것 (착수 안 함)

- **무료 버킷 회전** — 안드로이드는 dismiss 시점에 `bucketRotationIndex` 를 +1 해서
  다음 예약에 다른 클립을 물린다(`advancedBucketRotationIndex`). iOS 도 dismiss 신호가
  있어(`observeAlarmUpdates` 의 사라짐 감지 → 재무장) **구현 가능한 모양이다.**
  필요한 것: 레코드에 bucket/rotationIndex/clipKeys 복원 → 저장 시 클립 N개 해석 →
  예약 시 `clipKeys[index % count]` 선택 → 재무장 때 +1.
  (지금은 필드를 지워 둔 상태다 — 쓰는 곳이 0 이라 죽은 코드였다. 구현할 때 되살린다.)
- **화면별 세부 대조** — 탭 구조는 맞췄지만 편집기·문구 선택·운세 등 개별 화면의
  간격/문구/순서는 아직 스크린샷과 1:1 대조하지 않았다.
  참고 스크린샷: `~/Downloads/ios-handoff/안드로이드-화면/` (2026-08-05 02:22 촬영).
  ⚠ 그 뒤 develop 에 UI 커밋이 몇 개 더 있으므로(`ab015980` 문구 선택 유지 등)
  **스크린샷보다 안드로이드 소스가 우선**이다.
- **iOS 푸시 전체** — 옛 코드에 구현이 **0줄**이다. Apple 개발자 계정 → APNs 키 →
  Firebase iOS 앱 → `GoogleService-Info.plist` 가 먼저라 계정 없이는 착수 자체가 안 된다.

## 사람이 판단해야 하는 것

1. **Apple Developer Program 가입**(연 $99). 무료 Apple ID 로는 이 앱의 엔타이틀먼트
   (App Groups + Sign in with Apple)를 못 써서 **실기기 실행조차 안 된다.**
   가입 후 할 일은 `APPLE-ACCOUNT-SETUP.md` 에 순서대로 정리돼 있다.
2. **마이그레이션 #94~#96 은 작성만 됐고 한 번도 실행되지 않았다.** push 금지라 dev 배포가
   없고 vitest 는 로컬 DB 를 쓴다. 되돌릴 수 없는 DDL 이므로 `CLAUDE.md` 규약대로
   **dev 에 먼저 올려 검증**하고 prod 는 그 뒤에.
3. **법무 v5 배포 순서** — 위 「배포 순서」 절.
4. **`CONSENT_MIN_POLICY_VERSION` 을 안 올린 판단** — 위 「법무 판단」 절.
5. **iOS 푸시는 코드부터 새로 짜야 한다.** 옛 iOS 코드에 푸시 구현이 **0줄**이고
   (`registerForRemoteNotifications` 0건, Firebase 참조 0건) `GoogleService-Info.plist` 도 없다.
   DB CHECK(#94)만 고쳐서는 iOS 푸시가 생기지 않는다.
