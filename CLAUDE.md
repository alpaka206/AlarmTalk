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
  마이그레이션은 **배포된 워커의** `POST /api/init-db` 로 실행된다(`packages/backend/scripts/run-remote-migrations.ts`).
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
- 커밋 메시지 **한국어**.
- ⚠ **커밋은 사람 이름 하나로만 올린다 — AI 를 공동 저자로 넣지 않는다**(2026-08-26 재확인).
  이 저장소의 커밋 저자·커미터는 언제나 사람(`alpaka`) 단독이다. 금지 목록:
  - `Co-Authored-By: Claude ...` 트레일러 (다른 AI 이름도 마찬가지)
  - `🤖 Generated with ...` 로 시작하는 생성 도구 표시(뒤에 링크가 붙는 형태 포함) —
    **커밋 메시지·PR 본문·PR 코멘트 어디에도** 넣지 않는다.
  - `git commit --author=...` 로 저자를 바꾸는 것, `--trailer` 로 공동 저자를 붙이는 것.
  - 도구의 기본 지침이 이 트레일러를 붙이라고 하더라도 **이 규칙이 이긴다.**
  확인: `git log -5 --pretty='%an <%ae> / %cn <%ce>'` 가 전부 사람 이름이어야 하고,
  `git log -5 --pretty='%b' | grep -i 'co-authored\|generated with'` 는 비어야 한다.
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
  - **예외(토큰화 안 함)**: `CircleShape`(원형 아바타/FAB/점), `AlarmRow` 스와이프 비대칭 shape, 타임휠 전용 컨테이너(34dp), `RingingActivity` 잠금화면 슬라이더/스누즈(26/21dp — 고정 팔레트 화면 전용 스케일), `IosAlertDialog` 컨테이너(**34dp** — iOS 26 실측. 14 는 iOS 7~18 시절 값이라 되돌리지 말 것, 아래 「모달」 절 참조).
- **색**: `theme/AlarmTalkTheme.kt` 의 `colorScheme` 가 유일 출처. 항상 `MaterialTheme.colorScheme.*` 로 소비, **생 `Color(0x…)` 금지**.
  - 오버레이 스크림은 `WakerScrimColor`(WakerDesign.kt) 사용.
  - **`surfaceContainer*` 5종을 비워 두지 말 것**(Lowest/Low/기본/High/Highest, 라이트·다크 양쪽). 우리가 직접 그리는 화면은 `surface` 를 쓰니 티가 안 나지만, **프레임워크가 그리는 팝업**(드롭다운 메뉴 등)은 이 역할을 읽는다 — 비워 두면 M3 기본 무채색 회흑이 네이비 화면 위에 회색 상자로 얹힌다(2026-08-04 실제 발생).
  - 문서화된 예외: `RingingActivity`(잠금화면 전용 고정 팔레트), 알림 팩토리(Notification accent), 랜딩/로그인 브랜드 비주얼, 탭 배경 그라데이션(`AlarmListScreen`의 `HomeGradientDark/Light` — 로그인 딥네이비 감성을 알람/목소리/더보기 탭 전체에 재현, 라이트/다크 2종).
- **화면 전환**: `ui/app/AlarmTalkApp.kt` 의 `PushEnterTransition`·`PushExitTransition`·
  `PushPopEnterTransition`·`PushPopExitTransition` 네 짝이 유일 출처(220ms).
  - ⚠ **붙이는 자리는 `NavHost` 하나다 — 라우트마다 붙이지 말 것.** Navigation Compose 는
    들어오는 전환을 **목적지**에서, 나가는 전환을 **떠나는 화면**에서 가져온다. 하위 화면에만
    붙이면 탭 → 편집기에서 **편집기만** 밀려 들어오고 탭은 제자리에서 페이드해, 한 겹만
    움직이고 그 사이 두 화면이 겹쳐 비친다(2026-08-26 에 그렇게 두 번 만들었다).
  - **판정은 `isBottomBarTab()` 하나.** 하단바가 그리는 셋(알람·목소리·더보기)끼리는 페이드,
    나머지는 전부 push 다. 탭은 위계 없는 옆걸음이라 밀면 뒤로가기처럼 읽힌다.
    ⚠ **이용권·코드 등록은 `NativeTab` 값이어도 탭이 아니다** — 더보기에서 들어가는 하위
    화면이라 push 다(`navigateTopLevelTab` 이 그 둘만 `popUpTo` 없이 쌓는 것과 같은 이유).
  - 나가는 화면은 화면의 **1/4** 만 민다 — 전폭으로 밀면 되돌아올 때 튄다.
  - iOS 는 `NavigationStack` + `.navigationDestination` 의 **시스템 push** 를 그대로 쓴다
    (가장자리 스와이프 뒤로가기가 딸려 온다). 이 토큰은 그 결을 안드로이드에 맞춘 것이다.

### 디자인 토큰 (iOS)

같은 규약이 iOS 에도 적용된다. 값은 안드로이드와 **같은 숫자**다.

- **모서리 반경**: `AlarmTalkShapes`(환경 — `theme.shapes.*`) / `AlarmTalkTheme.Shape.*`(정적).
  둘은 같은 값이고, 환경을 안 받는 작은 시트·다이얼로그가 정적 쪽을 쓴다.
  - 매핑: `extraSmall`(12) / `small`(14 = `WakerChipShape`) / `medium`·`button`(18 =
    `WakerButtonShape`·`WakerInputShape`) / `card`(22 = `WakerCardShape`) / `large`(24) /
    `extraLarge`(28).
  - ⚠ **생 숫자(`cornerRadius: 14`)를 새로 박지 말 것.** 2026-08-07 전에는 iOS 가 47곳에서
    생값을 썼고, 안드로이드에 없는 10·16 같은 값이 섞여 **같은 카드가 화면마다 다른 반경**
    으로 그려졌다(카드 16 vs 22, 칩 10 vs 14).
  - **예외(토큰화 안 함)**: 진행바 채움처럼 4~8 짜리 장식 도형. 안드로이드에 대응이 없다.
- ⚠ **"안드로이드가 더 커 보인다" 는 대개 토큰이 아니라 기기 설정이다**(2026-08-17 실측).
  같은 토큰인데 두 기기가 다르게 그리는 이유는 둘이 겹친 것이다:
  - **안드로이드는 `sp` 라 시스템 글꼴 크기를 곱한다.** 테스트폰(SM-A325N)은
    `settings get system font_scale` 이 **1.1** 이었다. 실제로 1.0 으로 바꿔 재보니
    같은 글자의 높이가 80→74px, 68→63px 로 줄었다(≈8%, 되돌려 놓았다).
  - **iOS 는 반대로 설정을 아예 무시한다.** `AlarmTalkTypography` 가
    `Font.custom(_, size:)` 를 쓰는데 `relativeTo:` 가 없어 **Dynamic Type 을 따르지
    않는다.** 그 아이폰은 `preferredContentSizeCategory` 가 **M**(기본 L 보다 한 칸
    작음)이라 시스템 `.body` 는 16pt 로 그려지는데, 우리 글자는 그대로 17pt 다.
  즉 두 기기가 **두 칸 어긋난 채** 비교되고 있었다. **토큰을 깎아 맞추지 말 것** —
  그러면 1.0 인 기기에서 iOS 보다 작아지고, 사용자가 키운 글꼴을 앱이 도로 취소한다.
  맞춰 보려면 두 기기의 글자 크기 설정을 같은 칸에 두고 비교한다.
- **글자 크기가 자리를 넘칠 때**: 무조건 줄이지 않는다. 기준은 `WakerDesign.kt` 의
  `fitToWidthScale` 주석에 표로 있다 — **줄바꿈으로 흐를 수 없는 자리**(울림 시계·타임휠·
  하단 버튼 라벨)만 줄이고, 본문·제목·목록 행은 커지게 둔다. 전부에 걸면 사용자가 키운
  글꼴 설정을 앱이 도로 취소하는 셈이다.

### 입력 중 바깥을 누르면 입력이 끝난다 (양 앱)

**입력창을 누르는 것이 아니라면 어디를 누르든 편집이 끝난다**(2026-08-27 지시). 규칙은 두
쪽이고 **둘을 같이** 지켜야 한다 — 한쪽만 보면 반대편이 조용히 깨진다:
- 밖을 눌렀는데 키보드가 남으면 요청한 동작이 아니고,
- **입력칸을 눌렀는데 키보드가 내려가면 글자를 아예 못 친다.**

- **Android**: `ui/components/ClearFocusOnOutsideTap.kt` 의 `Modifier.clearFocusOnOutsideTap()`.
  ⚠ **`detectTapGestures` 로 만들지 말 것** — 그러면 입력칸 탭까지 부모가 받아 눌러도
  초점이 곧바로 풀린다. **Final 패스**에서 받는다.
  ⚠ **소비 여부로 가르지 말 것**(2026-08-28 정정). '아무도 소비하지 않은 탭' 만 받으면
  **버튼·슬라이더·목록 행을 눌렀을 때 키보드가 남는다** — 소비하는 건 입력칸만이 아니다.
  판정은 **입력칸이 스스로 찍는 표시**(`Modifier.textInputTapTarget()`, Initial 패스)로 한다.
  **새 입력칸에는 그 표시를 붙일 것** — 안 붙이면 그 칸을 눌러도 키보드가 내려간다.
  (읽기 전용 드롭다운 트리거처럼 입력칸이 아닌 것에는 붙이지 않는다.)
  ⚠ **뒤에 레이어를 까는 방식도 안 된다** — 스크롤 컨테이너가 탭을 소비해 닿지 않는다.
  거는 자리 다섯: `AlarmTalkApp`(본체) / `AuthBackdrop`(로그인·가입·비번재설정·동의) /
  `IosAlertDialog`(알럿은 **자기 창**이라 본체 제스처가 닿지 않는다) / `AlarmEditorScreen` /
  `VoiceProfileManagementPanel` 의 목소리 등록 `Dialog`(같은 이유 — 자기 창이다).
  ⚠ **새 `Dialog`·`ModalBottomSheet` 에 입력칸을 넣으면 거기에도 걸어야 한다.** 창이 다르면
  본체 제스처가 닿지 않는다 — 판정은 "그 입력칸이 본체 창 안에 있는가" 하나다.
- **iOS**: `KeyboardDismissGesture` — 창에 단 UIKit 탭 인식기가 **터치가 입력 컨트롤 위인지**를
  델리게이트에서 가른다(`cancelsTouchesInView = false`).
  ⚠ **`simultaneousGesture` 로 만들지 말 것** — 모든 탭에 함께 발화해 방금 focus 된 칸을
  도로 내려놓는다.
  ⚠ **`resignFirstResponder` 만으로는 부족하다.** `@FocusState` 를 쓰는 화면은 그 값이
  true 인 동안 SwiftUI 가 **곧바로 다시 focus** 한다 — `.alarmTalkEndEditing` 알림을 받아
  상태를 직접 풀어야 하고, 인라인 입력은 **칸 자체를 걷어내야** 한다(`TimeWheelPicker`).
- 회귀 테스트: `AlarmTalkUITests/TapOutsideEndsEditingUITests`.
  ⚠ 그 테스트에서 **타임휠 영역을 '바깥' 으로 고르지 말 것** — 거기 숫자를 누르면 입력이
  다시 열려서 고쳐도 실패한다(2026-08-27 에 그 좌표로 오판했다).

### 모달 = `IosAlertDialog` 하나 (Android)

알럿 껍데기는 **하나뿐**이다: `ui/components/IosAlertDialog.kt`. 새 모달을 만들 때 M3
`AlertDialog` 를 직접 쓰거나 전용 껍데기를 새로 만들지 말 것 — 2026-08-04 정리 전에는
껍데기가 셋이었고(`IosAlertDialog` / `VoiceFormDialog` / 화면별 M3 `AlertDialog`), 폭·모서리·
버튼 높이·글자 크기가 조금씩 달라 화면을 옮길 때마다 다른 앱처럼 보였다.

- **입력이 있는 알럿도 이걸 쓴다.** `content` 슬롯(메시지와 버튼 사이)에 `IosAlertField` 를 넣는다.
  적용된 곳: 프로모 코드 등록·닉네임 수정·스누즈 직접 입력·직접 문구·목소리 이름 변경.
- **`IosAlertField` 를 M3 `OutlinedTextField` 로 바꾸지 말 것.** 시도했다가 되돌렸다 — M3 는
  최소 높이 56dp 라 알럿 안에서 비율이 깨진다(`IosAlertField` 는 48dp).
- ⚠ **캡슐은 한 줄 칸에서만이다**(2026-08-20). `IosAlertField` 의 기본 모양은 `singleLine`
  으로 갈린다 — 캡슐 반경(999)은 실제로 **높이의 절반**으로 잘리므로, 직접 입력처럼
  `minHeight = 108` 인 여러 줄 칸에 그대로 쓰면 반경 54 짜리 좌우 반원이 된다. 실측 근거
  (iOS `UIAlertController` 입력칸 h=48·r=24)는 **한 줄 칸의 것**이다. 여러 줄은
  `WakerInputShape`(18).
- ⚠ **입력이 있는 알럿은 폼처럼 그린다**(2026-08-17). 순수 알럿과 두 가지가 다르다:
  **입력칸은 글자 여백(30)이 아니라 버튼 여백(16)** 을 쓰고(세로로 맞닿은 두 상자의 폭이
  다르면 그 어긋남만 눈에 걸린다), **제목·본문은 줄 수와 무관하게 왼쪽 정렬**이다(입력칸
  글자는 언제나 왼쪽에서 시작하는데 그 위만 가운데면 한 모달에 시작점이 둘이 된다).
  판정은 `content != null` 하나 — 순수 알럿은 예전 그대로(한 줄 가운데 / 여러 줄 왼쪽)다.
  **iOS 는 여기만 따라오지 못한다** — 시스템 `.alert` 라 정렬을 못 바꾸고, 바꾸겠다고
  껍데기를 새로 만들면 오히려 원본에서 멀어진다(위 「iOS 는 안드로이드를…」 절).
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
- **액션 높이 48dp** — 2026-08-11 시뮬레이터 실측값이다. 44 는 옛 iOS 기준이라 되돌리지 말 것.
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

### 동의 화면 규약 → [`docs/spec/consent.md`](docs/spec/consent.md)

⚠ **미체크를 철회로 읽지 말 것.** 민감 동의는 선택이라 그냥 통과해도 `agreed=false` 가
제출되는데, 그걸 철회로 처리하면 **ElevenLabs 보이스와 R2 원본이 영구 삭제된다.**
판별·필드 표·재동의 레버는 전부 스펙에 있다.

⚠ **한 번 받은 동의는 다시 묻지 않는다 — 약관이 바뀌어 다시 받아야 할 때만 예외**
(2026-08-26 확정). 앱을 처음 쓸 때 받았든 첫 목소리를 등록할 때 받았든 한 번이면 끝이고,
두 번째·세 번째 등록에서는 묻지 않는다. 판정은 **서버가** 한다(`collect`·`sensitive_missing`)
— 클라가 기억해서 숨기는 구조가 아니다. 짝 규칙은 **묻지 않은 것은 기록하지 않는다**.
- **문서 버전(`CURRENT_POLICY_VERSION`)을 올리는 것만으로는 아무도 다시 묻지 않는다.**
  재동의 레버는 `CONSENT_MIN_POLICY_VERSION` 하나이고, **그 유형의 동의 내용이 실제로
  바뀐 경우만** 올린다.
- **번호를 새로 태우는 기준은 "그 버전이 이미 `main` 에 있는가" 다.** 아직이면 그 번호의
  본문은 배포된 적이 없어 동의자가 0명이니 **제자리에서 고친다**(`docs/legal/README.md`).

### 1회성 오버레이·게이트 → [`docs/spec/gates-and-overlays.md`](docs/spec/gates-and-overlays.md)

⚠ **응답 전 기본값 `false` 는 '아니오' 가 아니다.** 그 틈에 1회성 오버레이가 뜨면
소진 플래그까지 태우고, 뒤늦게 온 차단 화면이 그 위를 덮는다 — 사용자는 본 적도 없이
잃는다. 같은 모양의 버그가 PR #660 에서만 네 번 났다. 준비 신호 목록은 스펙에 있다.

### 사용 기록은 **적는 것과 보내는 것이 다른 물건**이다 → [`docs/spec/usage-events.md`](docs/spec/usage-events.md)

⚠ **울림 경로에서 네트워크를 부르지 말 것.** 알람이 울릴 때 남기는 기록도 **로컬 큐에
적기만** 하고, 전송은 앱이 열릴 때·주기 워커가 한다. 이 앱의 첫 번째 원칙(OS 스케줄 +
로컬 오디오)이 깨지는 자리라 기록기와 전송기를 아예 갈라 두었다.

- `id` 는 **기기가 만든 UUID** 이고 서버 PK 다 — 재전송이 멱등이라 실패한 배치를 그대로
  다시 보낸다. 앱은 **성공한 배치만** 지운다.
- **문구 원문을 기록에 넣지 말 것.** 식별자만 넣는다 — 사본을 만들면 목소리 삭제·동의
  철회 때 지워야 할 곳이 하나 더 늘어난다.
- **보관 1년.** 이 숫자는 개인정보 처리방침 3장 표와 `USAGE_EVENT_RETENTION_DAYS` 두 곳에
  있고 **반드시 같아야 한다**(회귀 테스트가 고정한다).

### 에러 코드는 **계약**이다 → [`docs/spec/error-codes.md`](docs/spec/error-codes.md)

서버는 모든 4xx/5xx 에 `error_code` 를 싣고, 앱은 **그 코드로** 문구를 고른다. 목록의 단일
출처는 `packages/shared/src/schemas/error-codes.ts` 이고, 백엔드는 `jsonError`·`errorBody`
(`lib/api-error.ts`)로만 코드를 내보낸다 — `code` 가 `ErrorCode` 타입이라 목록에 없는 값은
컴파일이 막는다.

- ⚠ **이미 나간 코드의 이름을 바꾸지 말 것.** 스토어의 구버전 앱이 그 문자열로 분기한다 —
  이름을 고치면 그 분기가 통째로 죽는다. 새 코드를 **추가**하고 옛 코드를 한동안 함께
  내려보낸 뒤, 강제 업데이트가 끝난 회차에서 지운다.
- **기록은 전부, 경보는 골라서.** 나가는 모든 4xx/5xx 는 `middleware/errorCode.ts` 가 한 줄로
  남기고(`at: "api_error"`), Sentry 로는 `ALERTING_ERROR_CODES` + 5xx 만 올린다. 오타·형식
  오류까지 보내면 진짜 사고가 그 사이에 묻힌다.
- ⚠ **기록 지점은 응답 쪽 한 곳이다.** 라우트마다 손으로 심으면 새 라우트가 빠지고, 빠진
  줄도 모른다. 예전에는 **의도한 4xx 에 아무 흔적이 없어서**("한도로 막았다") 한도를
  조정할 근거조차 없었다.
- **앱의 문구 표는 두 앱이 짝이다**(`network/ApiErrorMessages.kt` / `APIErrorMessages.swift`).
  한쪽에만 코드를 더하면 같은 실패가 두 앱에서 다르게 읽힌다.

### Compose 콜백에 **지역 함수 참조**를 넘기지 않는다 (Android, 회귀 방지)

`onBack = ::saveResolvedSettings` 처럼 지역 `fun` 의 **참조**를 컴포저블 인자로 넘기면,
그 함수가 캡처한 **콤포지션 지역 `val` 이 첫 콤포지션 값으로 굳는다.**
함수 참조는 캡처가 달라도 서로 `equals` 라, Compose 가 "인자가 그대로" 로 보고 그
컴포저블을 **건너뛰기** 때문이다 — `BackHandler`·`WakerTopBar` 처럼 나머지 인자가 늘
같은 자리에서는 **매번** 건너뛴다. 람다(`{ ... }`)는 캡처가 바뀌면 인스턴스가 새로
만들어지므로 이 문제가 없다.

- 2026-09-06 실기기: 문구 화면에서 '약' 을 고르고 뒤로가기를 눌러도 **옛 종류(날씨)가
  저장됐다.** `draft*` 는 상태 델리게이트라 최신인데 정규화 결과만 굳어 있었고, 화면은
  '약' 이 선택된 채였다 — 고른 것이 **아무 말 없이 사라지는** 증상이라 발견이 늦었다.
- 규칙 둘: **콜백 안에서 값을 다시 계산한다**(`resolvedContext()`), 넘길 때는 **람다로**
  감싼다(`onCheckedChange = { setAll(it) }`).

### 저장 뒤 검은 화면 (회귀 방지)

`NavHostController.popBackStack()` 은 **마지막 남은 목적지까지 팝하고 `true` 를 돌려준다.** 백스택이 비면 NavHost 가 아무것도 안 그리고, `currentTab` 이 null 이 되며, 그걸 보는 `showAppChrome` 이 꺼져 하단바·＋FAB 까지 사라진다 — **되돌릴 수 없는 검은 화면**이다.

- `popBackStackOrHome()` 은 **바닥에서 팝하지 않는다**(`previousBackStackEntry == null` 이면 홈으로). 반환값으로 판단하지 말 것.
- 실제로 이걸 밟는 경로는 '두 번 팝' 이다: 저장은 비동기라 그 사이 저장/취소를 한 번 더 누르거나 시스템 뒤로가기를 누르면, 화면은 이미 팝됐는데 저장 완료 콜백이 또 팝한다.
- 그래서 **저장 중에는 버튼이 잠겨야 한다.** 편집기 로컬 플래그만으로는 부족하다 — 음성 생성 없이 저장하는 빠른 경로(알람 전용·녹음·오디오 재사용)는 편집기 입장에선 순식간이지만 뷰모델에는 Room 쓰기와 날씨 조회(네트워크)가 남아 있다. 판정은 언제나 `generating || saving`(`MainViewModel.alarmSaving`)이고, `alarmSaving` 은 **성공·실패 모두에서** 내린다(실패로 편집기가 남았는데 켜진 채면 다시 저장할 길이 없다).
- 새 게이트를 추가하면 **준비 신호도 함께 만든다.** 상태 하나만 추가하면 이 버그가 다섯 번째로 재현된다.
- ⚠ **잠그는 것은 '저장 중' 일 때뿐이다.** '저장할 수 없는 사유' 로는 버튼을 죽이지 않는다 — 항상 누를 수 있게 두고, 누르면 **왜 안 되는지 알럿으로 말한다**(`SaveBlockReason`). 죽은 버튼은 이유를 알려 주지 않아 고장으로 읽힌다. 상세는 [`docs/spec/alarm-editor.md`](docs/spec/alarm-editor.md).

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

⚠ **'끌 때까지 반복' 같은 선택지를 두지 않는다**(2026-08-27 지시). 목소리는 **항상 반복**한다 —
한 번 나고 그치면 그것은 알림이지 알람이 아니다. 저장값(`voiceRepeat`)은 계속 true 로
왕복시키되 화면에는 컨트롤을 두지 않는다(양 앱).

**커지게 만들지 말 것 — 페이드인도, 반복 증폭도.** 예전에는 첫 재생을 target 의 15%(하한 10%)에서 시작해
6초에 걸쳐 올렸다. 그 6초가 TTS 한 문장보다 길어 **문장 전체가 램프 구간**이었고, 첫 1초가
-16.5dB(체감 1/3)라 "소리가 안 난다" 로 읽혔다. 도입 커밋에 본문도 주석도 없어 무엇을
지키려던 것인지 아무도 알 수 없었다. 클릭 노이즈 걱정은 없다 — 게인은 `start()`/`play()`
**이전에** 확정된다. 같은 커밋에 있던 **반복 증폭**(두 번째 재생부터 `LoudnessEnhancer`
+6dB)도 2026-08-27 에 지웠다 — 실기기 로그(`Enabled repeat voice loudness enhancer
gainMb=600`)로 확인했고, 사용자가 맞춘 음량이 첫 회만 지켜지는 것은 그 음량이 아니다.

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
  ⚠ **그때 넘기는 퍼센트에 슬라이더를 쓰지 말 것 — 곱셈이 된다**(2026-08-28 정정).
  슬라이더는 이미 **플레이어 게인**으로 걸리므로(`applyAlarmToneVolume`·`applyVoiceVolume`),
  스트림에도 같은 값을 넘기면 두 번 곱해진다 — 목소리 10% 알람이 낮은 기기 볼륨 위에서
  ~1% 가 되어 **안 들린다.** 스트림은 **중립(가득)** 으로 올리고 크기는 게인 한 곳에서만
  정한다. (하루 전 여기에 반대로 적었다가 리뷰에서 잡혔다. "목소리 크기가 안 먹는다" 의
  실제 원인은 스트림이 아니라 **반복 증폭**이었다 — 아래 문단.)
- **iOS 에는 알람 음량 슬라이더를 두지 않는다.** AlarmKit 이 OS 톤을 소유해 아무것도 제어하지
  못한다. 못 움직이는 컨트롤을 두면 값을 바꿔 보고 저장하고 확인하기를 반복하게 된다.
- ⚠ **미리듣기는 울림과 같은 스트림(USAGE_ALARM)이어야 한다.** 기본값(USAGE_MEDIA)이면
  미리듣기는 미디어 볼륨, 알람은 알람 볼륨으로 나가 같은 설정인데 크기가 다르게 들린다 —
  폰으로 검증하는 사람이 문제를 영영 못 잡는다.

### 동작 스펙은 **`docs/spec/`** 에 있다 (양 앱 + 백엔드 공통)

⚠ **화면 동작·규칙을 고치기 전에 거기부터 읽는다.** 플랫폼마다 문서를 따로 두다가 같은
규칙이 세 벌로 갈라졌고, 갈라진 줄 모른 채 한쪽만 고쳐 사고가 반복됐다. 이제 **동작은
스펙이 유일 출처**이고 코드는 구현이다 — 다르면 구현이 틀린 것이다.

| 스펙 | 다루는 것 |
| --- | --- |
| [`docs/spec/alarm-ringing.md`](docs/spec/alarm-ringing.md) | 울릴 때 전체화면/알림 판정, 스와이프=해제, 소리·음량, 권한별 사실 |
| [`docs/spec/alarm-editor.md`](docs/spec/alarm-editor.md) | 편집기 — 타임휠(튕기면 굴러간다·숫자 탭은 **그 자리 입력**), 재생 방식 세그먼트, 모달 **세 형태** |
| [`docs/spec/voice-and-message.md`](docs/spec/voice-and-message.md) | 재생 방식 2택, **문구 목록은 하나**(등급으로 안 자른다), 직전 선택 유지, 버킷 선다운로드 |
| [`docs/spec/plan-gates.md`](docs/spec/plan-gates.md) | 로그인·이용권 게이트 **3상태**와 상태별 액션 |
| [`docs/spec/session-and-auth.md`](docs/spec/session-and-auth.md) | 로그인 유지 — TTL 365일 + **백그라운드 갱신**, 끊는 경우 |
| [`docs/spec/billing-lifecycle.md`](docs/spec/billing-lifecycle.md) | 구독 해지·만료 — **스토어가 권위**, 애플은 서버가 못 끊는다 |
| [`docs/spec/family-alarm.md`](docs/spec/family-alarm.md) | 가족 알람 — **보내면 끝**(보낸 알람 수정은 서버가 409 로 거절, 완화 금지), 받은 뒤엔 **전부 받은 사람 것**, 단 **다시 보내면 새 것이 이긴다**, 설정 불가능 시간은 **자동 생성 금지** |
| [`docs/spec/consent.md`](docs/spec/consent.md) | 동의 화면 — **미체크 ≠ 철회**, 재동의 레버 |
| [`docs/spec/gates-and-overlays.md`](docs/spec/gates-and-overlays.md) | 게이트·1회성 오버레이의 **준비 신호** |
| [`docs/spec/alarm-lifecycle.md`](docs/spec/alarm-lifecycle.md) | 알람의 **행 vs 예약** 두 겹, 계정을 떠날 때 끄기, `.failed` 낙인 규칙 |
| [`docs/spec/usage-events.md`](docs/spec/usage-events.md) | 사용 기록 — **울릴 때 네트워크 금지**(로컬에 적고 나중에 전송), 재전송 멱등, 보관 1년 |
| [`docs/spec/error-codes.md`](docs/spec/error-codes.md) | 에러 코드 — **목록은 하나**(shared), 나간 코드는 **바꾸지 않는다**, 기록은 전부·경보는 골라서 |

각 스펙 문서 끝에 **「구현 지도」** 표가 있다 — 규칙 한 줄이 세 구현의 어디에 사는지
적어 둔 것이라, **한 곳만 고치는 사고**를 막는다. 동작을 바꾸면 스펙을 먼저 고친다.

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
  - ⚠ **질문이 셋이고, 각각 이름이 하나다**(2026-09-02 정리). 예전에는 이 셋을 호출부마다
    `!voiceRandomPrompt && …` 로 **손으로 조립**했고, 그래서 철자가 셋으로 갈라져 여덟 자리에
    흩어졌다 — 같은 사고가 다섯 번 재발했다(2026-07-21·08-05·08-12·08-16·08-31).
    이제 조립하지 말고 **이름을 부른다**(`AlarmEditorState`):

    | 질문 | 이름 | 재생 방식을 보는가 | 클립 바인딩을 보는가 |
    | --- | --- | --- | --- |
    | 울릴 때 클립을 쓰는가 | `isActiveBucketAlarm()` | ✅ | ✅ |
    | 지금 클립이 묶여 있는가 | `hasBucketMessageChoice()` | ❌ | ✅ |
    | 종류를 골랐는가 | `hasChosenBucketKind()` | ❌ | ❌ |

    조립본도 이름이 있다: **표시**는 `isManualForDisplay()`, **저장**은 `isManualForSave()`,
    **저장 갈래 가르기**는 `hasMessageKindChoice()`, **직접입력을 실제로 쳤는가**는
    `hasTypedManualText()`. 호출부에서 `!voiceRandomPrompt && …` 를 새로 쓰지 말 것.
  - ⚠ **표시와 저장은 답이 다를 수 있다**(2026-08-16 분리). `isActiveBucketAlarm()` 은 첫 줄에서
    `playMode == ALARM_ONLY` 면 false 다 — "**울릴 때** 클립을 쓰는가" 로는 맞지만, 그걸
    **문구 종류 표시**에 쓰면 재생 방식을 '알람' 으로 바꾸는 것만으로 요약 행이 `약` →
    `직접 입력` 으로 뒤집힌다(실기기 확인: `bucket=medication` 은 그대로인데 `active` 만 false).
    그래서 표시는 `isManualForDisplay()`, 저장은 `isManualForSave()` 다.
    회귀 테스트 `AlarmEditorStateTest.alarmModeDoesNotChangeChosenMessageKind`.
  - **iOS 도 같은 규약이다.** 대응 판정식은 `AlarmEditorSheet.currentMessageContext` 의
    `!randomPrompt && !isActiveStockClipAlarm` 이고, 저장은 `saveFlow` 의 스톡 분기다.
    ⚠ iOS 는 2026-08-12 까지 그 저장이 `voiceRandomContext = nil` 로 **종류를 통째로 버렸다** —
    안드로이드에서 네 번 난 사고를 iOS 는 처음부터 깔고 있었다. 역매핑
    `RandomPromptContext.forBucket` ↔ `bucketCategory` 는 **한 쌍**이고 회귀 테스트는
    `MessageContextMemoryTests`.
  - 저장에서 종류를 잃으면 증상이 둘로 갈라져 보인다: **새 알람이 매번 '기본 인사말'** 이고,
    **그 알람을 다시 열면 '직접 입력'** 이다. 같은 원인이다.
  - 종류를 떨어뜨리던 시절의 옛 행은 종류가 null 이라, 열 때 `randomPromptContextForBucket(bucketId)`
    으로 되짚는다(`clonePrerenderBucketCategoryFor` 의 역 — 한쪽만 고치지 말 것).
  - `rememberMessageChoiceUsed` 는 값이 비면 **조용히 아무 일도 하지 않는다.** 그래서 이 버그는
    저장 시점이 아니라 한참 뒤 "새 알람이 매번 기본 인사말" 로만 드러난다. 회귀 테스트는
    `AlarmEditorStateTest`(저장 시 종류 보존·옛 행 복구·직접 입력은 그대로 null).
- **적용 대상은 새 알람뿐.** 기존 알람을 열 때는 저장된 자기 값만 쓴다(열기만 해도 문구가 바뀌면 안 된다). `AlarmTalkApp` 이 `lastMessageContext`/`lastFreeBucket` 을 **신규 라우트에만** 넘기고, 버킷 이어받기는 `alarm == null` 로 한 번 더 막는다.
- **목소리 프리셀렉트는 마지막에 쓴 것이 그룹보다 우선**(`VoiceAudioCard`). 그룹(내 클론 → 공유받은 → 기본)을 먼저 보면, 클론을 가진 사람이 기본 목소리를 골라 저장해도 매번 클론으로 되돌아간다.
- **한 번도 고른 적 없을 때만** 폴백: 문구는 `preset`(기본 인사말), 기본 목소리 경로는 `FreeBucketOrder` 첫 값(날씨). `FreeBucketOrder` 는 최후 폴백 순서일 뿐 "항상 적용되는 기본값" 이 아니고, 목록 자체는 `EditorMessageContexts` 에서 유도된다(손으로 적지 않는다 — '직접 입력' 과 '기본 인사말' 만 빠진다. 이유는 `docs/spec/voice-and-message.md` §2).
- **직접 입력은 문구까지 기억한다**(2026-08-06 변경. 그전에는 아예 기억하지 않았다).
  - 바뀐 이유: 종류만 이어받으면 새 알람이 **빈 직접입력**으로 열려 저장이 막힌다 — 그게 예전에 '기억하지 않는다' 를 택한 실질적 근거였다. 문구를 함께 이어받으면 글자가 같아 `AlarmAudioStore` 입력 캐시에 걸려 **서버 호출도 월 한도 차감도 없이** 곧바로 저장된다(오프라인 포함). 근거가 사라졌으니 규칙도 바뀐다.
  - ⚠ **기억되는 값은 입력 원문이 아니라 서버 표시 문구다.** 알람에 저장되는 게 그 값이라서다(`setGeneratedTtsAudio` — 잠금화면 문구와 음성을 맞추려고 일부러 그렇게 한다). 번역이 켜진 기기(앱 언어 ≠ ko)에서는 둘이 갈라지므로, 생성 후 **표시 문구 키로도 `linkTtsInput` 을 남긴다**. 안 그러면 다음 새 알람이 표시 문구로 열려 입력 캐시를 빗나가고, 위의 '재생성·한도 차감 없음' 약속이 조용히 깨진다(Codex #685).
  - **마지막 선택은 하나다.** 생성형을 저장하면 `saveLastMessageContext` 가 직접 입력 기록을 **지운다** — 별도 '어느 쪽이 마지막' 플래그를 두지 않는다(플래그와 값이 어긋나는 상태 자체를 없앤다). 그래서 `last_manual_text` 가 차 있다 = 마지막이 직접 입력이었다.
  - ⚠ **요약 행에는 문장을 싣지 않는다**(2026-08-15 변경. 그전에는 반대였다). 편집기 본문의 문구 행은 **무엇을 골랐는지**(`직접 입력 문구` / `약` / `날씨 · 서울`)만 말하고, 알람이 읽어 줄 문장은 **문구 화면**에서 본다. 양쪽 다(`VoiceAudioCard.MessageModeSummaryRow` / `MessageSettingsPane.MessageModeSummaryRow`).
    - 바뀐 이유: 편집기 본문에 문장이 있으면 재생 방식을 '알람' 으로 바꿀 때 사라지는 카드에 실려 잠깐 읽힌다("문구 잔재"). 세 번 지적됐다.
    - 잃는 것을 알고 택했다 — 새 알람은 직전 직접입력 문구를 이어받으므로, 종류만 보이면 **어제 문구를 그대로 물고 온 것**을 요약 행에서는 알아챌 수 없다. 확인하려면 문구 행을 눌러 들어가야 한다(상세 카드에 전문이 있다).
  - 기존 알람을 편집할 때는 당연히 자기 문구가 그대로 남는다(delivery 태그 제거가 이걸 깎아먹지 않도록 `DeliveryTags.kt` 는 **우리가 내보낸 태그만** 벗긴다).
- **이미 등록한 정보는 다시 묻지 않는다**(문구 화면). 날씨 지역·운세 사주·직접 입력 문구는 값이 **없을 때만** 고르는 순간 입력창이 뜬다. 이미 있으면 선택만 되고, 고치는 길은 리스트 아래 상세 카드의 '변경하기' 하나다(`RandomPromptDetailRow` 의 `onChange`). 이 액션을 지우면 등록한 값을 영영 못 바꾼다.
- **모달은 자기만 닫는다.** 날씨·운세·직접 입력 다이얼로그는 확인해도 문구 목록을 닫지 않는다(예전에는 확인이 곧 `onSaveSettings` 라 목록까지 닫혀, 도시 하나 바꾸려다 화면 밖으로 튕겼다). 최종 반영은 문구 화면의 저장 버튼 **한 곳**이다.
- **삭제는 명시적 로그아웃·탈퇴에서만**(`clearCurrentDefaultVoicePreferences`). 자동 401(`clearSessionKeepingAlarms`)에서 지우면 같은 사람이 다시 로그인할 때 취향을 잃는다(Codex #646 회귀).
- 이어받는 것은 **선택 값 하나**뿐이다. 회전 인덱스·클립 키(`bucketRotationIndex`/`bucketClipKeysJson` 등)는 알람별 상태라 절대 따라가지 않는다. 무료 버킷 **회전**(울릴 때마다 클립 순차 이동)과는 다른 축이라 서로 충돌하지 않는다.

### iOS 는 안드로이드를 **원본**으로 삼는다 (2026-08-06 전수 대조)

두 앱을 나란히 놓고 124건을 대조해 iOS 를 안드로이드에 맞췄다. 다시 갈라지지 않도록
고정할 규약만 남긴다. **화면을 만들 때 안드로이드 대응 파일을 먼저 열 것.**

- **주석의 '안드로이드 미러' 근거를 믿지 말고 확인할 것.** 틀린 근거가 계속 나왔다 —
  `WakerBrandHeader:156-166`(존재하지 않음), `StockClipDropdown`(없음), `MenuScreen`(없음),
  `SettingsToggleRow`(없음), `SharedVoiceViewerInfoDialog`(없음),
  `editor_label_alarm_name`(문자열 자체가 없음), `AlarmTalkBottomBar.kt:117-121
  isDarkScheme 분기`(이미 없앤 옛 디자인), 타임휠 `itemHeight = 72.dp`(실제 92).
  **안드로이드가 이미 지운 화면을 베낀 주석이 그대로 남아 있었다.**
  - **없는 동작을 근거로 쓴 주석이 더 위험하다.** 2026-08-07 당시 무료 테마 주석 2곳이
    "클립이 울릴 때마다 순차 회전한다" 고 적었지만 그때 iOS 에는 그 회전이 없었다
    (`clips.first` 하나만 썼다) — 코드가 아니라 주석이 기능을 광고하고 있었다.
    (지금은 iOS 에도 회전이 있다 — `AlarmSoundResolver.rotatedBucketClipKey` +
    `LocalAlarmStore.advancedBucketRotationIndex`. **이 서술 자체가 낡을 수 있다는 예다.**)
  - **새 주석에는 줄번호를 쓰지 말 것.** 어차피 썩는다 — `ui/editor/Foo.kt` 처럼 경로와
    심볼 이름만 적는다.
  - 회귀 방지: `scripts/check-cross-platform-refs.py`(CI lint 잡에 포함). 주석이 대는
    파일·줄·심볼이 실재하는지 검사한다.
- **조사·요약을 원문 대신 인용하지 말 것.** 2026-08-12 에 "안드로이드는 테마를 고르는
  순간 클립 11개를 받는다" 고 사용자에게 말했다가 반증됐다. `bindStockBucketClips` 는
  `getCachedAudio(cacheKey) ?: 다운로드` 로 **캐시 우선**이고, 그 함수 주석도 "이미 있으면
  재사용" 이라고 정확히 적고 있었다. 코드도 주석도 맞았는데, 조사 보고의 요약 문장을 —
  **같은 세션에서 그 함수를 직접 읽고도** — 그대로 옮겼다.
  - 앞의 '주석을 믿지 말 것' 과 같은 종류다. 근거의 출처가 주석이든 테스트든 조사
    보고든, **읽지 않은 것을 근거로 말하지 않는다.**
  - ⚠ **"안드로이드에 없다" 는 파일 하나로 말하지 말 것.** 안드로이드는 규칙이 화면이
    아니라 **저장소·DAO·워커**에 사는 경우가 많다 — 로그아웃 알람 취소를 `ViewModel`
    에서만 찾고 "양쪽 다 빠졌다" 고 단정했는데 `AlarmRepository.detachAlarmsOnSignOut`
    이 있었다(2026-08-19). 확인 절차는 [`docs/spec/README.md`](docs/spec/README.md)
    「"안드로이드는 이렇게 한다" 고 말하기 전에」 절에 있다.
  - 특히 위험한 형태: "A 는 X 를 한다" 로 요약된 문장. 조건부 폴백(`?: 다운로드`)이
    무조건 경로로 납작해지기 쉽다. **분기를 직접 볼 것.**
  - 두 앱이 다르다고 말하기 전에 특히 확인한다 — 「iOS 는 안드로이드를 원본으로 삼는다」
    때문에 그 판단은 곧바로 "고쳐야 한다" 로 이어진다. 없는 차이를 만들어 내면 멀쩡한
    쪽을 망가뜨린다.
- **테스트가 틀린 값을 지키고 있을 수 있다.** 클론 최소 길이 60초, 진동 12종,
  "isDraft 는 더 이상 보내지 않는다(draft 플로우가 사라졌다)" — 셋 다 회귀 테스트가
  잘못된 상태를 고정하고 있었다. 서버 라우트와 안드로이드를 근거로 삼는다.
- **번역 카탈로그(`Localizable.xcstrings`)도 함께 고친다.** 소스만 고치면 en·ja 기기에
  옛 문구가 그대로 남는다.
- **iOS 가 안드로이드와 달라야 하는 곳은 딱 두 갈래다.**
  1. **AlarmKit 제약**: 울림 화면을 우리가 못 그린다(시스템 ALERT UI 소유). 알람 음량
     슬라이더도 두지 않는다 — 못 움직이는 컨트롤이라서. 대신 alert 제목과 Live Activity
     에 **시각**을 넣어 정보량을 맞춘다.
     - **진동도 같다(2026-08-17).** iOS 에는 진동 행·패턴 목록이 **없다.** 프레임워크가
       받는 것은 `sound:` 하나뿐이고 SDK 인터페이스에 vibration·haptic 이라는 낱말이
       나오지 않는다 — 예전 17종 목록은 무엇을 골라도 실제 알람이 같았고, 화면은 "실제
       알람에서는 이 패턴이 반복돼요" 라고 **없는 기능을 광고**했다. 값(`vibrationPattern`)
       은 계속 왕복시킨다 — 안드로이드에서 고른 패턴이 iOS 에서 알람을 고쳤다는 이유로
       사라지면 안 된다. 안드로이드는 자체 울림을 소유하므로 목록이 그대로 있다.
  2. **플랫폼 표준**: 확인 알럿은 시스템 `.alert` 를 쓴다(안드로이드의 `IosAlertDialog`
     이 그걸 흉내 낸 것이므로, iOS 에서 껍데기를 새로 만들면 오히려 원본에서 멀어진다).
  3. **글리프와 글자 크기 동작은 각 OS 것을 쓴다**(2026-08-17 지시).
     - **아이콘**: iOS 는 SF 심볼, 안드로이드는 머티리얼. **통일하는 것은 뜻과 자리**(어떤
       액션에 어떤 아이콘을 쓰는가)이지 글리프가 아니다. 예전에는 서로를 베끼고 있었다 —
       iOS 하단바의 알람이 머티리얼 도형을 손으로 그린 것(`MaterialAlarmShape`)이었고,
       안드로이드의 목소리·더보기 탭과 뒤로가기·미리듣기는 SF 심볼 모양의 자체
       드로어블이었다. 지금 남은 자체 드로어블은 **브랜드(`ic_google_g`)와 알림 아이콘
       (`ic_alarm_24`, 알림은 드로어블만 받는다)** 둘뿐이다.
     - **글자 크기**: 두 앱 모두 **사용자의 시스템 글자 크기 설정을 따른다.** 안드로이드는
       `sp`(기본), iOS 는 `Font.pretendard` 의 `relativeTo:`. 상한은 iOS 만 둔다
       (`AlarmTalkApp` 의 `.dynamicTypeSize(...accessibility1)`) — 안드로이드는 이미
       `fitToWidthScale`·타임휠 클램프로 큰 글씨를 견딘다.
  그 외에는 **다르면 iOS 가 틀린 것**으로 본다.
- **오디오 스테이징은 `AVAssetExportSession` 으로 하지 않는다.** `AVAssetExportPresetAppleM4A`
  는 `.caf` 를 못 내므로 staging 이 **항상** 실패하고, 잠금화면·앱 종료 상태에서 목소리가
  아예 안 울린다. `AVAssetReader`→`AVAssetWriter` 로 CAF(LPCM)를 직접 쓰고,
  `AVChannelLayoutKey` 를 반드시 넣는다(없으면 파일은 생기는데 열리지 않는다).
  회귀 테스트: `AlarmSoundStagingCapabilityTests`.
- **Keychain 저장 실패로 세션 반영을 버리지 않는다**(`AuthViewModel.persistSession`).
  저장에 실패하면 잃는 건 재시작 시 자동 로그인뿐이지만, 갱신을 버리면 rolling refresh
  가 죽어 **토큰 수명(365일)이 다하는 날** 조용히 로그아웃된다. (90일은 수명이 아니라
  갱신을 시작하는 임계값이다 — `docs/spec/session-and-auth.md`.)
- **화면 확인 모드**: `-UIPreviewSeed`(가짜 세션·알람·목소리) + `-UIPreviewTab
  alarms|voices|menu` + `-UIPreviewEditor` + `-UIPreviewAuthScreen login|register`.
  DEBUG 전용이고 서버·권한 팝업을 모두 건너뛴다. 시뮬레이터를 스크립트로 탭할 방법이
  없어서 만든 진입점이다.

## 진행 중 작업 (세션 재개 시 먼저 읽을 것)
현재 상태·폰 테스트 체크리스트·남은 follow-up: **[`docs/qa/dev-test-handoff.md`](docs/qa/dev-test-handoff.md)**.
