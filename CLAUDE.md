# AlarmTalk — Claude Code 작업 노트

목소리 알람 앱(모노레포):
- `packages/backend` — Cloudflare Workers + Hono + Turso(libSQL). 라우트 `src/routes`, 마이그레이션 `src/lib/migrations.ts`.
- `packages/shared` — zod 스키마(`src/schemas`), 백엔드·클라 공용 계약.
- `apps/android-native` — Kotlin/Compose. dev/prod product flavor.
- `apps/ios-native` — SwiftUI. **2026-08-06 되살렸다**(브랜치 `feat/ios-revive`, 아직 미출시).
  탭 구성·화면 구성 모두 안드로이드와 같다(알람/목소리/더보기) — 「iOS 는 안드로이드를
  원본으로 삼는다」 절 참조. 빌드·테스트는 XcodeGen(`project.yml`)으로
  `AlarmTalkNative.xcodeproj` 를 만든 뒤 시뮬레이터에서 돌린다 — 상세는 `docs/ios/`.
  ⚠ 아직 App Store 에 없고 CI 워크플로도 복구하지 않았다. Apple 개발자 계정이 선행이다.
- `apps/landing` — 웹 랜딩.

## 배포 / 환경
- **dev 백엔드**: https://api-dev.alarm-talk.com — `develop` 푸시(=PR 머지) 시 자동 배포 + DB 마이그레이션(Deploy Backend 워크플로).
- **prod 백엔드**: https://api.alarm-talk.com — `main` 푸시 시 자동 배포 + DB 마이그레이션(같은 워크플로, 빌링 테스트용).
- ⚠ **prod DB 전체 초기화는 하지 않는다(2026-08-01 확정).** 베타 테스터 계정·데이터가 이미 들어 있다(대부분 무료 플랜).
  - 금지: DB 리셋·재생성으로 스키마를 맞추는 것. 스키마 변경은 **append-only 제자리 마이그레이션**으로만.
  - 허용: **안 쓰는 컬럼·인덱스는 실데이터가 있어도 `DROP`** 한다(그 컬럼 값만 사라지고 계정·알람 행은 보존된다). "어차피 지울 DB" 를 근거로 삼지는 말되, 사장 스키마를 남겨 둘 이유도 없다.
  - 순서: 되돌릴 수 없는 DDL 은 dev 배포로 먼저 검증하고 prod(`main`)는 그 뒤에 올린다.
- ⚠ **배포가 마이그레이션보다 먼저 돈다 — 새 컬럼을 쓰는 코드에는 창(window)이 있다.**
  마이그레이션은 **배포된 워커의** `POST /api/init-db` 로 실행된다(`scripts/run-remote-migrations.ts`).
  새 마이그레이션 코드가 워커에 올라가 있어야 돌릴 수 있으니 **순서를 뒤집을 수 없다** —
  CI 에 Turso 자격증명이 없어 DB 를 직접 마이그레이션하는 경로도 없다. 그래서 배포 직후
  최대 ~1분(워커 전파 대기 12회×5초 + 실행) 동안 **새 코드가 옛 스키마 위에서 돈다.**
  - **새 컬럼을 참조하는 경로는 반드시 fail-closed 로 둔다.** 컬럼이 없으면 트랜잭션이
    통째로 롤백돼 500 이 나야 한다 — 사용자는 재시도하면 되고 잃는 게 없다.
  - **"옛 스키마도 견디게" 만들지 말 것.** 쓰기 경로에서 새 컬럼만 빼고 진행하면 그
    한 번의 요청이 **영구히 잘못된 행**을 남긴다(예: 탈퇴 철회 기록 없이 계정만 삭제 →
    수신자 기기에 목소리 잔존). 재시도 가능한 실패를 영구 데이터 손실과 바꾸는 짓이다.
  - 읽기 경로는 클라가 이미 실패를 견디는지 확인한다(예: pull 의 `runCatching` → 그 회차
    건너뛰고 다음 주기 재시도).
  - 마이그레이션이 실패하면 워크플로가 **빨간불로 죽는다**(러너가 throw). 창이 조용히
    길어지지는 않는다.
- ⚠ **법무 문서 버전(`CURRENT_POLICY_VERSION`)은 앱 릴리스와 짝을 맞춰 올린다.**
  문서 전문은 **APK/IPA 에 실려** 있고(빌드 시 `docs/legal` 복사 → `BuildConfig.LEGAL_POLICY_VERSION`),
  앱은 그 값을 `document_version` 으로 보낸다. 서버가 먼저 올라가면
  `POST /user/consents` 가 **409 POLICY_VERSION_MISMATCH** 로 전부 거부하고, 앱은 그걸
  '업데이트 필요' 차단 화면으로 처리한다 — **받을 새 버전이 스토어에 없으면 신규 가입과
  재동의가 통째로 막힌다.**
  순서: 새 문서를 번들한 앱을 **스토어에 먼저 올린 뒤** 서버의 버전 상수를 main 에 머지한다.
  강제 업데이트로 구버전을 잘라낼 거면 `app-version.ts` 의 `minSupported` 상향도 **그 릴리스가
  게재된 뒤**여야 한다(안 그러면 받을 게 없는 강제 업데이트로 앱이 벽돌이 된다).
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
- ⚠ **`messageBelongsToCaller`(쓰기 허용)와 `GET /tts/messages/:id/audio`(읽기 허용)는 한 쌍이다 — 항상 같이 고친다.** 어긋나면 양방향으로 사고가 난다: 쓰기가 좁으면 **들리는데 저장이 안 되고**(공유 클론 프리셋 갈래 누락, 2026-08-05 실기기 재현 — 알람이 로컬에만 남고 서버 sync 가 계속 404), 쓰기가 넓으면 **저장은 되는데 받을 수 없는** 알람이 생긴다(소유자 플랜 게이트 누락, Codex #685). 현재 허용 갈래 셋: 본인 소유 / 시스템 스톡 프리셋 / 같은 플랜 그룹이 공유한 목소리의 프리셋 클립. 마지막 갈래는 **소유자가 유료일 때만** — `ON_HOLD/PAUSED` 는 회복형이라 그룹·`is_shared` 를 그대로 두고 `users.plan` 만 회수하므로(`resolvePlanAfterSuspend`), 플랜을 안 보면 오디오 라우트가 `VOICE_LOCKED_FREE_PLAN` 으로 막을 클립을 알람에 심게 된다. 판정은 SQL 에 목록을 베끼지 말고 `isPaidVoicePlan` 헬퍼로.
- **R2 object key**: 사용자 파생 세그먼트는 `encodeURIComponent`+새니타이즈 또는 JWT `sub`+`crypto.randomUUID()`로 생성(경로 조작 차단).
- **길이 상한은 서버에도 둔다.** 클라의 `take(n)` 은 앱을 거칠 때만 유효하다 — 직접 호출하면
  거대한 문자열이 조회·쓰기 트랜잭션까지 그대로 흘러간다(`POST /code/register` 가 실제로 그랬다).

### 입력 규칙은 한 곳에서만 (앱 1차 · 서버 2차)
같은 값에 규칙이 여러 개면 **가장 느슨한 경로가 실질 규칙**이 된다. 실제로 표시 이름이
가입 64자·trim 없음 / `PATCH /user/me` 30자 / 구글 로그인 무검증 으로 갈라져 있었다.

- **표시 이름**: `@alarmtalk/shared` 의 `DisplayNameSchema`·`normalizeDisplayName` 이 **글자
  규칙의** 유일 출처. 새 경로가 이름을 받으면 자체 `trim()`/`max()` 를 쓰지 말고 이걸 가져다
  쓴다. **외부 신원공급자(구글)가 준 이름도 외부 입력**이다.
- **길이는 필드마다 다르고, 그 값도 shared 에만 둔다**: 계정 닉네임 `DISPLAY_NAME_MAX_LENGTH`
  (30) / 목소리 프로필 이름 `VOICE_NAME_MAX_LENGTH`(50). 목소리 쪽이 긴 건 의도다 — 사람
  이름이 아니라 라벨("엄마 목소리(2024년 녹음)")이라 여유를 둔다. **글자 규칙은 둘이 같다.**
  앱에도 같은 값의 `DisplayNameMaxLength`·`VoiceNameMaxLength` 를 두고 리터럴을 쓰지 않는다 —
  앱이 더 느슨하면 서버에서 거절당하고, 더 빡빡하면 서버가 허용하는 이름을 못 쓴다.
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
- **말없이 자르지 말 것.** 상한에서 입력은 막되(`takeWithoutSplittingPairs`), 넘겨 치는
  순간 입력창 아래에 이유를 띄운다(`auth_error_name_too_long`). 항상 켜진 카운터(7/30)는
  넘기 전까진 알려 줄 게 없어 두지 않는다. 주의: 잘라서 돌려준 값을 IME 가 그대로 되돌려
  보내므로, 경고 플래그는 **상한과 정확히 같을 때 건드리지 않아야** 곧바로 꺼지지 않는다.
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

### 알람 권한 3종은 **필수** — 단 막는 건 알람 기능뿐 (Android)

`POST_NOTIFICATIONS` · `USE_EXACT_ALARM`(구형 기기는 `SCHEDULE_EXACT_ALARM`) ·
`USE_FULL_SCREEN_INTENT` 셋이 다 있어야 알람을 만들고·고치고·켤 수 있다
(`PermissionSnapshot.alarmReady`). 하나라도 빠지면 게이트가 뜨고, **우회 액션을 두지 않는다.**

- **막는 범위는 알람 기능뿐이다.** 목소리 등록·이용권 등록·설정은 권한과 무관하게 쓸 수
  있어야 한다. 앱 전체를 벽으로 막으면 설정에 다녀오는 왕복 중에 이탈한다.
- **게이트는 한 번에 하나씩**, 채워지면 다음 미허용 권한으로 자동으로 넘어가고 셋 다
  채워지면 스스로 닫힌다(`AlarmTalkApp` 의 `permissionGateRequest` LaunchedEffect).
- 실무상 팝업이 뜨는 건 알림 권한뿐이다 — 나머지 둘은 정식 알람 앱이라 시스템이 자동
  부여한다(`USE_EXACT_ALARM` 은 사용자가 회수도 못 한다). 그래도 코드에서 빼지 말 것:
  회수 가능한 구형 기기와 사용자가 설정에서 끈 경우가 남는다.

**정책과 문구를 섞지 말 것.** '필수로 요구한다' 는 우리 규칙이고, '없으면 어떻게 되는가'
는 안드로이드의 사실이다. 둘은 다르다:

| 빠진 권한 | 실제 결과 | 어떻게 말하나 |
| --- | --- | --- |
| 알림 | **울린다.** 알림·헤드업이 안 뜰 뿐이다 — `RingingService` 는 알림 권한을 보지 않고 소리·진동을 시작하며, 헤드업이 불가능하면(`ringingChannelCanShowHeadsUp()` false) 울림 화면을 직접 띄운다 | "알람 알림이 뜨지 않아요" |
| 정확한 알람 | `setAndAllowWhileIdle` 폴백으로 **울리되 수 분 늦을 수 있다** | "제때 울리지 않을 수 있어요" |
| 잠금 화면 | 소리는 나되 **잠금 화면을 못 덮는다** | "잠금 화면에 뜨지 않아요" |

**어떤 경우에도 "울리지 않아요" 라고 쓰지 말 것.** 셋 중 무엇이 빠져도 알람은 울린다.
안 울린다고 하면 사용자가 멀쩡히 울릴 알람을 없는 것으로 믿고 다른 알람을 또 맞춘다
(2026-08-04 에 "알림 권한 없으면 안 울린다" 로 잘못 적었다가 `RingingService` 코드로
반증됨 — Codex #671 P1). 그래서 **헤드라인은 언제나 남은 시간**이고, 무엇이 모자란지는
배너가 권한 이름과 함께 말한다.

**알람 행의 스위치는 저장된 `enabled` 에만 묶는다.** 권한이 모자라다고 꺼진 것처럼 그리면
탭이 '켜기' 가 되어 게이트가 뜨고 **끌 수가 없다**. 권한이 돌아오면 꺼진 줄 알았던 알람이
울리기도 한다(같은 리뷰 P1).

게이트 제목은 정책을 말하므로 권한별로 "…권한을 허용해야 알람을 설정할 수 있어요" 로
통일하고, 홈 화면은 위 표대로 **사실**을 말한다.

### 동의 화면 규약 — 미체크는 '철회'가 아니다 (백엔드 + 양 앱)

동의 화면은 **서버가 내려준 목록대로** 그리고 제출한다. 화면이 목록을 따로 들고 있으면
서버가 필수/선택을 바꿀 때 조용히 어긋난다.

| 서버 필드 | 뜻 | 클라가 하는 일 |
| --- | --- | --- |
| `collect` | 이번에 받아야 하는 유형 | **이것만** 그리고 **이것만** 제출 |
| `optional` | 체크 없이 통과하는 유형 | '선택' 으로 그리고 CTA 조건에서 뺀다 |
| `prechecked` | 이미 동의해 둔 유형 | **초기 체크 상태**로 쓴다 |
| `needs_consent` | 앱을 막는 게이트(필수 기준) | 화면 표시 판단에 쓰지 **말 것** |
| `needs_collection` | 화면을 띄워야 하나 | `showConsentScreen` 이 이걸 본다 |
| `sensitive_missing` | 목소리 라우트가 요구하는데 없는 동의 | 등록 화면 인라인 체크박스 |
| `has_prior_consent` | 개정 재동의인가 | 제목·부제 문구를 가른다 |

- ⚠ **`agreed=false` 를 무조건 철회로 읽지 말 것.** 민감 동의는 `optional` 이라 CTA 가 체크를
  요구하지 않는다. 이미 동의한 사람이 화면을 그냥 통과하면 false 가 제출되는데, 그걸 철회로
  처리하면 **ElevenLabs 보이스와 R2 원본이 영구 삭제된다.** 판별은 **지금 그 유형을 다시
  묻고 있었는가**(`collect` 포함 여부)로 한다 — 대상이면 기록만, 아무도 안 물었는데 온
  false 만 명시적 철회(설정 화면)다. `routes/user.ts` 의 `withdrewSensitiveConsent`.
- **초기 체크 상태는 `prechecked` 로 채운다.** 항상 미체크로 두면 위와 같은 이유로 기존
  동의(마케팅 수신·생체정보)가 조용히 사라진다. 미리 눌러 주는 게 아니라 **가진 것을
  보여주는 것**이다. 필수 유형은 서버가 담지 않는다.
- **'전체 동의' 는 필수 전용이다.** 선택까지 한 탭에 켜면 거절했던 사람이 한 번의 탭으로
  마케팅을 켜게 되어 개인정보보호법 제22조 구분 수령 취지에 어긋난다.
  `setAll` 과 `allChecked` 와 **마스터 행 표시 조건이 모두 같은 집합**을 봐야 한다.
- **마케팅 재유도**는 거절자에게 **다른 이유로 화면이 이미 뜰 때만** 함께 노출한다.
  마케팅만으로 화면이 뜨면 거절자는 그 화면을 영영 보게 된다. 앱 화면에서만 유도하고
  푸시·이메일로 권하지 않는다(그 메시지 자체가 광고성 정보로 평가된다).
- ⚠ **목소리 등록의 권리 보증은 체크박스가 아니다**(2026-08-06 변경). 그 내용은 **약관
  제7조**가 담고 있고 약관은 가입 필수 동의라 이미 받았다 — 등록마다 다시 받는 것은 계약상
  중복이었다. 화면에는 **비차단 안내**로만 남긴다. 되돌리려면 약관 제7조를 먼저 확인할 것.
  (생체정보 동의 체크박스는 그대로 — 서버 기록 기반 법정 동의라 성격이 다르다.)
- ⚠ **`CONSENT_MIN_POLICY_VERSION` 을 올리는 것이 재동의의 유일한 레버다.**
  `CURRENT_POLICY_VERSION`(문서 버전)이 올라도 재동의는 안 뜬다. 올릴 때는 **그 유형의 동의
  내용이 실제로 바뀐 경우만**, 그리고 **배포된 앱이 그 문서 버전을 번들한 뒤에** 올린다 —
  `POST /user/consents` 가 `document_version` 불일치를 409 로 막으므로, 구버전 앱은 화면은
  뜨는데 제출이 안 되는 상태에 갇힌다.

### 1회성 오버레이는 **확인이 끝난 뒤에만** 판단한다 (Android)

PR #660 에서 **같은 모양의 버그가 네 번** 나왔다(동의 → 버전 → 계정 상태 → 권한). 규약으로 고정한다.

문제의 형태: 게이트 상태(`updateRequired`·`pendingDeletion`·`needsConsent` …)는 서버 응답으로 채워지는데, **응답 전 기본값 `false` 가 '아니오' 와 구분되지 않는다.** 그 틈에 1회성 오버레이(웰컴 프로모, 첫 권한 안내)가 떠서 **소진 플래그까지 태우고**, 뒤늦게 응답이 와 차단 화면이 깔리면 그 위를 덮는다. 사용자는 본 적도 없이 잃고, 플래그는 계정/기기에 남아 앱을 업데이트해도 되살아나지 않는다.

- **소진되는 플래그를 태우는 오버레이는 관련 `checkXxx` 응답이 도착한 뒤에만 판단한다.** 현재 준비 신호 3종: `consentChecked`(`checkConsentStatus`) / `versionChecked`(`checkAppVersion`) / `accountStatusChecked`(`checkAccountStatus`). **iOS 도 같은 축이 필요하다** — `AuthViewModel.consentStatusChecked` 가 그 역할이고, 목소리 등록 폼이 이걸 봐야 응답 전에 동의 체크박스가 안 그려진 채 제출이 열리지 않는다.
- **준비 신호는 성공·실패 모두 `true`.** 못 물어본 것이 앱을 못 쓰게 할 이유는 아니다 — 네트워크 실패로 영영 `false` 면 그 오버레이는 영영 안 뜬다.
- **가드만 넣지 말고 `LaunchedEffect` 키에도 넣어야 한다.** 키에 없으면 응답이 도착해도 효과가 재실행되지 않아, 게이트가 풀린 뒤에도 오버레이가 안 뜬다.
- **계정별 신호는 세션 정리에서 `false` 로 되돌린다**(`clearUserScopedRemoteState` — `consentChecked`·`accountStatusChecked`). 앞 계정의 '확인 끝남' 이 새 계정에 새면 안 된다. 반면 `versionChecked` 는 앱·기기 단위라 되돌리지 않는다(계정이 바뀐다고 설치 버전이 바뀌지 않는다).
- ⚠ **되돌리는 건 세션 정리뿐이다 — 같은 계정을 재확인한다고 `false` 로 내리지 말 것.** `checkConsentStatus` 는 토큰이 바뀔 때마다 다시 도는데, 그때 내리면 이미 홈을 쓰던 화면이 로딩 게이트로 덮인다. 그 화면은 뒤로가기를 삼키므로 **그 동안 앱이 안 닫힌다**(2026-08-05 재현). 그래서 판정은 `consentStatusChecked`(이 계정 응답을 실제로 받았나)로 하고, 캐시(`isConsentCachedDone`)로 하지 않는다 — 받을 게 남은 계정은 완료 캐시가 영영 안 만들어져 매번 다시 덮인다.
- **로딩 게이트에는 `GateBackGuard` 를 두지 않는다.** 그 가드는 *화면에 정식 선택지가 있어서* 실수로 나가는 걸 막는 장치다. 응답을 기다리는 로딩 화면에는 지킬 선택지가 없고, 삼키면 네트워크가 느릴 때 뒤로가기가 죽은 것처럼 보인다.

### 저장 뒤 검은 화면 (회귀 방지)

`NavHostController.popBackStack()` 은 **마지막 남은 목적지까지 팝하고 `true` 를 돌려준다.** 백스택이 비면 NavHost 가 아무것도 안 그리고, `currentTab` 이 null 이 되며, 그걸 보는 `showAppChrome` 이 꺼져 하단바·＋FAB 까지 사라진다 — **되돌릴 수 없는 검은 화면**이다.

- `popBackStackOrHome()` 은 **바닥에서 팝하지 않는다**(`previousBackStackEntry == null` 이면 홈으로). 반환값으로 판단하지 말 것.
- 실제로 이걸 밟는 경로는 '두 번 팝' 이다: 저장은 비동기라 그 사이 저장/취소를 한 번 더 누르거나 시스템 뒤로가기를 누르면, 화면은 이미 팝됐는데 저장 완료 콜백이 또 팝한다.
- 그래서 **저장 중에는 버튼이 잠겨야 한다.** 편집기 로컬 플래그만으로는 부족하다 — 음성 생성 없이 저장하는 빠른 경로(알람 전용·녹음·오디오 재사용)는 편집기 입장에선 순식간이지만 뷰모델에는 Room 쓰기와 날씨 조회(네트워크)가 남아 있다. 판정은 언제나 `generating || saving`(`MainViewModel.alarmSaving`)이고, `alarmSaving` 은 **성공·실패 모두에서** 내린다(실패로 편집기가 남았는데 켜진 채면 다시 저장할 길이 없다).
- 새 게이트를 추가하면 **준비 신호도 함께 만든다.** 상태 하나만 추가하면 이 버그가 다섯 번째로 재현된다.

### 재생 방식은 **둘뿐**이고, 소리는 **첫 샘플부터 제 크기**다 (양 앱)

**재생 방식 = 알람 / 목소리.** '알람 + 목소리'(`alarm_voice`)를 되살리지 말 것.
- 안드로이드에서 그 모드는 톤이 울리고 **해제할 때** 목소리가 한 번 났는데, 알림을 밀어서
  없애면 건너뛰었다(`ACTION_DISMISS_SILENT`). 목소리를 들으려면 알람을 꺼야 하는 구조라
  발견 자체가 어려웠고 "목소리가 안 나온다" 문의가 반복됐다.
- iOS 는 AlarmKit 에 넘길 사운드가 **1개**라 '톤 먼저, 목소리 나중' 이 구조적으로 불가능했다.
  재생 코드도 `!= .alarmOnly` 하나로만 갈라져 '목소리만' 과 완전히 같게 동작했다 —
  픽커의 아이콘·설명만 달랐고 **없는 기능을 광고하고 있었다.**
- 저장된 옛 값은 **목소리로 읽는다**(`AlarmPlayModes.normalize` / `AlarmPlayMode.decode`).
  그 모드를 고른 사람은 목소리를 만들어 둔 사용자다 — 알람음으로 옮기면 애써 만든 목소리를
  못 듣게 된다. 서버 `wake_mode` 계약(`voice_only` vs `sound_then_voice`)은 그대로 둔다.

**페이드인을 다시 넣지 말 것.** 예전에는 첫 재생을 target 의 15%(하한 10%)에서 시작해
6초에 걸쳐 올렸다. 그 6초가 TTS 한 문장보다 길어 **문장 전체가 램프 구간**이었고, 첫 1초가
-16.5dB(체감 1/3)라 "소리가 안 난다" 로 읽혔다. 도입 커밋에 본문도 주석도 없어 무엇을
지키려던 것인지 아무도 알 수 없었다. 클릭 노이즈 걱정은 없다 — 게인은 `start()`/`play()`
**이전에** 확정된다.

**음량 규약**
- 하한은 **10%**, 0 은 슬라이더로 만들 수 없다. 0 은 '무음' 이라는 별개의 뜻이라 스위치로만
  표현한다 — 끝값으로 두면 실수로 닿아 알람이 조용히 안 울린다.
- ⚠ **곱하지 말 것.** 목소리 슬라이더 = 목소리 게인, 알람음 슬라이더 = 톤 게인. iOS 는 예전에
  둘을 곱했는데, 그 경로는 OS 톤을 함께 울리므로 알람 음량을 낮추면 **줄일 수 없는 톤은
  그대로인 채 목소리만 묻혔다** — 의도와 정반대다.
- **안드로이드는 울릴 때 기기 알람 볼륨을 맞춘다**(`AlarmStreamVolume`). `MediaPlayer.setVolume`
  은 스트림 볼륨에 곱해지는 상대값이라 기기 볼륨이 낮으면 100% 로 맞춰도 작게 울린다.
  ⚠ **원복이 그 클래스의 존재 이유다** — 원래 값을 올리기 **전에** SharedPreferences 에 적고,
  프로세스가 죽어도 다음 실행이 되돌린다. 안 그러면 사용자의 알람 볼륨이 영구히 고정된다.
- **iOS 에는 알람 음량 슬라이더를 두지 않는다.** AlarmKit 이 OS 톤을 소유해 아무것도 제어하지
  못한다. 못 움직이는 컨트롤을 두면 값을 바꿔 보고 저장하고 확인하기를 반복하게 된다.
- ⚠ **미리듣기는 울림과 같은 스트림(USAGE_ALARM)이어야 한다.** 기본값(USAGE_MEDIA)이면
  미리듣기는 미디어 볼륨, 알람은 알람 볼륨으로 나가 같은 설정인데 크기가 다르게 들린다 —
  폰으로 검증하는 사람이 문제를 영영 못 잡는다.

### 알람 편집기 기본값 = **직전 선택 유지** (회귀 방지)

새 알람 편집기의 목소리·문구 종류·무료 테마(버킷)는 **하드코딩 기본값이 아니라 그 계정이 마지막에 고른 값**이다. "기본값으로 초기화" 로 되돌리는 변경은 전부 회귀다 — 사용자가 반복해서 요청한 동작이고, 문서가 없어 여러 번 되돌아갔다.

- **단일 출처(둘 다 계정별 키, SharedPreferences)**
  - 목소리: `DefaultVoicePreferenceStore` (`default_voice_<userId>`). 클래스·키 이름의 `default_` 는 **이력상 남은 이름**이고 뜻은 last-used 다. 이름만 보고 사장된 저장소로 판단해 지우지 말 것.
  - 문구 종류·무료 테마·직접 입력 문구: `DynamicPromptPreferenceStore` (`last_message_context_<userId>`, `last_free_bucket_<userId>`, `last_manual_text_<userId>`).
- **기록 시점은 알람 저장 성공 시 한 곳뿐** — `MainViewModel.rememberVoiceUsed` / `rememberMessageChoiceUsed`(`MainViewModelAlarmActions` 의 create/update `onSuccess`). 편집기에서 눌러만 보고 취소한 것은 기억하지 않는다. 선택 즉시 저장하는 코드를 다시 넣지 말 것.
- ⚠ **버킷이 붙으면 `voiceRandomPrompt` 가 꺼진다 — 그때 문구 종류를 떨어뜨리지 말 것.** 이 규약이
  **가장 자주 깨진 지점**이다(2026-08-05 에도 재발). 저장 직전 `setBucketAudio` 가 사전렌더 클립을
  바인딩하면서 랜덤 생성을 끄는데, 유료 클론은 문구 5종이 **전부** 버킷으로 매핑되므로
  (`clonePrerenderBucketCategoryFor`) 사실상 **모든 저장**이 이 경로다. 그래서 `!voiceRandomPrompt`
  하나만 보고 판단하면 결과가 "가끔 안 된다" 가 아니라 "라이브 생성 폴백일 때만 된다" 가 된다.
  - 버킷/직접입력 판정식은 언제나 **`!voiceRandomPrompt && !isActiveBucketAlarm()`** 이고, 이걸 쓰는
    자리는 셋이다: 저장(`AlarmEditorState.toDraft`), 문구 pane 프리셀렉트(`AlarmEditorScreen` 의
    `random_prompt`), 요약 행·문구 프리필(`VoiceAudioCard`, `manualText`). **한 곳만 고치지 말 것** —
    2026-08-05 에는 요약 행만 맞고 저장·pane 이 틀려서, 행은 '사랑' 인데 눌러 열면 '직접 입력' 이었다.
  - 저장에서 종류를 잃으면 증상이 둘로 갈라져 보인다: **새 알람이 매번 '기본 인사말'** 이고,
    **그 알람을 다시 열면 '직접 입력'** 이다. 같은 원인이다.
  - 종류를 떨어뜨리던 시절의 옛 행은 종류가 null 이라, 열 때 `randomPromptContextForBucket(bucketId)`
    으로 되짚는다(`clonePrerenderBucketCategoryFor` 의 역 — 한쪽만 고치지 말 것).
  - `rememberMessageChoiceUsed` 는 값이 비면 **조용히 아무 일도 하지 않는다.** 그래서 이 버그는
    저장 시점이 아니라 한참 뒤 "새 알람이 매번 기본 인사말" 로만 드러난다. 회귀 테스트는
    `AlarmEditorStateTest`(저장 시 종류 보존·옛 행 복구·직접 입력은 그대로 null).
- **적용 대상은 새 알람뿐.** 기존 알람을 열 때는 저장된 자기 값만 쓴다(열기만 해도 문구가 바뀌면 안 된다). `AlarmTalkApp` 이 `lastMessageContext`/`lastFreeBucket` 을 **신규 라우트에만** 넘기고, 버킷 이어받기는 `alarm == null` 로 한 번 더 막는다.
- **목소리 프리셀렉트는 마지막에 쓴 것이 그룹보다 우선**(`VoiceAudioCard`). 그룹(내 클론 → 공유받은 → 기본)을 먼저 보면, 클론을 가진 사람이 기본 목소리를 골라 저장해도 매번 클론으로 되돌아간다.
- **한 번도 고른 적 없을 때만** 폴백: 문구는 `preset`(기본 인사말), 무료/기본 목소리 경로는 `FreeBucketOrder` 첫 값(약). `FreeBucketOrder` 는 최후 폴백 순서일 뿐 "항상 적용되는 기본값" 이 아니다.
- **직접 입력은 문구까지 기억한다**(2026-08-06 변경. 그전에는 아예 기억하지 않았다).
  - 바뀐 이유: 종류만 이어받으면 새 알람이 **빈 직접입력**으로 열려 저장이 막힌다 — 그게 예전에 '기억하지 않는다' 를 택한 실질적 근거였다. 문구를 함께 이어받으면 글자가 같아 `AlarmAudioStore` 입력 캐시에 걸려 **서버 호출도 월 한도 차감도 없이** 곧바로 저장된다(오프라인 포함). 근거가 사라졌으니 규칙도 바뀐다.
  - ⚠ **기억되는 값은 입력 원문이 아니라 서버 표시 문구다.** 알람에 저장되는 게 그 값이라서다(`setGeneratedTtsAudio` — 잠금화면 문구와 음성을 맞추려고 일부러 그렇게 한다). 번역이 켜진 기기(앱 언어 ≠ ko)에서는 둘이 갈라지므로, 생성 후 **표시 문구 키로도 `linkTtsInput` 을 남긴다**. 안 그러면 다음 새 알람이 표시 문구로 열려 입력 캐시를 빗나가고, 위의 '재생성·한도 차감 없음' 약속이 조용히 깨진다(Codex #685).
  - **마지막 선택은 하나다.** 생성형을 저장하면 `saveLastMessageContext` 가 직접 입력 기록을 **지운다** — 별도 '어느 쪽이 마지막' 플래그를 두지 않는다(플래그와 값이 어긋나는 상태 자체를 없앤다). 그래서 `last_manual_text` 가 차 있다 = 마지막이 직접 입력이었다.
  - ⚠ **요약 행에 문구를 반드시 함께 보여준다**(`MessageModeSummaryRow` 의 `manualText`). 생성형은 내용이 매번 새로 만들어져 틀릴 일이 없지만 직접 입력은 글자가 그대로다 — 안 보이면 어제 문구를 물고 온 새 알람을 알아챌 방법이 없다. 요약 행은 한 줄 말줄임, 전문은 문구 화면의 상세 카드에서 본다.
  - 기존 알람을 편집할 때는 당연히 자기 문구가 그대로 남는다(delivery 태그 제거가 이걸 깎아먹지 않도록 `DeliveryTags.kt` 는 **우리가 내보낸 태그만** 벗긴다).
- **이미 등록한 정보는 다시 묻지 않는다**(문구 화면). 날씨 지역·운세 사주·직접 입력 문구는 값이 **없을 때만** 고르는 순간 입력창이 뜬다. 이미 있으면 선택만 되고, 고치는 길은 리스트 아래 상세 카드의 '변경하기' 하나다(`RandomPromptDetailRow` 의 `onChange`). 이 액션을 지우면 등록한 값을 영영 못 바꾼다.
- **모달은 자기만 닫는다.** 날씨·운세·직접 입력 다이얼로그는 확인해도 문구 목록을 닫지 않는다(예전에는 확인이 곧 `onSaveSettings` 라 목록까지 닫혀, 도시 하나 바꾸려다 화면 밖으로 튕겼다). 최종 반영은 문구 화면의 저장 버튼 **한 곳**이다.
- **삭제는 명시적 로그아웃·탈퇴에서만**(`clearCurrentDefaultVoicePreferences`). 자동 401(`clearSessionKeepingAlarms`)에서 지우면 같은 사람이 다시 로그인할 때 취향을 잃는다(Codex #646 회귀).
- 이어받는 것은 **선택 값 하나**뿐이다. 회전 인덱스·클립 키(`bucketRotationIndex`/`bucketClipKeysJson` 등)는 알람별 상태라 절대 따라가지 않는다. 무료 버킷 **회전**(울릴 때마다 클립 순차 이동)과는 다른 축이라 서로 충돌하지 않는다.

### iOS 는 안드로이드를 **원본**으로 삼는다 (2026-08-06 전수 대조)

두 앱을 나란히 놓고 124건을 대조해 iOS 를 안드로이드에 맞췄다. 다시 갈라지지 않도록
고정할 규약만 남긴다. **화면을 만들 때 안드로이드 대응 파일을 먼저 열 것.**

- **주석의 '안드로이드 미러' 근거를 믿지 말고 확인할 것.** 이번에 틀린 근거가 여럿
  나왔다 — `WakerBrandHeader:156-166`(존재하지 않음), `StockClipDropdown`(없음),
  `editor_label_alarm_name`(문자열 자체가 없음), `AlarmTalkBottomBar.kt:117-121
  isDarkScheme 분기`(이미 없앤 옛 디자인), 타임휠 `itemHeight = 72.dp`(실제 92).
  **안드로이드가 이미 지운 화면을 베낀 주석이 그대로 남아 있었다.**
- **테스트가 틀린 값을 지키고 있을 수 있다.** 클론 최소 길이 60초, 진동 12종,
  "isDraft 는 더 이상 보내지 않는다(draft 플로우가 사라졌다)" — 셋 다 회귀 테스트가
  잘못된 상태를 고정하고 있었다. 서버 라우트와 안드로이드를 근거로 삼는다.
- **번역 카탈로그(`Localizable.xcstrings`)도 함께 고친다.** 소스만 고치면 en·ja 기기에
  옛 문구가 그대로 남는다.
- **iOS 가 안드로이드와 달라야 하는 곳은 딱 두 갈래다.**
  1. **AlarmKit 제약**: 울림 화면을 우리가 못 그린다(시스템 ALERT UI 소유). 알람 음량
     슬라이더도 두지 않는다 — 못 움직이는 컨트롤이라서. 대신 alert 제목과 Live Activity
     에 **시각**을 넣어 정보량을 맞춘다.
  2. **플랫폼 표준**: 확인 알럿은 시스템 `.alert` 를 쓴다(안드로이드의 `IosAlertDialog`
     이 그걸 흉내 낸 것이므로, iOS 에서 껍데기를 새로 만들면 오히려 원본에서 멀어진다).
  그 외에는 **다르면 iOS 가 틀린 것**으로 본다.
- **오디오 스테이징은 `AVAssetExportSession` 으로 하지 않는다.** `AVAssetExportPresetAppleM4A`
  는 `.caf` 를 못 내므로 staging 이 **항상** 실패하고, 잠금화면·앱 종료 상태에서 목소리가
  아예 안 울린다. `AVAssetReader`→`AVAssetWriter` 로 CAF(LPCM)를 직접 쓰고,
  `AVChannelLayoutKey` 를 반드시 넣는다(없으면 파일은 생기는데 열리지 않는다).
  회귀 테스트: `AlarmSoundStagingCapabilityTests`.
- **Keychain 저장 실패로 세션 반영을 버리지 않는다**(`AuthViewModel.persistSession`).
  저장에 실패하면 잃는 건 재시작 시 자동 로그인뿐이지만, 갱신을 버리면 rolling refresh
  가 죽어 90일 뒤 조용히 로그아웃된다.
- **화면 확인 모드**: `-UIPreviewSeed`(가짜 세션·알람·목소리) + `-UIPreviewTab
  alarms|voices|menu` + `-UIPreviewEditor` + `-UIPreviewAuthScreen login|register`.
  DEBUG 전용이고 서버·권한 팝업을 모두 건너뛴다. 시뮬레이터를 스크립트로 탭할 방법이
  없어서 만든 진입점이다.

## 진행 중 작업 (세션 재개 시 먼저 읽을 것)
현재 상태·폰 테스트 체크리스트·남은 follow-up: **[`docs/qa/dev-test-handoff.md`](docs/qa/dev-test-handoff.md)**.
