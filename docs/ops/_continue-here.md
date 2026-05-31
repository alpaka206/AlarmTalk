# 이어서 작업하기 (환경 분리 핸드오프)

> 이 파일은 다른 컴퓨터에서 작업을 이어받기 위한 인계 메모다. 작업이 어느 정도 진행되면 삭제해도 된다.
> 아래 "Claude에게 줄 프롬프트"를 그대로 복사해 Claude Code에 붙여넣으면 맥락이 복원된다.

## 지금까지 상황

- **프로젝트**: AlarmTalk(=Waker, 음성 알람 앱) 실서비스 전환 준비.
- **하는 일**: 백엔드(Cloudflare Workers)·랜딩(Next.js)·앱(Android/iOS)을 **dev + prod 2환경**으로 분리. staging은 제외(베타는 Play 내부테스트/iOS TestFlight로 prod 빌드 배포).
- **현재 코드 상태**:
  - `docs/ops/environments.md`에 목표 구조 + "직접 해야 할 일" 체크리스트 정리 완료.
  - ✅ **백엔드 환경 분리 스캐폴딩 완료**(이 브랜치): `packages/backend/wrangler.toml`에 `account_id` 고정 + `[env.dev]`/`[env.production]`(워커명·R2 버킷·커스텀 도메인·crons 분리), `deploy-backend.yml` 환경별 배포, `.dev.vars.example`, `scripts/sync-worker-secrets.ts`·`run-remote-migrations.ts`.
  - ✅ Android `productFlavors`(dev/prod), 앱 ID `com.alarmtalk.app.dev` / `com.alarmtalk.app`, flavor별 API base URL / Web client ID 반영.
  - ⏳ 남은 코드: iOS `xcconfig`, 랜딩 Pages 설정, release 서명 키스토어 연결.

## 확정된 결정 사항

- **도메인**: `alarm-talk.com`(랜딩), `api.alarm-talk.com`(prod API), `api-dev.alarm-talk.com`(dev API).
- **Cloudflare를 완전히 새 계정으로 시작한다.** 도메인 새로 구매, 네임서버를 새 계정으로 변경 완료. R2·Workers·Pages·Email을 새 계정 하나로 일원화. **기존 계정은 컷오버 후 폐기.** → 기존 버킷(`voice-alarm-voices`)·워커(`voice-alarm-api`)·시크릿은 자동 이전 안 됨, 전부 새로 생성.
- **인증은 Firebase 아님**: 백엔드가 Google/Apple ID 토큰 직접 검증(`packages/backend` `lib/oauth.ts`의 `verifyGoogleIdToken` → `oauth2.googleapis.com/tokeninfo`). 필요한 건 Firebase가 아니라 Google Cloud OAuth Client ID.
- **FCM은 추후 구현**: 현재는 Pull Sync(~15분 폴링)로 받은 알람·음성 당겨옴, `fcm.ts`는 목업. FCM 구현해도 Pull Sync는 안전망으로 유지. `FIREBASE_PROJECT_ID` 잔재는 FCM용으로 삭제하지 않고 유지.
- **원칙(CLAUDE.md)**: 받은 알람은 항상 로컬 AlarmManager 선등록. 알람 발화는 푸시·서버 cron에 의존하지 않는다.
- **Google OAuth (새 계정으로 이전)**: 현재 `gradle.properties`/시크릿의 client ID는 옛 프로젝트(번호 `869967951972`) 소속이라 새 계정에선 무효 → 새로 발급해 교체해야 함.
  - **dev / prod 별도 GCP 프로젝트** 2개. 각 프로젝트에 Web(audience) + Android(패키지+SHA-1) + iOS(나중) client.
  - **SHA-1 매핑**(자세한 건 `environments.md`): dev=`8E:05:92:D1:40:78:5B:DF:E8:F1:E1:05:CD:DD:A2:81:A5:B1:3D:31`(메인 PC debug, ✅확정) / prod=Play 앱 서명 키 SHA-1(⏳출시 후 Play Console에서 받아 등록).
  - 받은 **Web client ID**는 `gradle.properties`의 `voiceAlarmDevGoogleWebClientId` / `voiceAlarmProdGoogleWebClientId`(flavor별) + 백엔드 `GOOGLE_CLIENT_ID`(`--env dev|production`)에 넣는다. (Android client ID는 코드에 안 들어감)

## 다음 할 일

### A. 사용자(콘솔/계정) 작업 — 코드로 안 됨
`docs/ops/environments.md` 4번 섹션 체크리스트 참고. 요지:
1. 새 Cloudflare 계정에서 `alarm-talk.com` zone Active 확인.
2. R2 버킷 2개 신규 생성(`voice-alarm-voices`, `voice-alarm-voices-prod`).
3. 커스텀 도메인 `api.alarm-talk.com` / `api-dev.alarm-talk.com` 연결.
4. Turso dev/prod DB 생성 → `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` 확보.
5. Google/Apple OAuth Client ID 발급(환경별·플랫폼별).
6. **GitHub Secret 재설정(필수)**: 새 계정 `CLOUDFLARE_API_TOKEN`·`CLOUDFLARE_ACCOUNT_ID`.
7. 백엔드 시크릿 prod에 `wrangler secret put <KEY> --env production`.
8. Android 키스토어 / Apple 인증서·프로비저닝.

### B. 코드 스캐폴딩
1. ~~`wrangler.toml` 환경 분리 + `deploy-backend.yml` 환경별 배포~~ ✅ 완료(이 브랜치).
2. **Web client ID 교체**(새 GCP 프로젝트에서 발급 후): `gradle.properties`의 `voiceAlarmDevGoogleWebClientId` / `voiceAlarmProdGoogleWebClientId` + 백엔드 `GOOGLE_CLIENT_ID`(`--env dev|production`).
3. ~~Android `productFlavors { dev; prod }` + `applicationIdSuffix .dev` + flavor별 API base URL / Web client ID~~ ✅ 완료. release 서명 키스토어를 `signingConfig`에 연결(현재 미설정).
4. iOS `xcconfig`(Dev/Prod) + scheme 분리 + bundle ID suffix `.dev`.
5. 랜딩 Cloudflare Pages 환경변수 정리(Production=main, Preview=develop).

## 작업 규칙 (꼭 지킬 것)

- **커밋은 명시적으로 요청할 때만.** 작업 끝나도 자동 커밋 금지.
- **커밋/PR/이슈에 AI 흔적 금지** (`Co-Authored-By`, `Generated with Claude` 등 푸터·서명 X).
- **메시지 컨벤션(한국어 명사형 종결)**: `feat: ~ 개발/구현`, `fix: ~ 수정/반영`, `docs: ~ 작성/정리`. "~합니다" 평서문 금지.
- **PR 분기**: 여러 기능 묶으면 이슈·브랜치 만들어 `develop`로 PR. 소규모 보정은 그냥 수정.

## Claude에게 줄 프롬프트 (복사해서 붙여넣기)

```
AlarmTalk의 dev/prod 환경 분리 작업을 이어서 한다. docs/ops/environments.md 와
docs/ops/_continue-here.md 를 먼저 읽어라. 백엔드 환경 분리(wrangler.toml [env.dev]/
[env.production], deploy-backend.yml)는 이미 이 브랜치에 완료됐다. Cloudflare는 새 계정으로
이전(도메인 새로 구매·네임서버 변경 완료, 기존 계정 폐기 예정), Google OAuth도 새 계정으로
dev/prod 별도 GCP 프로젝트를 쓴다(옛 client ID 869967951972은 무효). 인증은 Firebase가
아니라 백엔드의 Google/Apple ID 토큰 직접 검증 방식. 코드 스캐폴딩은 인프라가 준비된 뒤에만
진행한다 — 리소스 없이 wrangler env 배포하면 깨진다. 커밋은 내가 명시할 때만, AI 흔적 없이,
한국어 명사형 컨벤션(feat/fix/docs). 지금 인프라(특히 새 GCP 프로젝트 Web client ID)가
어디까지 준비됐는지 물어보고, 준비된 범위에 맞춰 다음 단계를 제안해라.
```
