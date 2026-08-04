# 규약

코딩 컨벤션, git 워크플로, 보안 정책, 주요 아키텍처 결정.

## 1. 원칙

1. **레포의 코드가 진실이다.** 이 문서와 코드가 어긋나면 코드가 이긴다. 코드를 고치든 문서를 고치든 **같은 PR 에서** 처리한다.
2. **식별자는 영어, 산문은 한국어.** 변수·함수·클래스·파일명은 영어. 주석·커밋 메시지·PR 설명·문서는 한국어.
3. **코드는 작게, 테스트는 더 작게.** 증명이 필요하면 주석 한 문단이 아니라 테스트로 증명한다.
4. **버전 번호를 문서에 베끼지 않는다.** 툴체인 버전의 유일 출처는 `package.json` 과 `apps/android-native/**/build.gradle.kts` 다.

## 2. 바꾸면 안 되는 플랫폼 제약

버전이 아니라 결정이라 여기 남긴다.

| 항목 | 값 | 이유 |
|---|---|---|
| Android `minSdk` | 26 | 정확 알람·포그라운드 서비스 동작의 하한선 |
| Android `targetSdk` | 36 | Play 정책 최신 요구치 추종 |
| JDK / `jvmTarget` | 17 | AGP·Compose 툴체인 정합 |
| Node | 22+ | Workers 로컬 런타임과 npm workspaces |
| TypeScript `strict` | `true` | 협상 대상 아님 |

## 3. TypeScript 규약

- `strict: true`. `any` 금지 — `unknown` 으로 넓히고 타입 가드로 좁힌다.
- 식별자: 값·함수 `camelCase`, 타입·클래스 `PascalCase`, 상수 `SCREAMING_SNAKE_CASE`.
- Hono 라우터 파일 하나에 도메인 하나. `packages/backend/src/routes/<domain>.ts`.
- 외부 호출은 `packages/backend/src/lib/<provider>.ts` 를 거친다. 라우트 핸들러가 직접 `fetch` 하지 않는다.
- 입력은 라우트 경계에서 zod 로 검증한다. 스키마는 라우트 파일 상단이나 `packages/shared` 에 둔다.
- 시각은 ISO 8601 문자열. UTC 로 저장하고 사용자 로컬로 렌더한다.
- SQL 인젝션·IDOR 방어 패턴은 루트 `CLAUDE.md` 의 "입력/SQL 보안 규약" 을 따른다. 신규 라우트 리뷰 필수 체크.
- 모든 에러 응답에 `error_code` 를 붙인다. 규약과 전수 목록은 [reference/error-codes.md](../reference/error-codes.md).

## 4. Kotlin / Android 규약

- 네이밍: 함수 `camelCase`, 클래스·컴포저블 `PascalCase`.
- 비자명한 화면은 `XxxScreen.kt` / `XxxState.kt` / `XxxComponents.kt` 로 쪼갠다.
- ViewModel 은 `StateFlow` 를 노출한다. 일회성 이벤트는 `Channel`.
- Room DAO 는 `suspend` 또는 `Flow`. `runBlocking` 금지.
- 모든 `AlarmManager` 접근은 `alarm/AlarmScheduler.kt` 를 통한다.
- 로그는 `AlarmTalkLog.TAG`. `Log.d` / `Log.w` 직접 호출 금지.
- 장시간 작업은 WorkManager 또는 명시적 포그라운드 서비스.
- 모서리 반경·색은 생 리터럴 대신 디자인 토큰을 쓴다(`WakerDesign.kt`, `AlarmTalkTheme.kt`). 예외 목록은 루트 `CLAUDE.md`.
- 알럿 모달은 `ui/components/IosAlertDialog.kt` 하나로만 만든다(입력이 있는 것도 `content` 슬롯 + `IosAlertField`). M3 `AlertDialog` 를 화면에서 직접 쓰거나 전용 껍데기를 새로 만들지 말 것 — 규약 전문은 루트 `CLAUDE.md` 의 「모달 = IosAlertDialog 하나」.
- 사용자 입력창은 `CodeRedeemField.kt` 의 `sanitizeUserText`/`sanitizeDisplayName` 를 `onValueChange` 에서 통과시킨다(앱 1차 방어선). 표시 이름 규칙 자체는 `@alarmtalk/shared` 의 `DisplayNameSchema` 가 유일 출처.

## 5. 주석, 로깅

- 주석은 **왜**를 설명한다. **무엇**은 식별자가 설명한다.
- `TODO` / `FIXME` 는 이슈 id 를 달고 쓴다.
- 사용자 노출 문자열은 로컬라이즈한다. 백엔드 로그는 영어 구조화 로그(`logStructured('info', { at: 'route.path', ... })`).

## 6. 테스트

| 레이어 | 도구 | 명령 |
|---|---|---|
| 백엔드 | Vitest + in-memory libSQL | `npm run test --workspace=backend` |
| Android 유닛 | JUnit | `./gradlew :app:testDebugUnitTest` |
| Android 계측 | Compose UI Test | `./gradlew :app:connectedAndroidTest` |
| Android 린트 | AGP Lint | `./gradlew :app:lintDebug` |

- 실기기 검증은 `apps/android-native/README.md` 의 Physical Device Checklist 로 한다.
- 외부 프로바이더(ElevenLabs, FCM, Vertex)는 테스트에서 스텁한다. **자동 테스트가 유료 크레딧을 쓰면 안 된다.**

## 7. 카피 톤

- 한국어 카피는 친근한 존대("…해 주세요"). 영어·일본어도 같은 격을 맞춘다.
- 액션 레이블은 동사. 추상어보다 구체명사("시간 설정" > "구성").
- 토스트는 한 줄을 넘기지 않는다.
- 모달 계층·알럿 카피·호칭 노출 같은 화면 규칙은 루트 `CLAUDE.md` 의 디자인 토큰 절과 Android 코드가 기준이다.

## 8. 시크릿

절대 커밋 금지:

- `.env`, `.env.*`
- `packages/backend/.dev.vars*`
- `apps/android-native/local.properties`
- `service-account*.json`
- `*.keystore`, `*.jks`, `*.p8`

Worker 시크릿과 Gradle property 의 목록·설정 위치는 [ops/environments.md](../ops/environments.md) 와 `packages/backend/src/types.ts` 의 `Env` 인터페이스가 유일 출처다. 이 문서에 복사하지 않는다.

## 9. Git 워크플로

### 브랜치

| 브랜치 | 용도 | 머지 대상 |
|---|---|---|
| `main` | 프로덕션 기준선 (푸시 시 prod 자동 배포+마이그레이션) | — (릴리스 때 develop → main) |
| `develop` | 일상 통합 (푸시 시 dev 자동 배포+마이그레이션) | — |
| `feat/<#issue>-<slug>` | 신규 기능 | `develop` |
| `fix/<#issue>-<slug>` | 버그 수정 | `develop` (핫픽스는 `main`) |
| `chore/<slug>` | 툴링, 의존성 | `develop` |
| `docs/<slug>` | 문서 | `develop` |
| `refactor/<slug>` | 동작 변경 없음 | `develop` |

`develop` 은 보호 브랜치(필수 체크 있음)라 직접 푸시할 수 없다. **반드시 PR.** `main` 도 직접 푸시 금지 — 핫픽스도 `fix/...` → main PR → 머지 → main 을 develop 으로 되머지.

### 커밋 메시지

- 형식: `<type>: <한국어 설명>`
- 타입: `feat` `fix` `chore` `docs` `refactor` `test` `style`
- 가능하면 50자 이내.
- AI 마커 금지 — `Co-Authored-By: Claude`, "Generated with Claude Code" 를 붙이지 않는다. 이모지도 쓰지 않는다.

```
feat: 재부팅 후 알람을 복구한다
fix: 스누즈가 정확히 다음 분에 예약되게 한다
docs: TTS 결정적 캐시 절을 다시 쓴다
chore(deps): production-dependencies 그룹의 hono 를 올린다
```

### 풀 리퀘스트

- 제목은 커밋 컨벤션을 따르고 70자 이내.
- 본문:
  ```
  ## Summary
  - ...

  ## Test plan
  - [ ] ...
  ```
- PR 하나에 목적 하나. 800줄 넘어가면 쪼갠다.
- 최소 1 승인. 머지 방식은 **머지 커밋**(스쿼시 금지) — 구현 이력을 남긴다.
- 리뷰 체크:
  1. 코드가 제목과 일치하는가?
  2. **알람 울림 경로에 네트워크 호출이 추가되지 않았는가?**
  3. 테스트가 충분한가?
  4. 권한·시크릿·문서를 같이 갱신했는가?
  5. Android ↔ 백엔드 계약이 맞물리는가?

### 태그·릴리스

- 시맨틱 버저닝 `vMAJOR.MINOR.PATCH`. 알파 트랙은 `v0.x.y`.
- Android `versionName = X.Y.Z`, `versionCode` 는 빌드마다 증가.
- 릴리스 노트는 GitHub Releases 에(기능 / 수정 / 알려진 이슈).

### 의존성·대용량 파일

- Dependabot 이 주간 그룹 PR 을 연다. 테스트 통과 + minor/patch 면 머지, major 는 사람이 본다.
- 5MB 넘는 파일은 git 에 두지 않는다. R2 나 GitHub Release 에셋을 쓴다.

## 10. 보안 정책 (요약)

외부 공개 정책은 `SECURITY.md`. 내부 규칙은 다음과 같다.

- HTTPS 전용. Android 는 `usesCleartextTraffic=false`.
- 비밀번호는 pepper 적용 후 SHA-256 프리해시 → bcrypt(cost 10). 프리해시는 bcrypt 의 72바이트 절단 문제를 막기 위한 것이다.
- JWT HS256, TTL **90일**. `JWT_SECRET` 은 32바이트 이상 랜덤.
  - 길게 잡은 이유: 알람은 기기가 울리므로 앱을 몇 주씩 안 여는 게 정상인데, 그 사이 토큰이
    죽으면 다음에 열었을 때 조용히 로그아웃돼 있다. 폐기는 만료가 아니라 `users.token_epoch`
    가 맡는다(전 기기 로그아웃·비밀번호 재설정에서 +1, 미들웨어가 매 요청 비교).
  - `GET /auth/me` 가 열 때마다 새 토큰을 내려 만료를 뒤로 민다(rolling refresh).
- 입력은 전부 zod 검증. SQL 은 예외 없이 `?` 바인딩.
- 레이트 리밋은 IP 선차단 + 유저 단위 + 인증 라우트 강화, 3단으로 건다. 실제 수치의 출처는 `src/middleware/rateLimit.ts` 다.
- 바디 상한은 `src/middleware/bodyLimit.ts` (음성 업로드를 지원해야 해서 넉넉하다). 상한을 문서에 베끼지 말 것.
- 보안 응답 헤더는 모든 응답에 붙인다(`src/middleware/securityHeaders.ts`).
- R2 버킷은 비공개. 서버는 base64 또는 짧은 수명의 서명 URL 만 내려준다.
- 보이스 데이터는 가족/파트너 그룹 내부에서만 공유한다. 외부 다운로드는 막는다.
- 계정 삭제는 보이스·알람·메시지·플랜 그룹 멤버십까지 연쇄 삭제하고, R2 오브젝트는 삭제 큐에 넣는다.
- 개인정보는 로그에 남기지 않는다. 이메일 같은 식별자는 남겨야 한다면 해시한다.
- 레포가 **PUBLIC** 이다. 실제 프로모션 코드명, 계정 값, 토큰을 소스·문서·PR 에 적지 않는다.
- 시크릿은 90일마다 교체. 담당은 릴리스 엔지니어 + 테크 리드.

## 11. 아키텍처 결정

### A1. OS 네이티브 알람 스케줄링, 푸시 없음

- **선택**: Android `AlarmManager.setAlarmClock`.
- **버린 것**: 푸시 알림, 서버 cron 발사.
- **이유**: 알람 신뢰성이 곧 제품이다. 푸시는 비행기 모드·약한 네트워크·Doze·제조사 백그라운드 제한에서 못 믿는다.
- 서버 푸시는 **동기화 트리거로만** 쓴다(가족 알람 생성 시 data-only 1회). 자세한 내용은 [tech/README.md](../tech/README.md) §3.

### A2. 결정적 TTS 캐싱

- **키**: `sha256(voice_profile_id | text | language | provider)`.
- **버린 것**: 요청마다 랜덤 UUID.
- **이유**: 같은 입력 → 같은 출력 → 같은 R2 오브젝트 재사용 → 프로바이더 비용 중복 지출 제거.

### A3. 가족 초대: 앱에 붙여넣는 이용권 코드

- **선택**: `INV-XXXX-XXXX-XXXX` 형식의 이용권 코드 하나. 앱의 코드 입력란에 붙여넣어 합류한다.
- **버린 것**: 이메일 초대, 링크 전용 초대, 커스텀 스킴 딥링크와 웹 초대 페이지.
- **이유**: 이메일을 수집하지 않아도 되고, 말로 불러주거나 아무 메신저로나 전달할 수 있다. 링크가 없으니 딥링크 인입 경로를 앱·랜딩 양쪽에 유지할 필요도, 링크 프리뷰로 코드가 새는 경로도 없다.
- **코드 공간**: 혼동 문자(0/O/1/I/L)를 뺀 31자 알파벳 × 12자리 ≈ 7.9×10¹⁷ 조합. 서버는 평문 대신 SHA-256 해시로 조회하고 등록 라우트에 레이트리밋이 걸려 있어 무차별 대입은 성립하지 않는다. 형식·알파벳의 유일 출처는 `src/lib/vouchers.ts`.
- **유효기간**: 별도 TTL 을 두지 않고 발급자 구독의 `expires_at` 을 상속한다 — 구독이 끝나면 코드도 끝난다. 만료 반영은 5분 주기 cron 의 구독 만료 정리와 등록 시점 lazy 판정 두 곳에서 일어난다.
- **사용 횟수**: 가족 플랜은 `max_members - 1` 회, 그 외는 1회(`plannedMaxUses`). 코드 하나로 정원까지 채운다. 코드가 샜다고 판단되면 재발급이 같은 구독의 기존 코드를 전부 `expired` 로 끊는다.
- **API**: `POST /api/billing/vouchers/family-share`(발급) / `.../regenerate`(재발급) / `POST /api/code/register`(합류).

### A4. R2 를 보이스/TTS 정본 저장소로

- **선택**: Workers 바인딩 `VOICE_BUCKET` 으로 Cloudflare R2.
- **이유**: egress 무료, 네이티브 바인딩, 외부 서비스 의존 없음, Workers 컴퓨트 경계 안에 들어온다.
