# 이어서 작업하기 (환경 분리 핸드오프)

> 이 파일은 다른 컴퓨터에서 작업을 이어받기 위한 인계 메모다. 작업이 어느 정도 진행되면 삭제해도 된다.
> 아래 "Claude에게 줄 프롬프트"를 그대로 복사해 Claude Code에 붙여넣으면 맥락이 복원된다.

## 지금까지 상황

- **프로젝트**: AlarmTalk(=Waker, 음성 알람 앱) 실서비스 전환 준비.
- **하는 일**: 백엔드(Cloudflare Workers)·랜딩(Next.js)·앱(Android/iOS)을 **dev + prod 2환경**으로 분리. staging은 제외(베타는 Play 내부테스트/iOS TestFlight로 prod 빌드 배포).
- **현재 코드 상태**: 환경 분리 기반 전무 → `docs/ops/environments.md`에 목표 구조 + "직접 해야 할 일" 체크리스트 정리 완료. 코드 스캐폴딩은 **인프라(계정/리소스) 준비 후** 진행하기로 합의.

## 확정된 결정 사항

- **도메인**: `alarm-talk.com`(랜딩), `api.alarm-talk.com`(prod API), `api-dev.alarm-talk.com`(dev API).
- **Cloudflare를 완전히 새 계정으로 시작한다.** 도메인 새로 구매, 네임서버를 새 계정으로 변경 완료. R2·Workers·Pages·Email을 새 계정 하나로 일원화. **기존 계정은 컷오버 후 폐기.** → 기존 버킷(`voice-alarm-voices`)·워커(`voice-alarm-api`)·시크릿은 자동 이전 안 됨, 전부 새로 생성.
- **인증은 Firebase 아님**: 백엔드가 Google/Apple ID 토큰 직접 검증(`packages/backend` `lib/oauth.ts`의 `verifyGoogleIdToken` → `oauth2.googleapis.com/tokeninfo`). 필요한 건 Firebase가 아니라 Google Cloud OAuth Client ID.
- **FCM은 추후 구현**: 현재는 Pull Sync(~15분 폴링)로 받은 알람·음성 당겨옴, `fcm.ts`는 목업. FCM 구현해도 Pull Sync는 안전망으로 유지. `FIREBASE_PROJECT_ID` 잔재는 FCM용으로 삭제하지 않고 유지.
- **원칙(CLAUDE.md)**: 받은 알람은 항상 로컬 AlarmManager 선등록. 알람 발화는 푸시·서버 cron에 의존하지 않는다.

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

### B. 코드 스캐폴딩 — 위 인프라가 준비된 뒤 단계적으로
1. `packages/backend/wrangler.toml`에 `[env.production]` 추가(top-level=dev). 환경별 워커 이름·R2 버킷·커스텀 도메인·secrets 분리. (선택) `account_id = <새 계정 ID>` 고정.
2. `deploy-backend.yml`: main push→prod(`wrangler deploy --env production`), develop push→dev.
3. Android `productFlavors { dev; prod }` + `applicationIdSuffix .dev` + flavor별 API base URL / OAuth client ID.
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
docs/ops/_continue-here.md 를 먼저 읽어라. Cloudflare는 완전히 새 계정으로 시작했고
(도메인 새로 구매·네임서버 변경 완료, 기존 계정 폐기 예정) R2·Workers·Pages·Email을
새 계정 하나로 일원화한다. 인증은 Firebase가 아니라 백엔드의 Google/Apple ID 토큰
직접 검증 방식이다. 코드 스캐폴딩은 인프라(R2/Turso/도메인/시크릿)가 준비된 뒤에만
진행한다 — 리소스 없이 wrangler env 배포하면 깨진다. 커밋은 내가 명시할 때만,
AI 흔적 없이, 한국어 명사형 컨벤션(feat/fix/docs)으로 한다.
지금 인프라 어디까지 준비됐는지 물어보고, 준비된 범위에 맞춰 다음 단계를 제안해라.
```
