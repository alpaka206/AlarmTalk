# AlarmTalk iOS 되살리기 — 작업 지시 (2026-08-05 개정판)

당신은 이 레포의 iOS 앱을 되살린다. 사람은 자고 있고, 아침까지 혼자 진행한다.

> **이 문서는 개정판이다.** 이전 판은 `분석/00-권고안.md`·`CONTRACT-CHECKLIST.md` 와 정면으로
> 모순되는 지시가 13건 있었고(범위·순서·문구 규약), 사실 오류도 있었다. 아래 「결정된 것」이
> 그 모순을 사람이 직접 정리한 결과다. **분석 문서와 이 문서가 다르면 이 문서가 이긴다.**
> 분석 문서는 배경 지식으로만 읽고, 그 안의 권고("착수하지 마라", "Day 0 먼저") 는
> 이미 사람이 검토하고 뒤집었으니 그것 때문에 멈추지 마라.

---

## 결정된 것 (사람이 정했다 — 재논의 금지)

1. **Apple 로그인·인앱결제·법무문서 v5 를 이번 범위에 넣는다.** `CONTRACT-CHECKLIST.md` 의
   "이번 범위 밖" 문장은 무효다.
2. **과하게 설계하지 마라.** 되살리는 게 목표지 새로 발명하는 게 아니다. 옛 코드가 이미
   하던 방식을 그대로 쓰고, 추상화 계층을 새로 만들지 마라.
   — 이건 **구현 방식**에 대한 말이지 **범위**에 대한 말이 아니다. 아래 5번과 충돌하지 않는다.
5. **기능은 전부 되어야 하고, 디자인은 안드로이드와 동일해야 한다.** 사람이 명시적으로
   요구했다: *"모든 기능이 다 되도록. 디자인까지 완벽하게 동일하게, 세세한 기능들까지."*
   기능을 빼거나 "iOS 답게" 를 이유로 임의로 바꾸지 마라. 8단계를 읽어라.
   못 하는 것은 **줄이지 말고 `PROGRESS.md` 에 "막혔다" 로 적는다.**
6. **안드로이드는 절대 건드리지 않는다** — 아래 절대 규칙 2번. 사람이 다시 강조했다.
3. **법무문서는 한국어(`*.ko.md`)만 개정한다.** `docs/legal/` 에 en/ja 파일은 **존재하지 않는다**.
   **없는 문서를 새로 창작하지 마라** — 법적 효력이 있는 문서다.
4. **머지 시점은 사람이 정한다.** v5 개정은 머지하는 순간 안드로이드 베타 사용자까지 전원
   재동의가 걸린다. 브랜치 안에 있는 동안은 영향 0이다. `PROGRESS.md` 맨 위에 크게 적어라.

## 절대 규칙

1. **`git push` 금지. PR 금지.** 커밋은 자유롭게, 자주. 원격에 아무것도 올리지 않는다.
2. **`apps/android-native/` 를 한 줄도 수정하지 않는다.** 안드로이드는 1.2.3 을 막 출시했고
   prod 에 실사용자가 있다. 사람이 다시 강조한 항목이다.
   - **읽기 전용으로만 쓴다.** 안드로이드 소스는 디자인·기능·API 계약의 **기준 문서**이지
     작업 대상이 아니다. 값을 가져다 iOS 에 옮기는 것이지, 안드로이드를 iOS 에 맞추는 게 아니다.
   - 리팩터링·"공유 코어 추출"·오타 수정·주석 정리도 **전부 금지**. `CLAUDE.md` 의 안드로이드
     규약(예: 「"울리지 않아요" 라고 쓰지 말 것」)이 iOS 와 안 맞아도 **그 문서를 고치지 마라** —
     안드로이드에서는 그게 맞다. iOS 쪽에만 다르게 쓰고 이유를 `PROGRESS.md` 에 적어라.
   - iOS 때문에 안드로이드를 고쳐야 할 것 같으면 **설계가 틀린 신호다** — 멈추고 기록해라.
   - 커밋 전에 확인: `git diff --name-only develop | grep android-native` 가 **비어 있어야 한다.**
3. **백엔드 스키마 변경은 append-only.** DB 리셋·재생성 금지(prod 에 베타 테스터 실데이터).
   새 컬럼을 참조하는 코드는 **fail-closed**. `CLAUDE.md` 「배포가 마이그레이션보다 먼저 돈다」 절을 읽어라.
4. **커밋 메시지는 한국어.** `Co-Authored-By: Claude` / "Generated with Claude Code" 금지.
5. **막히면 멈추고 기록한다.** 추측으로 우회하지 마라. 현행 백엔드 계약의 기술서는
   `apps/android-native/app/src/main/java/com/alarmtalk/app/network/` (**15파일 2,105줄** —
   옛 문서의 "Api.kt 8개 1,391줄" 은 틀렸다. `AuthSessionStore.kt` 659줄이 가장 크다).
6. **사실만 적는다.** "됐다" 고 쓸 때는 근거(빌드 로그·테스트 결과)를 남긴다.
   **빌드가 안 되면 안 된다고 적는 것이 가장 값진 산출물이다.**

---

## 환경 — 이미 검증됐다 (2026-08-05 실측)

맥은 준비 끝났다. **설치할 것 없다.** 아래는 실제로 돌려서 확인한 값이다.

| | 확인된 값 |
|---|---|
| Xcode | 26.6 (17F113), `xcode-select` 설정 완료 |
| iOS SDK | 26.5 (device + simulator), `AlarmKit.framework` 양쪽에 존재 |
| 시뮬레이터 런타임 | iOS 26.5 (23F77) 설치됨 |
| 기기 | `iPhone 17 Pro` (`0733FD07-812F-4EC4-B149-B9A992E51F00`) 부팅됨 |
| XcodeGen | 2.46.0 (`project.yml` 그대로 generate 성공) |
| Swift | 6.3.3 |
| npm 의존성 | `npm ci` 완료 |

**참고 경로는 전부 맥 경로다.** 옛 문서의 `C:\Users\gyuwo\...` 는 전부 무시하고
`/Users/devrel/Desktop/AlarmTalk/...` 로 읽어라.

### 기준선 (건드리기 전 실측 — 이 숫자가 줄면 회귀다)

```
백엔드 vitest : 83 files, 1301 passed | 64 skipped
npm run lint  : 0 errors, 1 warning (voice-profile.ts:1392 no-console — 기존 것)
npm run typecheck : 통과 (shared / voice / landing / backend)
iOS 테스트    : 286 tests, 281 passed, 5 failed  ← 아래 4곳 수정 후 기준
```

---

## 시작

```bash
cd /Users/devrel/Desktop/AlarmTalk
git checkout develop && git pull
git checkout -b feat/ios-revive
git revert --no-commit 9f427c69     # 189파일 복원 → apps/ios-native/ (충돌 0, 검증됨)
git commit -m "revert: iOS 앱을 되살린다 (9f427c69 되돌리기)"
```

---

## 1단계. 첫 그린 빌드 — **이미 답을 안다. 4곳이다.**

> 옛 문서는 "34k줄이 한 번도 컴파일된 적 없다 / Swift 6 에러 수십~수백 건 각오" 라고 했다.
> **틀렸다.** 옛 `apps/ios-native/README.md` 의 *"not built in this **Windows** workspace"* 를
> 오독한 것이고, 이 코드는 GitHub Actions macOS 러너에서 빌드·테스트가 돌던 코드다
> (`3b8788d3 ci: iOS 시뮬레이터 빌드 워크플로 추가`, `0bb451f7 fix: iOS Swift 6 동시성 빌드 오류 정리`,
> `89988c16 fix/ios-ci-test-greenup` 등). 2026-08-05 에 실측한 결과 **에러는 4곳뿐이다.**

```bash
cd apps/ios-native && xcodegen generate
```

고칠 곳 (전부 Swift 6 격리 문제, Xcode 26.6 기준 실측):

| 파일:줄 | 에러 | 주의 |
|---|---|---|
| `AlarmTalk/AudioCacheStore.swift:88`, `:124` | `main actor-isolated static property 'shared' can not be referenced from a nonisolated context` | `nonisolated static func cache(tts:)` / `cacheStockClip(...)` 안의 `Self.shared.cacheBytes(...)` |
| `AlarmTalk/AlarmTalkApp.swift:232` | `pattern that the region-based isolation checker does not understand how to check` | `withTaskGroup` 안 `group.addTask { @MainActor in ... }`. **`-typecheck` 로는 안 잡히고 SIL 단계에서만 나온다** |
| `AlarmTalkTests/LocalHolidayCalendarLunarTests.swift:167` | `call to main actor-isolated static method 'epochDay(of:)' in a synchronous nonisolated context` | `test_epochDay_matchesSeedYmdClock` |

**`@MainActor` 를 떼는 방향으로 고치지 마라.** 셋 다 격리를 *유지한 채* 푸는 방법이 있고,
`AlarmTalkApp.swift:232` 는 시간대·시각 변경 시 알람 재예약 경로라 경쟁 상태가 생기면
증상이 "안 울림" 으로 나타난다. 어떻게 고쳤는지 `PROGRESS.md` 에 근거와 함께 남겨라.

### 빌드 명령 — 이걸 써라

```bash
xcodebuild -project AlarmTalkNative.xcodeproj -scheme AlarmTalk -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -skipPackagePluginValidation CODE_SIGNING_ALLOWED=NO build
```

- 생성되는 프로젝트 이름은 `AlarmTalkNative.xcodeproj` 이고 **스킴은 `AlarmTalk`** 다.
- `apps/ios-native/scripts/build-debug.sh` 는 destination 이 `generic/platform=iOS`(실기기)라
  **시뮬레이터 작업에 그대로 쓰면 안 된다.**
- 시뮬레이터 이름이 중복되면 `Unable to find a device ... multiple devices matched` 가 난다.
  **새 시뮬레이터를 만들지 마라** — 위 UDID 를 쓰면 안전하다.

**게이트**: `** BUILD SUCCEEDED **`.

## 2단계. 테스트

```bash
xcodebuild -project AlarmTalkNative.xcodeproj -scheme AlarmTalk -configuration Debug \
  -destination "id=0733FD07-812F-4EC4-B149-B9A992E51F00" -skipPackagePluginValidation \
  CODE_SIGN_IDENTITY="-" CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=YES \
  GENERATE_INFOPLIST_FILE=YES test
```

⚠ **`CODE_SIGNING_ALLOWED=NO` 로 테스트를 돌리지 마라.** 엔타이틀먼트가 안 붙어
`KeychainStore.saveSession` 이 `errSecMissingEntitlement` 로 죽는다. 위 ad-hoc 서명 조합이
정답이고, 이건 삭제된 `.github/workflows/ios-build.yml` 에서 복원한 검증된 명령이다
(커밋 `0d6c276c` 참고).

**현재 실측: 286 tests / 281 passed / 5 failed.** 기존 실패 5건:

- `LocalHolidayCalendarLunarTests`: `test_seollal_goldenVectors`, `test_substitute_goldenVectors`, `test_timezoneIndependence_extremeDeviceTimezones`
- `LocalAlarmRecordCodableTests.test_legacy17FieldJSONCompatibility`
- `VoiceStudioViewModelTests.test_isProfileLimitReached_andRemainingSlots`

**이건 하드 게이트가 아니다.** 한 번도 사람이 검토한 적 없는 기대값이라, 실패가 "코드 버그"
인지 "묵은 기대값" 인지 먼저 판별해라. **초록을 만들려고 단언을 고치지 마라** — 어느 쪽인지
판단하고 근거를 `PROGRESS.md` 에 적는 게 결과물이다. 281 아래로 떨어지면 그건 회귀다.

## 3단계. 백엔드 — 마이그레이션은 94부터

현재 최대 마이그레이션 id 는 **93** 이다(엔트리 개수는 88개, 11·12·13·33·49 는 결번).
94부터 붙인다.

- [ ] **#94 `push_tokens.platform` CHECK 에 `'ios'` 복구.** 지금 `CHECK(platform IN ('android','web'))`
      이라 DB 가 iOS 토큰을 거절한다(#88 이 좁혔다).
- [ ] **`lib/app-version.ts` iOS 분기.** `appVersionPolicy(_platform)` 이 인자를 무시하고 무조건
      Android 정책(min 21 / latest 23)을 돌려준다. iOS 는 `minSupported: 1` 로 시작한다.
- [ ] **Apple 로그인**: `POST /auth/apple` + `users.apple_id` 복구(#82 가 DROP 했다).
      앱이 준 identity token 을 **Apple JWKS(`https://appleid.apple.com/auth/keys`)로 검증**하는
      방식이라 **비밀키가 필요 없다.** `aud` = 번들 ID(`com.alarmtalk.app`),
      `iss` = `https://appleid.apple.com` 확인. 테스트는 JWKS 를 목킹해서 짠다.
- [ ] **Apple 결제**: `billing-apple.ts`, `store_transactions.provider` CHECK 에 `'apple'` 추가
      (지금 `CHECK(provider = 'google')`), `subscriptions` 의 apple 컬럼 3개 복구.
      **기존 구글 경로를 건드리지 마라.**

```bash
cd packages/backend && npx vitest run
```

**게이트**: 1301 passed / 64 skipped 이 줄지 않는다.

⚠ **마이그레이션은 이 브랜치에서 한 번도 실행되지 않는다**(push 금지 → dev 배포 없음, vitest 는
로컬 DB). "마이그레이션 완료" 라고 적지 말고 **"작성 완료, 미실행"** 이라고 적어라.

## 4단계. 법무문서 v5

- [ ] `docs/legal/privacy-policy.ko.md`, `terms-of-service.ko.md`, `store-disclosures.ko.md` 등
      **`.ko.md` 만** 개정 — Apple 결제·Apple 로그인 반영. 현행 v4 에 "Google Play 단일 결제" 가
      명시돼 있어 사실과 어긋나게 된다.
- [ ] `packages/backend/src/lib/consent.ts` 의 `CURRENT_POLICY_VERSION` `'4'` → `'5'`
- [ ] ⚠ `packages/backend/test/consent.test.ts:132` 의 `expect(CURRENT_POLICY_VERSION).toBe('4')`
      를 `'5'` 로 바꿔야 한다. **이건 "테스트 깨져서 고쳤다" 가 아니라 의도된 정책 변경이다** —
      커밋 메시지에 그렇게 적고 `PROGRESS.md` 에도 남겨라. 이 가드는 정책버전이 *실수로*
      올라가는 걸 막으려고 있는 것이다.
- [ ] `CONSENT_MIN_POLICY_VERSION` 6종은 현재 전부 `3` 이다. **v5 가 재동의를 요구하려면 이걸
      올려야 한다** — 올릴지 말지는 판단해서 `PROGRESS.md` 에 근거와 함께 적고, 애매하면
      건드리지 말고 물어라.
- [ ] 랜딩(`apps/landing`)이 `docs/legal` 을 빌드 시 읽어 게시하므로 함께 확인.

## 5단계. 계약 P0

`CONTRACT-CHECKLIST.md` P0. 핵심:

- `GET /user/me` → **`GET /auth/me`** (응답 형태 다름: `stats` 없음, `deletion_status`·`dynamic_prompt_settings` 추가)
- **rolling refresh** — `/auth/me` 가 주는 새 `token` 을 매번 갈아 끼운다. 빠뜨리면 90일 뒤
  조용히 로그아웃되고 소유자 게이트에 걸려 **알람이 사라진다.** (JWT TTL 은 7일→90일로 바뀌었고
  폐기는 만료가 아니라 `users.token_epoch` 로 한다.)
- `POST /user/consents` 에 `document_version` 필수 (4단계에서 5로 올렸으면 `'5'`)
- 표시 이름 규칙을 `packages/shared/src/schemas/auth.ts` 와 일치(30자·제어문자 제거·
  서러게이트 쌍 안 가르기). 옛 iOS 는 64자·trim 없음이라 서버가 거절한다.
  Swift `String` 은 grapheme 단위라 서러게이트 절단은 오히려 안전하다.
- `401 AUTH_USER_NOT_FOUND` 처리 — 자동 계정 생성이 없어졌다.
- Apple 로그인 클라 경로 복구(3단계에서 서버 준비됨). `KeychainStore.swift`·`NonceGenerator.swift` 그대로 쓴다.

**게이트**: 시뮬레이터에서 로그인 → 알람 목록 → 알람 생성 → 저장 → 목록 반영.

## 6단계. 계약 P1

`CONTRACT-CHECKLIST.md` P1 전부. 주의할 것:

- 삭제된 라우트 7개 호출부 제거(library / friend / gift / stats / family-invite / alarm-source / billing-apple).
  **`AlarmTalkAPI.swift`·`AlarmTalkAPIModels.swift`(1,014줄+)는 고치기보다 다시 쓰는 게 빠르다** —
  안드로이드 Retrofit 15파일을 보고 옮겨라. 1단계에서 이 파일들 에러를 붙잡고 있지 마라.
- `POST /billing/redeem` → **`POST /code/register`** (바우처·가족초대·프로모를 서버가 판별)
- `POST /family/alarms` → **`POST /family/alarms/voice`**
- `GET /alarm/tick`·`GET /alarm/:id` 제거 — **서버측 발사 판정 없음.**
- **`POST /alarm/:id/decline`** 는 원래부터 POST 였다. 없어진 건 **DELETE `/:id/decline`
  (그만받기 취소)** 다 — "메서드가 바뀌었다" 는 옛 문서의 오기. 지금은 한번 declined 되면
  API 로 되돌릴 수 없다.
- **`GET /alarm/declined`**: `alarm_ids`=**삭제** vs `revoked_alarm_ids`=**목소리만 제거** — 정반대 처리.
- FCM 타입 4종: `family_alarm` / `voice_share_changed` / `voice_access_revoked` / `plan_changed`.
  `voice_access_revoked` 를 무시하면 탈퇴자의 복제 목소리를 계속 들고 운다(음성 생체정보 파기 위반).
  ⚠ **옛 iOS 코드에는 푸시 구현이 0줄이다**(`registerForRemoteNotifications` 0건, Firebase 의존성 0).
  DB CHECK 를 고쳐도 iOS 푸시는 안 생긴다. APNs 키·Firebase iOS 앱 등록이 필요하고 **둘 다
  Apple 개발자 계정이 있어야 한다** → 밤새 못 한다. 클라 코드만 짜 두고 `PROGRESS.md` 에 적어라.
- `GET /tts/presets` 제거 → `GET /tts/stock-clips`
- 알람 필드 제거: `speaker_id`·`raw_audio_url`·`raw_audio_duration_ms` (내 알람 녹음은 폰에만)
- `bucket_id` 지원, `GET /voice/draft-quota` 소비, 동의 상태 신규 필드

## 7단계. 알람 발사 재설계 — **빠뜨리지 마라**

옛 문서가 작업 목록에서 누락했지만 **이게 P1 이다.**

**iOS 엔 발사 시점 코드 실행이 없다.** AlarmKit 은 해제 시점에만 `stopIntent` 가 돈다.
안드로이드가 `RingingService.kt:325` 에서 **울릴 때** 하던 것 —

- 유료 권한 재확인
- 무료 버킷 회전(울릴 때마다 클립 순차 이동)
- 당일 문구 갱신

— 을 **전부 예약/갱신 시점으로 옮겨야 한다.** "푸시가 유실돼도 울림 시점 게이트가 막아준다"
는 안전망이 iOS 엔 없다. 안 옮기면 **빌드·테스트·lint 가 전부 초록인데 조용히 오작동한다**
(플랜 만료된 계정이 클론 목소리로 계속 울고, 버킷 회전이 멈춰 매일 같은 클립).

또한 **번들 스톡클립 경로(2안)를 살려 둬라.** `Library/Sounds` 커스텀 사운드 경로(1안)는
Apple 이 known issue 로 답한 상태라 실기기 검증 전엔 믿을 수 없다. 옛 코드는 1안 기본 +
2안 폴백인데, **2안 경로를 지우거나 약화시키지 마라.** 30초 초과·트랜스코드 실패에서도 필요하다.

## 8단계. 디자인·기능 완전 일치 — **사람이 명시적으로 요구했다**

> 사람의 지시: **"모든 기능이 다 되도록. 디자인까지 완벽하게 동일하게, 세세한 기능들까지."**
> 이전 판은 "차이 0 을 목표로 삼지 마라" 고 적었는데 **그건 뒤집혔다.** 기본값은 **동일**이다.

`안드로이드-화면/` 스크린샷 12장이 1차 기준이지만 **스크린샷에 없는 화면·상태도 전부 맞춘다.**
스크린샷은 12장뿐이고 실제 화면·상태는 그보다 훨씬 많다 — **안드로이드 소스가 최종 기준이다.**

```bash
xcrun simctl io booted screenshot ~/Desktop/shot.png
```

**단일 출처 (여기서 값을 가져오고, 리터럴을 새로 박지 마라)**
- 색: `apps/android-native/.../ui/theme/AlarmTalkTheme.kt` 의 `colorScheme`
  (`surfaceContainer*` 5종 포함, 라이트·다크 양쪽)
- 모서리: `.../ui/components/WakerDesign.kt` 의 `Waker*Shape` 토큰 전부
- 탭 배경 그라데이션: `AlarmListScreen` 의 `HomeGradientDark/Light`
- 모달 규격: `CLAUDE.md` 「모달 = IosAlertDialog 하나」 — **안드로이드가 iOS UIAlertController 를
  베낀 것이므로 iOS 에서는 네이티브 알럿이 곧 정답이다.** 액션 높이·버튼 배치(2개 가로/3개 이상
  세로)·닫기(X) 없음·입력 필드 48dp 규칙까지 그대로.

**"세세한 기능" 에 반드시 포함되는 것** — 빠뜨리기 쉬운 것들이라 명시한다:
- 알람 편집기 last-used 기본값(목소리·문구종류·무료테마), **저장 성공 시에만** 기록, **새 알람에만** 적용
- 무료 버킷 회전(울릴 때마다 클립 순차 이동), 요일·공휴일 제외 로직, 음력 공휴일
- 스누즈 한도·직접 입력, 직접 문구 보존(delivery 태그는 **우리가 내보낸 것만** 벗긴다)
- 동의 상태 분기(`needs_consent`/`needs_collection`/`sensitive_missing`/`has_prior_consent`/`optional`)
- 가족 알람 수신·거절, 목소리 공유/철회, 탈퇴 철회 복구 화면
- 빈 상태·로딩·에러·오프라인 화면, 토스트·스낵바 문구
- **문구(카피)는 글자 하나까지 같게.** 한국어 원문이 기준이고 en/ja 는
  `Localizable.xcstrings`(789키, en·ja 100% 번역 완료)에 이미 있다.

**허용되는 유일한 예외 — OS 가 물리적으로 막는 것.** 그 경우에도 "iOS 답게" 를 핑계로
임의 변경하지 말고, **해당 항목마다** `PROGRESS.md` 에 `무엇을 / 왜 못 맞췄나 / 대신 무엇을 했나`
를 적어라. 실제로 예상되는 것:
- 뒤로가기 제스처(안드로이드 시스템 back ↔ iOS 스와이프)
- AlarmKit 이 노출하지 않는 것: 알람별 볼륨·페이드인·진동 패턴, 무한 반복 울림,
  알람음↔목소리 교차 재생, 우리 커스텀 울림 화면(딥네이비 풀스크린)
- 볼륨 버튼 동작(안드로이드 스누즈 ↔ iOS 해제)
- 30초 초과 문구(운세·편지형) — iOS 전용 축약본이 필요할 수 있다

이 예외들은 **이미 알려진 목록이다. 새로운 예외를 스스로 만들지 마라** — 못 맞추겠으면
줄이지 말고 `PROGRESS.md` 에 "막혔다" 로 적어라.

**시간을 정해 두고 끊지 마라.** 남은 시간을 여기에 써도 된다. 다만 화면 하나를 끝낼 때마다
커밋하고, 어디까지 대조했는지 `PROGRESS.md` 에 화면 단위 체크리스트로 남겨라.

## 9단계. 동작 규약 P2

- 알람 편집기 last-used 기본값(목소리·문구종류·무료버킷) — **저장 성공 시에만** 기록,
  **새 알람에만** 적용. `CLAUDE.md` 「알람 편집기 기본값 = 직전 선택 유지」 전문을 읽어라.
- 1회성 오버레이 준비신호 3종(응답 전에 소진 플래그 태우지 않기)
- 세션 정리 시 계정별 신호만 리셋

⚠ **권한 게이트 문구 — 여기가 안드로이드와 정반대다.**
`CONTRACT-CHECKLIST.md` P2 는 안드로이드 규약(「"울리지 않아요" 라고 쓰지 말 것」)을 iOS 로
옮기라고 하지만 **그건 틀렸다.** AlarmKit 권한을 거부하면 대체 경로가 없어 **정말로 안 울린다.**
iOS 권한 게이트는 **"알람이 울리지 않습니다"** 라고 정확히 말해야 한다. 안드로이드 문구표
(「알람 알림이 뜨지 않아요」 등)를 그대로 옮기면 거짓말이 되고, 사용자는 안 울릴 알람을
믿고 잔다. **안드로이드의 `CLAUDE.md` 규약을 고치려 들지도 마라** — 그쪽에선 그게 맞다.

---

## 반복 루프

전체가 아래를 만족할 때까지 돈다:

```bash
# 1. iOS
cd apps/ios-native && xcodegen generate
xcodebuild -project AlarmTalkNative.xcodeproj -scheme AlarmTalk -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -skipPackagePluginValidation CODE_SIGNING_ALLOWED=NO build
xcodebuild -project AlarmTalkNative.xcodeproj -scheme AlarmTalk -configuration Debug \
  -destination "id=0733FD07-812F-4EC4-B149-B9A992E51F00" -skipPackagePluginValidation \
  CODE_SIGN_IDENTITY="-" CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=YES \
  GENERATE_INFOPLIST_FILE=YES test

# 2. 백엔드·전체
cd /Users/devrel/Desktop/AlarmTalk/packages/backend && npx vitest run
cd /Users/devrel/Desktop/AlarmTalk && npm run lint && npm run typecheck
```

기준선(1301/64, lint 0 errors, typecheck 통과, iOS 281/286) 아래로 내려가면 회귀다.

## ⚠ `docs/ios/` 는 git 이 무시한다 — 놀라지 마라

`.gitignore:21` 에 **`ios/`** 라는 패턴이 있다(React Native 시절 잔재). 이게
`docs/ios/` 를 통째로 잡아서 그 안의 파일은 `git status` 에 안 나오고 `git add` 도 안 먹는다.

- **이건 의도된 상태로 둔다.** `.gitignore` 를 고치지 마라 — 사람이 "이 문서들이 굳이
  커밋에 들어가야 하나" 라고 했고, 무시되는 편이 그 뜻에 맞는다.
- `docs/ios/PROGRESS.md` 는 **로컬 파일로만 존재하면 된다.** 아침에 사람이 이 맥에서 직접 읽는다.
- **커밋된 줄 알고 넘어가지 마라.** "PROGRESS.md 커밋함" 같은 문장을 쓰지 마라.
- 확인됨: 이 패턴은 `apps/ios-native/` 는 **잡지 않는다**(189파일 전부 정상 추적).
  복원 커밋은 문제없다.

이미 `docs/ios/` 에 들어 있는 것: `BRIEF.md`(이 문서), `ENVIRONMENT.md`(실측 환경·기준선·
함정), `CONTRACT-CHECKLIST.md`, `분석/`, `안드로이드-화면/`(대조용 스크린샷 12장).

## 매 단계 끝에 `docs/ios/PROGRESS.md` 갱신

```markdown
## <단계> — <완료 | 부분 | 막힘>
했다: (근거와 함께 — 빌드 로그·테스트 숫자)
안 했다:
막혔다: (무엇이, 왜, 무엇이 있어야 풀리는지)
사람이 판단해야 하는 것:
```

**맨 위에 반드시 적을 것**: `⚠ 이 브랜치를 머지하면 정책버전 4→5 로 전원 재동의가 발생한다
(iOS 와 무관한 안드로이드 베타 사용자 포함). 머지 시점은 사람이 정한다.`

## 실기기가 필요한 것 — 코드는 두고 절차만 적어라

`docs/ios/DEVICE-SPIKE.md` 에 아래 절차만 적고 코드는 손대지 않는다:

1. **번들 동봉 `.caf` 가 재생되는가** ← **최우선.** X 면 무료 티어조차 성립하지 않는다.
2. `Library/Sounds` 에 런타임으로 쓴 `.caf` 가 `AlertSound.named` 로 재생되는가
   (Apple 이 known issue 라 답한 경로 — [포럼 798140](https://developer.apple.com/forums/thread/798140))
3. 커스텀 사운드가 반복되는가, 1회인가
4. 체감 볼륨이 실용적인가
5. 예약 → 앱 강제 종료 → 잠금 → 정시에 우는가

**Apple 개발자 계정이 Xcode 에 로그인돼 있지 않다.** 실기기 빌드·APNs·App Store Connect·
실제 Apple ID 로그인은 전부 계정이 있어야 하므로 밤새 검증 불가다. 아래는 계정 없이 되는 것:

- 인앱결제: `AlarmTalk/Configuration/StoreKitConfiguration.storekit` 로 **시뮬레이터 로컬
  StoreKit 테스트**가 계정 없이 된다(`project.yml` scheme 에 이미 연결돼 있다).
- Apple 로그인 서버 검증: JWKS 공개키 방식이라 비밀키 불필요 → 유닛테스트 가능.

### ★ 최우선 요구사항 — "계정만 만들면 바로 되는" 상태로 만들어라

사람이 아침에 Apple Developer Program(연 $99)에 가입한다. **가입 직후 값만 채워 넣으면
곧바로 동작하는 상태**가 이 작업의 완료 기준이다. 코드를 짜다 마는 것이 아니라,
**빠진 것이 오직 "계정에서 발급되는 값" 뿐**이어야 한다.

지켜야 할 것:

1. **계정에서 나오는 값을 코드에 하드코딩하지 마라.** 전부 설정/시크릿으로 빼라.
   - 백엔드: `wrangler.toml` 의 env + `.dev.vars.{dev,prod}` (기존 시크릿 관리 방식 그대로,
     `npm run secrets:sync:dev` 로 동기화된다). 새 키 이름은 `APPLE_` 접두사로 통일.
   - iOS: `DEVELOPMENT_TEAM` 은 이미 `project.yml:19-21` 에서 `$(DEVELOPMENT_TEAM)` 로
     비워 둔 채 주입받게 돼 있다. **그 구조를 깨지 마라** — 팀 ID 를 `project.yml` 에 박지 마라.
     `apps/ios-native/Local.xcconfig`(gitignore 대상) 같은 주입 지점을 만들고 예시 파일
     `Local.xcconfig.example` 을 커밋해라.
2. **값이 없을 때 죽지 말고 명확히 실패해라.** Apple 시크릿이 비어 있으면 `POST /auth/apple`
   은 500 이 아니라 "미설정" 을 분명히 알리는 에러로 떨어져야 하고, 기존 구글 로그인·결제
   경로는 **아무 영향 없이 계속 동작해야 한다.**
3. **`docs/ios/APPLE-ACCOUNT-SETUP.md` 를 써라.** 아침에 사람이 이것만 보고 따라 할 수 있어야
   한다. 순서대로, 클릭 경로까지. 최소한 아래를 포함:
   - Developer Program 가입 → Team ID 확인 위치
   - App ID 등록: 번들 ID `com.alarmtalk.app` / 위젯 `com.alarmtalk.app.widget`
     — 켜야 할 Capability: **App Groups, Sign in with Apple, Push Notifications**
   - App Group 생성: `group.com.alarmtalk.app.shared` (엔타이틀먼트와 정확히 일치)
   - Keychain Sharing 그룹: `com.alarmtalk.app.keychain`
   - Sign in with Apple: 서버 검증에 필요한 값이 무엇이고 **무엇이 필요 없는지** 명확히
     (네이티브 앱 플로우는 JWKS 검증이라 .p8 이 불필요하다 — 웹/서비스 ID 플로우와 헷갈리지 말 것)
   - APNs 키(.p8) 생성 → Key ID / Team ID → Firebase 콘솔 iOS 앱 등록 → `GoogleService-Info.plist`
     (⚠ 레포에 이 파일이 **없다**. iOS 푸시는 이것부터 시작이다)
   - App Store Connect: 앱 레코드 생성, 인앱결제 상품 ID — **`StoreKitConfiguration.storekit`
     안의 SKU 3개와 정확히 같은 ID 로 만들어야 한다.** 그 ID 목록을 문서에 그대로 옮겨 적어라.
   - 서버 영수증/트랜잭션 검증에 필요한 값(Issuer ID / Key ID / .p8)과 그것을 넣을 시크릿 이름
   - **각 항목마다 "이 값을 어디에 넣는가"** 를 파일 경로와 키 이름으로 적어라.
4. **넣을 자리를 미리 만들어 둬라.** 위 문서가 가리키는 시크릿 키·xcconfig 키·plist 자리가
   실제로 코드에 존재해야 한다. "나중에 만들면 된다" 는 안 된다.
5. 가능한 검증은 다 해 둬라 — JWKS 검증 유닛테스트(목킹), 로컬 StoreKit 구매 플로우
   시뮬레이터 확인, 백엔드 라우트 테스트. **무엇을 검증했고 무엇이 계정 대기인지**
   `PROGRESS.md` 에 나눠서 적어라.

## 참고 경로 (맥 절대경로)

- 현행 계약 기술서: `/Users/devrel/Desktop/AlarmTalk/apps/android-native/app/src/main/java/com/alarmtalk/app/network/` (15파일 2,105줄)
- 마이그레이션: `packages/backend/src/lib/migrations.ts` (최대 id 93, 94부터 추가)
- 정책버전: `packages/backend/src/lib/consent.ts` — `CURRENT_POLICY_VERSION`
- 앱 버전 정책: `packages/backend/src/lib/app-version.ts`
- 표시이름 단일 출처: `packages/shared/src/schemas/auth.ts`
- 무료 버킷 클립: `packages/backend/src/lib/stock-clips.ts` (시스템 보이스 4 × 12문구 × 3언어 = 144)
- 알람 규약: `AGENTS.md` 「알람 불변 규칙」, `CLAUDE.md` 전체
- 삭제된 iOS CI(검증된 빌드 명령 원본): `git show 78424780^:.github/workflows/ios-build.yml`

## 마지막

아침에 사람이 보는 것은 `docs/ios/PROGRESS.md` 하나다. 정직하게 적어라.
안 해 본 것을 했다고 적지 마라.
