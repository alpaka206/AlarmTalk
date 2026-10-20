# AlarmTalk Backend

> ⭐ **동작 규칙은 [`docs/spec/`](../../docs/spec/README.md) 이 단일 출처다.**
> 안드로이드·iOS·백엔드가 같이 본다. 화면 동작을 고치기 전에 거기부터 읽고,
> 동작을 바꾸면 **스펙을 먼저** 고친다. 구현이 스펙과 다르면 구현이 틀린 것이다.


Cloudflare Workers + Hono 기반 API 서버.

## 기술 스택

- Runtime: Cloudflare Workers
- Framework: Hono
- Database: Turso (libSQL)
- Auth: JWT (HS256) + bcryptjs
- 마이그레이션: 자체 번호 기반 러너 (`src/lib/migrations.ts`)

## 환경 변수

전체 목록과 Apple 로그인·결제·APNs 키의 구분은 [`.dev.vars.example`](.dev.vars.example)이
단일 출처다. 실제 값이 든 `.dev.vars.*`는 커밋하지 않는다.

## 로컬 실행

```bash
cd packages/backend
cp .dev.vars.example .dev.vars.dev   # dev 환경 변수 설정
cp .dev.vars.example .dev.vars.prod  # production 환경 변수 설정
npm run dev                          # wrangler dev --env dev --env-file .dev.vars.dev (localhost:8787)
```

## 마이그레이션

마이그레이션은 `src/lib/migrations.ts`에 인라인 정의됨.
배포 워커의 `POST /api/init-db`로 실행한다. `INIT_DB_SECRET`이 필요하며 원격 실행은
`scripts/run-remote-migrations.ts`가 범위별로 나눠 호출한다.

시크릿은 `Authorization` 이 아니라 **`x-init-db-secret` 헤더**로 보낸다(`index.ts` 의 `canRunInitDb`).
안 맞거나 워커에 `INIT_DB_SECRET` 이 없으면 404 다. 범위는 `fromId`/`toId` 로 지정한다 —
Workers 서브리퀘스트 캡(~50) 때문에 인자 없이 부르면 전체 실행이라 위험하다.

```bash
curl -X POST -H 'x-init-db-secret: <INIT_DB_SECRET>' \
  'http://localhost:8787/api/init-db?fromId=1&toId=10'
```

## 테스트

```bash
npm test          # vitest run
npm run typecheck # tsc --noEmit
```

## API 엔드포인트 개요

| 경로 | 설명 |
|---|---|
| `POST /api/auth/register` | 이메일+비밀번호 가입 |
| `POST /api/auth/login` | 이메일+비밀번호 로그인 |
| `GET /api/auth/me` | 현재 사용자 정보 |
| `/api/voice/*` | 음성 프로필 CRUD·초안·클론 |
| `/api/tts/*` | TTS 생성 + 메시지 관리 |
| `/api/alarm/*` | 내 알람 CRUD·동기화(받은 알람 pull 은 옛 앱 호환 빈 응답) |
| `/api/billing/*` | Google Play·App Store 결제 검증, 개인 구독 |
| `/api/code/*` | 옛 앱 호환 — 코드 등록은 언제나 404 `CODE_NOT_FOUND`(코드로 여는 기능은 없다 — `routes/code.ts` 머리말) |
| `/api/family/*` | 옛 앱 호환 — `GET /groups/current` 가 그룹 없음을 돌려준다(커플·가족 이용권은 2026-10-20 에 없앴다) |
| `/api/user/*` | 사용자 프로필 + 설정 |
| `/api/push/*` | FCM·APNs 토큰 등록/해제 |
| `/api/events/*` | 사용 기록 수집(앱이 오프라인에 쌓아 둔 배치) |
| `/api/holiday/*` | 공휴일 조회 (인증 불필요) |
| `GET /api/app/version` | 앱 버전 정책 (인증 불필요) |
| `/admin/*` | 운영자 콘솔 — **`/api` 밑이 아니다.** ADMIN_SECRET 로 보호 |
