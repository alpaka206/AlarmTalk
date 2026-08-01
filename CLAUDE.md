# AlarmTalk — Claude Code 작업 노트

목소리 알람 앱(모노레포):
- `packages/backend` — Cloudflare Workers + Hono + Turso(libSQL). 라우트 `src/routes`, 마이그레이션 `src/lib/migrations.ts`.
- `packages/shared` — zod 스키마(`src/schemas`), 백엔드·클라 공용 계약.
- `apps/android-native` — Kotlin/Compose. dev/prod product flavor.
- iOS 앱은 없다. SwiftUI 앱(`apps/ios-native`)과 iOS 빌드 워크플로는 미운영이라 제거했다 — 재개 시 앱과 워크플로를 함께 되살린다.
- `apps/landing` — 웹 랜딩.

## 배포 / 환경
- **dev 백엔드**: https://api-dev.alarm-talk.com — `develop` 푸시(=PR 머지) 시 자동 배포 + DB 마이그레이션(Deploy Backend 워크플로).
- **prod 백엔드**: https://api.alarm-talk.com — `main` 푸시 시 자동 배포 + DB 마이그레이션(같은 워크플로, 빌링 테스트용). prod DB는 출시 전 초기화 예정 → grandfather/back-compat 불필요(하드 브레이킹 OK). 단, main에 올라가는 브레이킹 마이그레이션은 주의.
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

### 디자인 토큰 (Android Compose)
새 화면/컴포넌트는 **생 리터럴 대신 토큰**을 가져다 쓴다. 단일 출처 두 곳:
- **모서리 반경**: `ui/components/WakerDesign.kt` 의 `Waker*Shape` 토큰이 유일 출처.
  - `WakerTileShape`(12, 작은 타일·아이콘박스·인라인배너) / `WakerChipShape`(14, 칩·세그먼트·작은카드/행) / `WakerInputShape`·`WakerButtonShape`·`WakerPanelShape`(18, 입력·버튼·표준 카드/패널) / `WakerCardShape`(22, 큰 카드·다이얼로그 컨테이너) / `WakerHeroShape`(24, 히어로 카드) / `WakerDialogShape`(28, 대형 다이얼로그) / `WakerPillShape`(999, 캡슐).
  - `RoundedCornerShape(n.dp)` 를 새로 박지 말 것. `MaterialTheme.shapes` 도 이 토큰에서 파생됨.
  - **예외(토큰화 안 함)**: `CircleShape`(원형 아바타/FAB/점), `AlarmRow` 스와이프 비대칭 shape, 타임휠 전용 컨테이너(34dp), `RingingActivity` 잠금화면 슬라이더/스누즈(26/21dp — 고정 팔레트 화면 전용 스케일), `IosAlertDialog` 컨테이너(14dp — iOS UIAlertController 복제 스펙).
- **색**: `theme/AlarmTalkTheme.kt` 의 `colorScheme` 가 유일 출처. 항상 `MaterialTheme.colorScheme.*` 로 소비, **생 `Color(0x…)` 금지**.
  - 오버레이 스크림은 `WakerScrimColor`(WakerDesign.kt) 사용.
  - 문서화된 예외: `RingingActivity`(잠금화면 전용 고정 팔레트), 알림 팩토리(Notification accent), 랜딩/로그인 브랜드 비주얼, 탭 배경 그라데이션(`AlarmListScreen`의 `HomeGradientDark/Light` — 로그인 딥네이비 감성을 알람/목소리/더보기 탭 전체에 재현, 라이트/다크 2종).

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
