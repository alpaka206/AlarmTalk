# 환경 분리 전략 (dev / prod)

> 실서비스 전환을 위해 백엔드·랜딩·앱(Android/iOS)을 두 환경으로 분리한다.
> 현재 상태는 **전부 단일 dev 환경**이며, 이 문서는 목표 구조와 *직접 해야 할 작업*을 정리한다.
> staging은 운영 병목이 커서 제외하고 **dev + prod 2단계**로 간다. (필요해지면 나중에 staging을 끼워 넣을 수 있게 구조는 열어둔다.)

## 1. 환경 정의

| 환경 | 용도 | 브랜치 | 사용자 |
|---|---|---|---|
| **dev** | 개발·통합 테스트·내부 확인 | `develop` | 개발자 + 내부 테스터 |
| **prod** | 실서비스 | `main` | 일반 사용자 |

> 베타 테스트는 별도 staging 없이 **앱 스토어의 내부테스트 트랙(Play 내부테스트 / iOS TestFlight)** 으로 prod 빌드를 배포해 진행한다.

## 2. 도메인 매핑 (alarm-talk.com)

| 컴포넌트 | dev | prod |
|---|---|---|
| 랜딩 | 미리보기 배포(또는 `dev.alarm-talk.com`) | `alarm-talk.com` |
| 백엔드 API | `api-dev.alarm-talk.com` (또는 새 계정의 `*.workers.dev`) | `api.alarm-talk.com` |

## 3. 컴포넌트별 분리 방법

### 백엔드 (Cloudflare Workers)
- `wrangler.toml`에 `[env.production]` 추가 (top-level = dev 기본)
- 환경별로 분리: **Worker 이름**, **R2 버킷**, **Turso DB(secret)**, **커스텀 도메인**, **secrets**
- 배포: `wrangler deploy`(dev) / `wrangler deploy --env production`(prod)
- 코드 변경 필요 → *인프라(R2·DB) 준비 후* 스캐폴딩 제공 예정

### 랜딩 (Cloudflare Pages 권장)
- Production 브랜치 = `main`, Preview 브랜치 = `develop`
- 환경변수(`NEXT_PUBLIC_SITE_URL`, 스토어 링크)를 플랫폼에서 환경별 설정
- 이미 env 기반이라 코드 변경 최소

### Android
- `productFlavors { dev; prod }` + `applicationIdSuffix`(`.dev`)로 **한 기기에 dev/prod 동시 설치**
- flavor별 API base URL, Google OAuth client ID
- `buildTypes`: debug/release, release 서명용 키스토어
- 코드 변경 필요 → 키스토어 준비 후 스캐폴딩 제공 예정

### iOS
- `xcconfig` 파일(Dev/Prod) + scheme 분리
- bundle ID suffix(`.dev`), 환경별 `VOICE_ALARM_API_BASE_URL`, Google/Apple client ID
- 코드 변경 필요 → Apple Developer 준비 후 스캐폴딩 제공 예정

---

## 4. ✅ 직접 해야 할 일 (계정·인프라 — 코드로 안 됨)

### Cloudflare (⚠️ 완전히 새 계정으로 시작 — 기존 계정은 폐기)

> 도메인을 새로 구매하고 네임서버를 **새 Cloudflare 계정**으로 변경했다. R2·Workers·Pages·Email을
> 전부 이 새 계정 하나로 일원화한다. 기존 계정의 리소스(`voice-alarm-voices` 버킷, `voice-alarm-api`
> 워커, 커스텀 도메인 바인딩)는 **자동으로 넘어오지 않는다.** 전부 새로 만들고, 컷오버 검증 후 옛 계정을 정리한다.

- [ ] `alarm-talk.com` zone이 새 계정에서 **Active 상태인지 확인** (`dig NS alarm-talk.com`이 Cloudflare NS를 가리키면 전파 완료). zone이 Active가 아니면 `wrangler.toml`의 `api.alarm-talk.com` 커스텀 도메인 때문에 `wrangler deploy`가 실패한다.
- [ ] R2 버킷 **새로 2개 생성**: `voice-alarm-voices`(dev) + `voice-alarm-voices-prod`(prod) — 이름은 같아도 옛 계정 데이터는 안 넘어옴
- [ ] Workers: 새 계정엔 워커가 없으므로 **첫 `wrangler deploy`가 `voice-alarm-api`를 생성**. 시크릿도 새 계정에 전부 다시 `wrangler secret put` (마이그레이션 안 됨)
- [ ] Workers 커스텀 도메인 연결: `api.alarm-talk.com`(prod) / `api-dev.alarm-talk.com`(dev) — 둘 다 새 계정 zone에
- [ ] Cloudflare Pages 프로젝트 생성(랜딩) — Root Directory `apps/landing`, Build `npm run build`, Output `out`
- [ ] **GitHub Secret 재설정(필수)**: 새 계정에서 `CLOUDFLARE_API_TOKEN` 발급, `CLOUDFLARE_ACCOUNT_ID`를 새 값으로 교체 — 안 하면 CI가 죽은 옛 계정으로 배포를 시도한다
- [ ] (선택·권장) `wrangler.toml`에 `account_id = <새 계정 ID>` 고정 — 옛 계정으로 오배포 방지

### DB (Turso)
- [ ] dev / prod 데이터베이스 각각 생성
- [ ] 환경별 `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` 확보

### 백엔드 시크릿 (환경별 — prod는 `wrangler secret put <KEY> --env production`)
- [ ] `PERSO_API_KEY`, `ELEVENLABS_API_KEY`, `GEMINI_API_KEY`
- [ ] `GOOGLE_VERTEX_API_KEY` / `GOOGLE_VERTEX_CREDENTIALS_JSON` / `GOOGLE_VERTEX_LOCATION` / `GOOGLE_VERTEX_MODEL`
- [ ] `JWT_SECRET`(dev/prod 다르게), `PASSWORD_PEPPER`
- [ ] `GOOGLE_CLIENT_ID`(환경별), `APPLE_CLIENT_ID`, `APPLE_SHARED_SECRET`
- [ ] `RESEND_API_KEY`, `AUTH_EMAIL_FROM`, `AUTH_EMAIL_REPLY_TO`
- [ ] `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`

### Google / Apple 로그인 (Firebase 아님)

> ⚠️ Google도 **새 계정으로 이전**한다. 현재 `gradle.properties`/시크릿에 박힌 client ID는 옛 프로젝트
> (번호 `869967951972`) 소속이라 새 계정에선 **무효** → 새 프로젝트에서 다시 발급해 교체해야 한다.

- [ ] dev / prod **별도 GCP 프로젝트** 생성 (동의 화면이 프로젝트 단위 — prod는 게시/검증, dev는 테스트 모드)
- [ ] 각 프로젝트에서 OAuth client 발급: **Web(백엔드 audience)** + **Android(패키지+SHA-1)** + iOS(나중)
- [ ] 발급한 **Web client ID**로 교체: `gradle.properties`의 `voiceAlarmGoogleWebClientId`(flavor별) + 백엔드 `GOOGLE_CLIENT_ID`(`--env dev|production`)
- [ ] Apple Developer: Sign in with Apple 설정(`APPLE_CLIENT_ID`, `APPLE_SHARED_SECRET`)

**서명 인증서 SHA-1 (Android OAuth client에 등록 — 지문은 비밀 아님)**

| 환경 | 패키지 | SHA-1 | 출처 |
|---|---|---|---|
| dev | `com.voicealarm.nativeapp.dev` | _(메인 개발 PC에서 추출해 기입)_ | dev 빌드는 **메인 컴퓨터**에서 함. 그 PC의 debug.keystore SHA-1을 써야 한다 (이 원격 머신 값 아님). 메인 PC에서 `keytool -list -v -alias androiddebugkey -keystore "%USERPROFILE%\.android\debug.keystore" -storepass android -keypass android` 로 추출 |
| prod | `com.voicealarm.nativeapp` | `8E:05:92:D1:40:78:5B:DF:E8:F1:E1:05:CD:DD:A2:81:A5:B1:3D:31` | release 키스토어 `alarmtalk-release.jks` |

> Play App Signing 사용 시: 위 release 키는 *업로드 키*가 되고, 실제 배포본은 Google이 *앱 서명 키*로 재서명한다.
> → **Play Console "앱 서명 키" SHA-1도 prod Android client에 추가 등록**해야 스토어 배포본 로그인이 된다.

> 로그인 인증은 Firebase를 쓰지 않는다. 백엔드가 Google/Apple ID 토큰을 직접 검증한다
> (`lib/oauth.ts`의 `verifyGoogleIdToken`이 `oauth2.googleapis.com/tokeninfo` 호출).

### Android 배포
- [ ] release 서명 키스토어 생성 + **안전 보관**(비밀번호·alias 분실 시 앱 업데이트 불가)
- [ ] Play Console: 앱 등록, 내부테스트 트랙(베타) / 프로덕션 트랙

### iOS / Apple
- [ ] Apple Developer: bundle ID 등록 — `com.voicealarm.nativeapp` + `.dev`
- [ ] 배포 인증서 + 프로비저닝 프로파일
- [ ] App Store Connect: 앱 등록, TestFlight(베타)

### 이메일 (alarm-talk.com)
- [ ] Cloudflare Email Routing: `support@`/`business@`/`hello@`/`press@` 포워딩
- [ ] Resend: 도메인 인증(SPF/DKIM), `no-reply@alarm-talk.com` 발신

---

## 5. 소셜 알림 / FCM 방향 (확정)

- **받은 알람(소셜 공유 알람)** 은 어떤 경우에도 **미리 로컬 `AlarmManager`에 선등록**한다. 알람 발화는 푸시·서버 cron에 의존하지 않는다 (CLAUDE.md 원칙).
- 현재는 **Pull Sync(약 15분 주기 폴링)** 로 받은 알람·음성 메시지를 당겨온다. `fcm.ts`는 목업(미발송).
- **FCM(실시간 소셜 푸시) 은 추후 구현 예정.** 구현해도 **Pull Sync를 제거하지 않는다.**
  - FCM = 데이터 변경 시 즉시 "당겨와" 트리거(실시간성↑)
  - Pull Sync = 푸시 누락/지연 대비 **안전망**(주기는 완화 가능)
- FCM 구현 시 필요해지는 것: **Firebase 프로젝트 + service account**, `FIREBASE_PROJECT_ID`(현재는 미사용 잔재이나 FCM용으로 되살아남), Android `google-services.json` / iOS `GoogleService-Info.plist`.
  → FCM 구현 예정이므로 `FIREBASE_PROJECT_ID` 잔재는 **삭제하지 않고 유지**한다.

## 6. 코드 작업 계획 (인프라 준비 후 단계적으로)

1. `wrangler.toml` 환경 분리(`[env.production]`) + `deploy-backend.yml` 환경별 배포(main→prod, develop→dev)
2. Android `productFlavors`(dev/prod) + flavor별 설정 주입
3. iOS `xcconfig` + scheme 분리(Dev/Prod)
4. 랜딩 환경변수 플랫폼 설정 정리

## 7. 권장 진행 순서

1. **도메인 zone을 Cloudflare에 등록** (모든 것의 전제)
2. **prod 먼저 완성** → 동작 확인 → dev 설정 정리
3. 백엔드(서버) → 앱(클라이언트) 순서. 앱 base URL은 백엔드 도메인이 실제 연결된 뒤 교체
4. 키스토어·인증서·시크릿은 비밀 관리 도구(1Password 등)에 백업
5. **옛 Cloudflare 계정은 새 계정 동작 확인 전까지 건드리지 말 것.** 컷오버 검증 후 옛 워커/버킷 삭제(비용·혼선 방지). 옛 버킷의 음성 파일이 필요하면 삭제 전 복사.

> 각 단계의 코드 변경은 해당 인프라가 준비되면 요청하세요. 리소스 없이 환경 배포를 시도하면 빌드가 깨집니다.
