# AlarmTalk — Claude Code 작업 노트

목소리 알람 앱(모노레포):
- `packages/backend` — Cloudflare Workers + Hono + Turso(libSQL). 라우트 `src/routes`, 마이그레이션 `src/lib/migrations.ts`.
- `packages/shared` — zod 스키마(`src/schemas`), 백엔드·클라 공용 계약.
- `apps/android-native` — Kotlin/Compose. dev/prod product flavor.
- iOS 앱은 없다. SwiftUI 앱(`apps/ios-native`)과 iOS 빌드 워크플로는 미운영이라 제거했다 — 재개 시 앱과 워크플로를 함께 되살린다.
- `apps/landing` — 웹 랜딩.

## 배포 / 환경
- **dev 백엔드**: https://api-dev.alarm-talk.com — `develop` 푸시(=PR 머지) 시 자동 배포 + DB 마이그레이션(Deploy Backend 워크플로).
- **prod 백엔드**: https://api.alarm-talk.com — `main` 푸시 시 자동 배포 + DB 마이그레이션(같은 워크플로, 빌링 테스트용).
- ⚠ **prod DB 전체 초기화는 하지 않는다(2026-08-01 확정).** 베타 테스터 계정·데이터가 이미 들어 있다(대부분 무료 플랜).
  - 금지: DB 리셋·재생성으로 스키마를 맞추는 것. 스키마 변경은 **append-only 제자리 마이그레이션**으로만.
  - 허용: **안 쓰는 컬럼·인덱스는 실데이터가 있어도 `DROP`** 한다(그 컬럼 값만 사라지고 계정·알람 행은 보존된다). "어차피 지울 DB" 를 근거로 삼지는 말되, 사장 스키마를 남겨 둘 이유도 없다.
  - 순서: 되돌릴 수 없는 DDL 은 dev 배포로 먼저 검증하고 prod(`main`)는 그 뒤에 올린다.
- **init-db 시크릿**: dev/prod 분리. GitHub `INIT_DB_SECRET_DEV`/`INIT_DB_SECRET_PROD`(**Repository** Actions secret)가 각 워커의 `INIT_DB_SECRET`(`.dev.vars.{dev,prod}` → `npm run secrets:sync:{dev,prod}`)과 일치해야 migrate 통과. 안 맞으면 404.

## Android dev 빌드 / 설치
- 빌드(Windows): `apps\android-native\gradlew.bat -p apps\android-native :app:assembleDevDebug`
- APK: `apps/android-native/app/build/outputs/apk/dev/debug/app-dev-debug.apk` (패키지 `com.alarmtalk.app.dev`, dev 백엔드 바라봄)
- 테스트폰 2대(`adb -s`): `R3CW300EZBA`(SM-S918N/S23 Ultra), `RF9R40323AP`(SM-A325N/A32). 설치: `adb -s <serial> install -r <apk>`
- adb/Gradle 데몬 소켓 바인딩 실패 시: `adb kill-server && adb start-server` 후 재시도.

## 컨벤션
- 커밋 메시지 **한국어**. Co-Authored-By: Claude / "Generated with Claude Code" **금지**.
- `develop`은 보호 브랜치(7개 필수 체크 — lint + backend·shared·voice 의 typecheck·test) → 직접 푸시 불가, **PR 필요**.
- **PR 에 `ci` 라벨을 붙여야 CI 가 돈다**(96804264). 라벨이 없으면 필수 체크 7개가 아예 실행되지 않아 "no checks reported" 상태로 머지가 막힌다. PR 을 올린 뒤 `gh pr edit <번호> --add-label ci` 를 잊지 말 것.

### 입력/SQL 보안 규약 (백엔드)
2026-07-01 입력·SQL 인젝션 전면 감사 결과 현행 코드는 이미 안전. 아래 패턴을 **회귀 방지 규약**으로 고정한다(신규 라우트 추가 시 코드리뷰 체크):
- **SQL은 항상 `?`-바인딩.** `db.execute({ sql, args })` 의 `sql` 문자열에 사용자 값을 `${}`/문자열 결합으로 넣지 **말 것**. 값은 예외 없이 `args` 배열로.
  - 동적 `${}`가 허용되는 경우는 **개발자 고정 조각뿐**: IN 절 플레이스홀더 생성기(`alarm-query.ts`의 `inPlaceholders` 등, 값 개수만큼 `?` 생성), 화이트리스트 컬럼 조각(`alarm-mutation.ts`의 `updates.push('col = ?')`), 고정 리터럴 절/테이블명. 컬럼/테이블명을 사용자 입력에서 파생하지 말 것.
  - LIKE 검색: 절은 `LIKE ?`, 패턴 `%${q}%`는 **값으로만** 만들어 `args`에 push하고, 와일드카드(`%`,`_`)는 `ESCAPE`로 이스케이프.
- **필터/식별자 검증 후 바인딩**: 식별자·날짜는 `lib/validate.ts`의 `UUID_RE`(`alarm-helpers.ts`·`tts.ts`·`voice-profile.ts`), `holiday.ts`의 `DATE_RE`처럼 형식 검증 후 `?`-바인딩.
- **페이지네이션 상한**: `limit`/`offset`은 `Math.min(...,100)`/`Math.max(...,0)`로 클램프 후 바인딩(신규 리스트 엔드포인트 필수).
- **요청 입력 검증**: 바디는 `@alarmtalk/shared` zod 스키마로 `safeParse`, 경로/쿼리 파라미터도 검증·바운드.
- **IDOR 방어**: 클라 제공 id/code는 조회·수정·삭제 전 소유권 확인(`WHERE ... AND user_id = ?` 게이트, cross-tenant 참조는 `*BelongsToCaller` 헬퍼). 예: `alarm-mutation.ts`의 `voiceProfileBelongsToCaller`/`messageBelongsToCaller`.
- **R2 object key**: 사용자 파생 세그먼트는 `encodeURIComponent`+새니타이즈 또는 JWT `sub`+`crypto.randomUUID()`로 생성(경로 조작 차단).
- **길이 상한은 서버에도 둔다.** 클라의 `take(n)` 은 앱을 거칠 때만 유효하다 — 직접 호출하면
  거대한 문자열이 조회·쓰기 트랜잭션까지 그대로 흘러간다(`POST /code/register` 가 실제로 그랬다).

### 입력 규칙은 한 곳에서만 (앱 1차 · 서버 2차)
같은 값에 규칙이 여러 개면 **가장 느슨한 경로가 실질 규칙**이 된다. 실제로 표시 이름이
가입 64자·trim 없음 / `PATCH /user/me` 30자 / 구글 로그인 무검증 으로 갈라져 있었다.

- **표시 이름(닉네임·목소리 이름)**: `@alarmtalk/shared` 의 `DisplayNameSchema`·
  `normalizeDisplayName`·`DISPLAY_NAME_MAX_LENGTH`(30) 가 유일 출처. 새 경로가 이름을 받으면
  자체 `trim()`/`max()` 를 쓰지 말고 이걸 가져다 쓴다. **외부 신원공급자(구글)가 준 이름도 외부 입력**이다.
- **앱 1차 방어선**: `ui/components/CodeRedeemField.kt` 의 `sanitizeUserText` /
  `sanitizeDisplayName` / `sanitizeRedeemCode`. 새 입력창은 `onValueChange` 에서 이걸 통과시킨다.
- **거르는 것**: 제어문자(로그·CSV 를 깨고 TTS 낭독을 망친다), 제로폭(U+200B~, U+FEFF —
  눈에 같아 보이는데 다른 값이라 사칭에 쓰인다), 양방향 제어문자(U+202A~, U+2066~ — 보이는
  글자 순서를 뒤집는다). 줄바꿈·탭은 **지우지 않고 공백으로** 바꾼다(지우면 `김`+개행+`규원`
  이 "김규원" 으로 붙어 없던 한 단어가 된다). 길이는 **정리한 뒤** 센다.
- **남기는 것**: 따옴표·세미콜론·하이픈 등 문장부호. "O'Brien" 은 정당한 이름이고, 막는 건
  주입 방어가 아니라 이름을 못 쓰게 하는 것이다 — 주입은 `?`-바인딩이 막는다.
- **자를 때 서러게이트 쌍을 가르지 말 것.** JS `slice`·코틀린 `take` 는 UTF-16 코드 유닛
  단위라, 29자 뒤에 이모지가 오면 상한 30에서 앞쪽 절반만 남아 깨진 문자가 그대로 DB·JWT 에
  실린다. 서버는 `clampDisplayName`(shared), 앱은 `takeWithoutSplittingPairs` 를 쓴다.
- **거부와 다듬기를 구분한다.** 사용자가 직접 친 값은 스키마로 거부해 알려 주고
  (`DisplayNameSchema`), 외부에서 받은 값(구글 이름·옛 스키마로 저장된 행)은 거부해 봐야
  알려 줄 사람이 없으니 다듬어 쓴다(`clampDisplayName`).
- 회귀 방지 테스트: `apps/android-native/.../InputSanitizerTest.kt`, `packages/shared/test/schemas.test.ts`.

### 디자인 토큰 (Android Compose)
새 화면/컴포넌트는 **생 리터럴 대신 토큰**을 가져다 쓴다. 단일 출처 두 곳:
- **모서리 반경**: `ui/components/WakerDesign.kt` 의 `Waker*Shape` 토큰이 유일 출처.
  - `WakerTileShape`(12, 작은 타일·아이콘박스·인라인배너) / `WakerChipShape`(14, 칩·세그먼트·작은카드/행) / `WakerInputShape`·`WakerButtonShape`·`WakerPanelShape`(18, 입력·버튼·표준 카드/패널) / `WakerCardShape`(22, 큰 카드·다이얼로그 컨테이너) / `WakerHeroShape`(24, 히어로 카드) / `WakerDialogShape`(28, 대형 다이얼로그) / `WakerPillShape`(999, 캡슐).
  - `RoundedCornerShape(n.dp)` 를 새로 박지 말 것. `MaterialTheme.shapes` 도 이 토큰에서 파생됨.
  - **예외(토큰화 안 함)**: `CircleShape`(원형 아바타/FAB/점), `AlarmRow` 스와이프 비대칭 shape, 타임휠 전용 컨테이너(34dp), `RingingActivity` 잠금화면 슬라이더/스누즈(26/21dp — 고정 팔레트 화면 전용 스케일), `IosAlertDialog` 컨테이너(14dp — iOS UIAlertController 복제 스펙, 아래 「모달」 절 참조).
- **색**: `theme/AlarmTalkTheme.kt` 의 `colorScheme` 가 유일 출처. 항상 `MaterialTheme.colorScheme.*` 로 소비, **생 `Color(0x…)` 금지**.
  - 오버레이 스크림은 `WakerScrimColor`(WakerDesign.kt) 사용.
  - **`surfaceContainer*` 5종을 비워 두지 말 것**(Lowest/Low/기본/High/Highest, 라이트·다크 양쪽). 우리가 직접 그리는 화면은 `surface` 를 쓰니 티가 안 나지만, **프레임워크가 그리는 팝업**(드롭다운 메뉴 등)은 이 역할을 읽는다 — 비워 두면 M3 기본 무채색 회흑이 네이비 화면 위에 회색 상자로 얹힌다(2026-08-04 실제 발생).
  - 문서화된 예외: `RingingActivity`(잠금화면 전용 고정 팔레트), 알림 팩토리(Notification accent), 랜딩/로그인 브랜드 비주얼, 탭 배경 그라데이션(`AlarmListScreen`의 `HomeGradientDark/Light` — 로그인 딥네이비 감성을 알람/목소리/더보기 탭 전체에 재현, 라이트/다크 2종).

### 모달 = `IosAlertDialog` 하나 (Android)

알럿 껍데기는 **하나뿐**이다: `ui/components/IosAlertDialog.kt`. 새 모달을 만들 때 M3
`AlertDialog` 를 직접 쓰거나 전용 껍데기를 새로 만들지 말 것 — 2026-08-04 정리 전에는
껍데기가 셋이었고(`IosAlertDialog` / `VoiceFormDialog` / 화면별 M3 `AlertDialog`), 폭·모서리·
버튼 높이·글자 크기가 조금씩 달라 화면을 옮길 때마다 다른 앱처럼 보였다.

- **입력이 있는 알럿도 이걸 쓴다.** `content` 슬롯(메시지와 버튼 사이)에 `IosAlertField` 를 넣는다.
  적용된 곳: 프로모 코드 등록·닉네임 수정·스누즈 직접 입력·직접 문구·목소리 이름 변경.
- **`IosAlertField` 를 M3 `OutlinedTextField` 로 바꾸지 말 것.** 시도했다가 되돌렸다 — M3 는
  최소 높이 56dp 라 알럿 안에서 비율이 깨진다(`IosAlertField` 는 48dp).
- **버튼 2개는 가로, 3개 이상은 세로.** iOS UIAlertController 규칙 그대로.
- **닫기(X)를 버튼과 같이 두지 말 것.** '건너뛰기'/'닫기' 와 같은 일을 하는 버튼이 둘이면
  어느 쪽이 취소인지 매번 읽어야 한다. 취소 동작은 액션 하나로만 낸다.
- **취소와 같은 일을 하는 버튼을 두 개 두지 않는다.** `PermissionGate` 는 '허용하기' 하나만
  둔다 — 바깥 탭·뒤로가기가 이미 취소라, 버튼을 또 그리면 눌러야 할 액션과 무게가 같아진다.
  (주의: 이 게이트는 **닫힌다.** `IosAlertDialog` 은 기본 `DialogProperties` 라 바깥 탭·
  뒤로가기가 `onDismiss` 를 부른다. '못 닫는 게이트' 로 만들려면 그 속성을 꺼야 하고,
  그러면 안드로이드의 표준 탈출구가 사라진다 — 지금은 일부러 열어 둔 쪽이다.)
- **글자 크기는 `IosAlertType` 한 곳에서만** 정한다(Title/Message/Field/Action). 개별 모달에서
  `fontSize` 를 새로 박지 말 것.
- **액션 높이 52dp** — 44dp 는 iOS 기준이고 안드로이드 최소 터치 타깃은 48dp 다.
- **폼(입력 여러 개 + 저장)은 알럿이 아니다.** 운세 정보·목소리 등록처럼 필드가 여러 개인
  것은 지금대로 폼 모달로 둔다 — 알럿으로 욱여넣지 말 것.

### 1회성 오버레이는 **확인이 끝난 뒤에만** 판단한다 (Android)

PR #660 에서 **같은 모양의 버그가 네 번** 나왔다(동의 → 버전 → 계정 상태 → 권한). 규약으로 고정한다.

문제의 형태: 게이트 상태(`updateRequired`·`pendingDeletion`·`needsConsent` …)는 서버 응답으로 채워지는데, **응답 전 기본값 `false` 가 '아니오' 와 구분되지 않는다.** 그 틈에 1회성 오버레이(웰컴 프로모, 첫 권한 안내)가 떠서 **소진 플래그까지 태우고**, 뒤늦게 응답이 와 차단 화면이 깔리면 그 위를 덮는다. 사용자는 본 적도 없이 잃고, 플래그는 계정/기기에 남아 앱을 업데이트해도 되살아나지 않는다.

- **소진되는 플래그를 태우는 오버레이는 관련 `checkXxx` 응답이 도착한 뒤에만 판단한다.** 현재 준비 신호 3종: `consentChecked`(`checkConsentStatus`) / `versionChecked`(`checkAppVersion`) / `accountStatusChecked`(`checkAccountStatus`).
- **준비 신호는 성공·실패 모두 `true`.** 못 물어본 것이 앱을 못 쓰게 할 이유는 아니다 — 네트워크 실패로 영영 `false` 면 그 오버레이는 영영 안 뜬다.
- **가드만 넣지 말고 `LaunchedEffect` 키에도 넣어야 한다.** 키에 없으면 응답이 도착해도 효과가 재실행되지 않아, 게이트가 풀린 뒤에도 오버레이가 안 뜬다.
- **계정별 신호는 세션 정리에서 `false` 로 되돌린다**(`clearUserScopedRemoteState` — `consentChecked`·`accountStatusChecked`). 앞 계정의 '확인 끝남' 이 새 계정에 새면 안 된다. 반면 `versionChecked` 는 앱·기기 단위라 되돌리지 않는다(계정이 바뀐다고 설치 버전이 바뀌지 않는다).
- 새 게이트를 추가하면 **준비 신호도 함께 만든다.** 상태 하나만 추가하면 이 버그가 다섯 번째로 재현된다.

### 알람 편집기 기본값 = **직전 선택 유지** (회귀 방지)

새 알람 편집기의 목소리·문구 종류·무료 테마(버킷)는 **하드코딩 기본값이 아니라 그 계정이 마지막에 고른 값**이다. "기본값으로 초기화" 로 되돌리는 변경은 전부 회귀다 — 사용자가 반복해서 요청한 동작이고, 문서가 없어 여러 번 되돌아갔다.

- **단일 출처(둘 다 계정별 키, SharedPreferences)**
  - 목소리: `DefaultVoicePreferenceStore` (`default_voice_<userId>`). 클래스·키 이름의 `default_` 는 **이력상 남은 이름**이고 뜻은 last-used 다. 이름만 보고 사장된 저장소로 판단해 지우지 말 것.
  - 문구 종류·무료 테마: `DynamicPromptPreferenceStore` (`last_message_context_<userId>`, `last_free_bucket_<userId>`).
- **기록 시점은 알람 저장 성공 시 한 곳뿐** — `MainViewModel.rememberVoiceUsed` / `rememberMessageChoiceUsed`(`MainViewModelAlarmActions` 의 create/update `onSuccess`). 편집기에서 눌러만 보고 취소한 것은 기억하지 않는다. 선택 즉시 저장하는 코드를 다시 넣지 말 것.
- **적용 대상은 새 알람뿐.** 기존 알람을 열 때는 저장된 자기 값만 쓴다(열기만 해도 문구가 바뀌면 안 된다). `AlarmTalkApp` 이 `lastMessageContext`/`lastFreeBucket` 을 **신규 라우트에만** 넘기고, 버킷 이어받기는 `alarm == null` 로 한 번 더 막는다.
- **목소리 프리셀렉트는 마지막에 쓴 것이 그룹보다 우선**(`VoiceAudioCard`). 그룹(내 클론 → 공유받은 → 기본)을 먼저 보면, 클론을 가진 사람이 기본 목소리를 골라 저장해도 매번 클론으로 되돌아간다.
- **한 번도 고른 적 없을 때만** 폴백: 문구는 `preset`(기본 인사말), 무료/기본 목소리 경로는 `FreeBucketOrder` 첫 값(약). `FreeBucketOrder` 는 최후 폴백 순서일 뿐 "항상 적용되는 기본값" 이 아니다.
- **직접 입력 문구는 기억하지 않는다** — 그 문구는 그 알람의 것이다. 단, 기존 알람을 편집할 때는 당연히 그대로 남아 있어야 한다(delivery 태그 제거가 이걸 깎아먹지 않도록 `DeliveryTags.kt` 는 **우리가 내보낸 태그만** 벗긴다).
- **삭제는 명시적 로그아웃·탈퇴에서만**(`clearCurrentDefaultVoicePreferences`). 자동 401(`clearSessionKeepingAlarms`)에서 지우면 같은 사람이 다시 로그인할 때 취향을 잃는다(Codex #646 회귀).
- 이어받는 것은 **선택 값 하나**뿐이다. 회전 인덱스·클립 키(`bucketRotationIndex`/`bucketClipKeysJson` 등)는 알람별 상태라 절대 따라가지 않는다. 무료 버킷 **회전**(울릴 때마다 클립 순차 이동)과는 다른 축이라 서로 충돌하지 않는다.

## 진행 중 작업 (세션 재개 시 먼저 읽을 것)
현재 상태·폰 테스트 체크리스트·남은 follow-up: **[`docs/qa/dev-test-handoff.md`](docs/qa/dev-test-handoff.md)**.
