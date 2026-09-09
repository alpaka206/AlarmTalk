# iOS 개발 환경 — 실측 검증 결과 (2026-08-05 측정 · 2026-09-08 재확인)

이 문서는 **추정이 아니라 실제로 명령을 돌려 확인한 값**만 담는다.
맥 환경 준비는 끝났다. 설치할 것이 없다.

> 2026-09-08 재확인: 아래 툴체인 표는 **그대로 맞다**(Xcode 26.6/17F113, SDK 26.5,
> macOS 26.4/25E246, Swift 6.3.3, XcodeGen 2.46.0, AlarmKit.framework 양쪽 SDK, 시뮬레이터
> UDID 유효). 바뀐 것은 Node v24.19.0 / npm 11.17.0 / Homebrew 6.0.22 뿐이다.

## 툴체인

| 항목 | 값 | 확인 방법 |
|---|---|---|
| macOS | 26.4 (25E246), arm64, RAM 24GB, 여유 403GB | `sw_vers` |
| Xcode | **26.6** (Build 17F113) | `xcodebuild -version` |
| `xcode-select` | `/Applications/Xcode.app/Contents/Developer` ✅ | `xcode-select -p` |
| iOS SDK | 26.5 (device) / 26.5 (simulator) | `xcodebuild -showsdks` |
| **AlarmKit.framework** | device SDK·simulator SDK 양쪽에 존재 ✅ | SDK `System/Library/Frameworks` 직접 확인 |
| 시뮬레이터 런타임 | **iOS 26.5 (23F77)** 설치됨 | `xcrun simctl list runtimes` |
| 시뮬레이터 기기 | `iPhone 17 Pro` = `0733FD07-812F-4EC4-B149-B9A992E51F00` (부팅됨) | `xcrun simctl list devices` |
| Swift | 6.3.3 (swiftlang-6.3.3.1.3) | `xcrun swift --version` |
| XcodeGen | **2.46.0** (Homebrew) | `xcodegen --version` |
| Node / npm | v24.18.1 / 11.16.0, `npm ci` 완료 | — |
| Homebrew | 6.0.14 (`/opt/homebrew`) | — |

> 최초 상태에서는 **시뮬레이터 런타임이 0개**여서 `xcodebuild` 가 destination 을 못 찾아
> 어떤 iOS 빌드도 불가능했다. `xcodebuild -downloadPlatform iOS` 로 8.52GB 를 받아 설치했다
> (관리자 암호 불필요). `xcodegen` 도 없어서 `brew install xcodegen` 으로 설치했다.

## 그때 없던 것 — **지금은 전부 채워졌다** (2026-09-08 확인)

- **Apple Developer Program 계정** — ✅ 있다. 서명 인증서 `Apple Development: <이름>`,
  팀 `<팀 ID>`, `com.alarmtalk.app`·`com.alarmtalk.app.widget` 프로비저닝 프로파일
  (만료 2027-08). 확인: `security find-identity -v -p codesigning`,
  `~/Library/Developer/Xcode/UserData/Provisioning Profiles`.
- **iOS 26 실기기** — ✅ 있다. iPhone 14 Pro(iPhone15,2), iOS **26.6.1**, WiFi 페어링됨.
  확인: `xcrun devicectl list devices`. Debug 빌드 설치도 된다.
- **`GoogleService-Info.plist`** — ❌ 여전히 없고 **필요 없다.** iOS 푸시는 Firebase 를 거치지
  않는다 — 서버가 APNs 에 직접 쏜다(`packages/backend/src/lib/apns.ts` ·
  `apps/ios-native/AlarmTalk/PushNotificationCoordinator.swift`). 이유는 그 파일 머리 주석.
- **`gh` CLI** — ✅ 설치됨(`/opt/homebrew/bin/gh`, 2.97.0).

## 검증된 기준선 — **2026-08-05 당시 값이다**

> ⚠ **오늘의 회귀 기준으로 쓰지 말 것.** 그 뒤로 규모가 크게 늘었다 — 백엔드 테스트
> 파일 107개, `AlarmTalkTests` 79파일 704개 `func test`(+ UI 테스트 47개). 기준선이
> 필요하면 **지금 한 번 돌려서** 그 숫자를 쓴다.

```
백엔드 vitest      : 83 files,  1301 passed | 64 skipped   (4.58s)
npm run lint       : 0 errors, 1 warning
                     (voice-profile.ts:1392 no-console — 기존 것, 새로 생긴 게 아님)
npm run typecheck  : 통과 (shared / voice / landing / backend)
iOS xcodebuild test: 286 tests, 281 passed, 5 failed
```

## iOS 첫 빌드 — 실제로 돌려 본 결과

`git revert --no-commit 9f427c69` 를 스크래치 워크트리에서 실행 → **189파일 복원, 충돌 0**.
`xcodegen generate` → 성공 (`AlarmTalkNative.xcodeproj`, 스킴 `AlarmTalk`).

**Swift 6 에러는 4곳뿐이다.** (옛 브리프의 "수십~수백 건 각오" 는 틀렸다 — 이 코드는
GitHub Actions macOS 러너에서 빌드·테스트가 돌던 코드다.)

| 파일:줄 | 에러 |
|---|---|
| `AlarmTalk/AudioCacheStore.swift:88` | main actor-isolated static property 'shared' can not be referenced from a nonisolated context |
| `AlarmTalk/AudioCacheStore.swift:124` | 위와 동일 |
| `AlarmTalk/AlarmTalkApp.swift:232` | pattern that the region-based isolation checker does not understand how to check |
| `AlarmTalkTests/LocalHolidayCalendarLunarTests.swift:167` | call to main actor-isolated static method 'epochDay(of:)' in a synchronous nonisolated context |

이 4곳을 고친 사본으로 실제 빌드·테스트를 돌려 확인했다:
`** BUILD SUCCEEDED **` / `286 tests, 281 passed, 5 failed`.

> ⚠ `AlarmTalkApp.swift:232` 는 `swiftc -typecheck` 로는 **안 잡힌다**(SIL 단계 진단).
> 앞의 2건만 고치고 "다 됐다" 고 판단하면 안 된다.

### 기존 실패 테스트 5건 (수정 전부터 실패)

- `LocalHolidayCalendarLunarTests.test_seollal_goldenVectors`
- `LocalHolidayCalendarLunarTests.test_substitute_goldenVectors`
- `LocalHolidayCalendarLunarTests.test_timezoneIndependence_extremeDeviceTimezones`
- `LocalAlarmRecordCodableTests.test_legacy17FieldJSONCompatibility`
- `VoiceStudioViewModelTests.test_isProfileLimitReached_andRemainingSlots`

한 번도 사람이 검토한 적 없는 기대값이다. **초록을 만들려고 단언을 고치지 말고**,
코드 버그인지 묵은 기대값인지 판별해서 근거를 남길 것.

## 빌드 / 테스트 명령 (검증된 것)

```bash
cd /Users/devrel/Desktop/AlarmTalk/apps/ios-native
xcodegen generate

# 빌드
xcodebuild -project AlarmTalkNative.xcodeproj -scheme AlarmTalk -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -skipPackagePluginValidation CODE_SIGNING_ALLOWED=NO build

# 테스트 — ad-hoc 서명 필수
xcodebuild -project AlarmTalkNative.xcodeproj -scheme AlarmTalk -configuration Debug \
  -destination "id=0733FD07-812F-4EC4-B149-B9A992E51F00" -skipPackagePluginValidation \
  CODE_SIGN_IDENTITY="-" CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=YES \
  GENERATE_INFOPLIST_FILE=YES test
```

**함정 3가지 (전부 실제로 겪었다)**

1. `CODE_SIGNING_ALLOWED=NO` 로 **테스트**를 돌리면 엔타이틀먼트가 안 붙어
   `KeychainStore.saveSession` 이 `errSecMissingEntitlement` 로 죽는다. 위 ad-hoc 조합이 정답이며
   삭제된 CI(`git show 78424780^:.github/workflows/ios-build.yml`, 커밋 `0d6c276c`)에서 복원했다.
2. **같은 이름의 시뮬레이터를 새로 만들지 마라.** `iPhone 17 Pro` 가 둘이 되면
   `Unable to find a device ... multiple devices matched` 로 빌드가 실패한다. 위 UDID 를 써라.
3. `apps/ios-native/scripts/build-debug.sh` 는 destination 이 `generic/platform=iOS`(**실기기**)라
   시뮬레이터 작업에 그대로 쓰면 안 된다.

## 밤샘 실행 (절전)

이 맥북은 절전 설정이 `sleep 1`(유휴 1분)이라 그냥 두면 몇 분 만에 잠든다.

```bash
# 화면은 꺼지되 시스템은 안 자게
caffeinate -i -s &
# 확인
pmset -g assertions | grep PreventUserIdleSystemSleep   # 1 이어야 함
```

- **화면 꺼짐·화면 잠금은 작업에 영향 없다.**
- ⚠ **덮개를 닫으면 `caffeinate` 와 무관하게 잠든다.** 열어 둘 것.
- ⚠ **전원 어댑터를 꽂을 것.** 배터리로는 컴파일 부하에서 밤을 못 넘긴다.
  (`-s` 는 AC 전원일 때만 적용된다.)

## ✅ `docs/ios/` 는 이제 추적된다 (2026-08-05 에는 아니었다)

그때는 `.gitignore` 의 빗금 없는 `ios/` 패턴이 `docs/ios/` 를 통째로 삼켜서, 클론한
사람에게는 `CLAUDE.md` 가 가리키는 문서가 **아예 없었다.** 지금은 패턴이 `/ios/` 로
고쳐져 있고(그 위에 이 사고를 설명하는 주석이 있다), `git ls-files docs/ios` 가 이
디렉터리의 문서를 전부 보여 준다. `git check-ignore docs/ios/PROGRESS.md` 도 비어 있다.

`scripts/check-docs-links.py` 가 백틱으로 적은 docs 경로의 **존재와 추적 여부를 함께** 검사한다 —
같은 사고가 다시 나면 그 검사가 잡는다.
