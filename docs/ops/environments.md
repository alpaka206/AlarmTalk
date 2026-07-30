# 환경 및 배포 운영

AlarmTalk는 `dev`와 `prod` 두 환경으로 운영한다. 이 문서는 실제 계정 값이나 secret을 보관하지 않고, 어디에 무엇을 설정해야 하는지만 정리한다.

## 환경 정의

| 환경 | 용도 | 브랜치 | 앱 패키지 |
|---|---|---|---|
| `dev` | 개발, 통합 테스트, 내부 확인 | `develop` | `com.alarmtalk.app.dev` |
| `prod` | Play 내부테스트, 실제 배포 | `main` | `com.alarmtalk.app` |

별도 staging은 두지 않는다. 베타 검증은 Play 내부테스트 트랙으로 처리한다.

## 공개 문서 원칙

다음 값은 README, 이슈, PR, 운영 문서에 실제 값을 적지 않는다.

- OAuth client ID
- Sentry DSN
- Cloudflare API token, account ID
- Turso URL/token
- JWT secret, password pepper, init secret
- keystore 경로, alias, 비밀번호
- Play Console 또는 Google Cloud Console의 인증서 지문 값

OAuth client ID와 Sentry DSN은 일반적으로 앱에 포함될 수 있는 공개 식별자에 가깝지만, 문서에 중복 기재하면 오래된 값과 혼동이 생긴다. 실제 값은 빌드 설정, CI secret, 로컬 ignored 파일, 콘솔에만 둔다.

## 설정 위치

### Android

- 환경별 API base URL과 Google Web OAuth client ID는 Gradle property로 주입한다.
- property 이름(유일 출처는 `apps/android-native/app/build.gradle.kts`):
  - `alarmTalkDevApiBaseUrl`
  - `alarmTalkProdApiBaseUrl`
  - `alarmTalkDevGoogleWebClientId`
  - `alarmTalkProdGoogleWebClientId`
  - `alarmTalkDevSentryDsn`
  - `alarmTalkProdSentryDsn`
- 이름이 틀리면 Gradle 이 조용히 무시하고 빈 문자열로 폴백한다. 빌드는 성공하지만 API base URL·Google 로그인이 죽으므로, 값을 넘긴 뒤 실제로 로그인이 되는지 확인한다.
- release AAB는 업로드 키로 서명해 Play Console에 올린다.

### Backend

- Cloudflare Worker secret은 `wrangler secret put <KEY>` 또는 `wrangler secret put <KEY> --env production`으로 설정한다.
- 로컬 개발 값은 ignored 파일인 `packages/backend/.dev.vars.dev`, `packages/backend/.dev.vars.prod`에 둔다.
- GitHub Actions 배포에 필요한 값은 GitHub Secrets에 둔다.

#### Vertex / Gemini 동적 문구

- `GOOGLE_VERTEX_CREDENTIALS_JSON`, `GOOGLE_VERTEX_LOCATION`, `GOOGLE_VERTEX_MODEL`은 선택 값이다. 번역과 동적 문구 생성 경로가 쓴다.
- `GOOGLE_VERTEX_DYNAMIC_TEXT_ENABLED`는 기본적으로 설정하지 않는다. Gemini 생성 알람 문구를 의도적으로 켤 때만 `true`로 둔다.
- 기본 정책은 프리셋 우선이다. `GOOGLE_VERTEX_DYNAMIC_TEXT_ENABLED=true`가 아니면 동적 문구 컨텍스트는 로컬 폴백 문구를 쓴다(`lib/vertex-translate.ts`의 `generateDynamicAlarmTextWithVertex`).

### 이메일 인증

이메일 인증코드 실발송에는 인증된 발신 도메인과 다음 Worker secret이 필요하다.

- `RESEND_API_KEY`
- `AUTH_EMAIL_FROM` (예: `AlarmTalk <no-reply@alarm-talk.com>`)
- `AUTH_EMAIL_REPLY_TO` (선택)

### Landing

- 프로덕션 배포는 `main`, 프리뷰 배포는 `develop` 기준으로 둔다.
- 사이트 URL, 스토어 링크 같은 공개 값은 배포 플랫폼의 환경 변수로 관리한다.

## Google 로그인

Firebase Auth를 쓰지 않는다. 앱은 Google Sign-In에서 ID token을 받고, 백엔드가 그 Google ID token을 직접 검증한다. (Firebase는 푸시 발송(FCM)에만 쓴다.)

Android 앱 코드가 런타임에 읽는 값은 Web OAuth client ID다. `requestIdToken()`의 audience와 백엔드 `GOOGLE_CLIENT_ID`가 같은 Web client ID여야 한다.

Android OAuth client ID는 Google Cloud Console에 등록만 한다. 앱 코드나 AAB env에 넣지 않는다. 등록 기준은 다음과 같다.

- dev: `com.alarmtalk.app.dev` + 개발/디버그 서명 인증서 SHA-1
- prod: `com.alarmtalk.app` + Play App Signing의 앱 서명 키 SHA-1
- 로컬에서 prod release를 직접 설치해 로그인 테스트할 때만 업로드 키 SHA-1도 추가 등록

## Android 배포 순서

1. prod Web OAuth client ID가 Android Gradle property와 backend `GOOGLE_CLIENT_ID`에 같은 값으로 설정되어 있는지 확인한다.
2. prod Android OAuth client가 Google Cloud Console에 등록되어 있는지 확인한다.
3. `versionCode`를 이전 Play 업로드보다 크게 올린다.
4. prod release AAB를 빌드한다.
5. 업로드 키로 AAB를 서명한다.
6. Play Console 내부테스트 트랙에 업로드한다.
7. Play Console에서 앱 서명 키 SHA-1을 확인하고 Google Cloud Console의 prod Android OAuth client에 반영한다.

## 오류 수집

- Android Sentry DSN은 release 빌드 시 Gradle property로 주입한다.
- Backend Sentry DSN은 Worker secret으로만 설정한다.

## 알람 동작 원칙

받은 알람이나 공유 알람도 실제 울림 전에는 로컬 `AlarmManager`에 등록되어야 한다. 알람 발화는 푸시, 서버 cron, 실시간 네트워크 연결에 의존하지 않는다.

FCM 같은 실시간 알림을 나중에 붙이더라도 동기화 트리거로만 사용하고, 로컬 알람 등록 경로를 대체하지 않는다.
