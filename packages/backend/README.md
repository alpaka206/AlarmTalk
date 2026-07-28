# AlarmTalk Backend

Cloudflare Workers + Hono 기반 API 서버.

## 기술 스택

- Runtime: Cloudflare Workers
- Framework: Hono
- Database: Turso (libSQL)
- Auth: JWT (HS256) + bcryptjs
- 마이그레이션: 자체 번호 기반 러너 (`src/lib/migrations.ts`)

## 환경 변수

| 변수 | 설명 | 필수 |
|---|---|---|
| `TURSO_DATABASE_URL` | Turso DB URL | ✅ |
| `TURSO_AUTH_TOKEN` | Turso 인증 토큰 | ✅ |
| `JWT_SECRET` | JWT 서명 시크릿 (32자 이상 권장) | ✅ |
| `PASSWORD_PEPPER` | 비밀번호 해싱 페퍼 | ✅ |
| `GOOGLE_CLIENT_ID` | Google OAuth 클라이언트 ID | 선택 |
| `GOOGLE_VERTEX_CREDENTIALS_JSON` | Vertex AI service account JSON for translation and legacy dynamic text generation | Optional |
| `GOOGLE_VERTEX_LOCATION` | Vertex AI location override | Optional |
| `GOOGLE_VERTEX_MODEL` | Vertex AI model override | Optional |
| `GOOGLE_VERTEX_DYNAMIC_TEXT_ENABLED` | Set to `true` only to re-enable Gemini-generated dynamic alarm text. Default is off; dynamic contexts use local/preset fallback. | Optional |

## 로컬 실행

```bash
cd packages/backend
cp .dev.vars.example .dev.vars.dev   # dev 환경 변수 설정
cp .dev.vars.example .dev.vars.prod  # production 환경 변수 설정
npm run dev                          # wrangler dev --env dev (localhost:8787)
```

## 마이그레이션

마이그레이션은 `src/lib/migrations.ts`에 인라인 정의됨.
서버 시작 시 `POST /api/init-db`로 실행하거나, 코드에서 `initDB(env)` 호출.

```bash
curl -X POST http://localhost:8787/api/init-db
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
| `/api/voice/*` | 음성 프로필 CRUD + 업로드 |
| `/api/tts/*` | TTS 생성 + 메시지 관리 |
| `/api/alarm/*` | 알람 CRUD + 스케줄러 |
| `/api/billing/*` | 결제 스텁 + 이용권 코드 |
| `/api/family/*` | 가족 플랜 그룹 + 초대 + 알람 |
| `/api/user/*` | 사용자 프로필 + 설정 |

> iOS 앱과 Apple 로그인·IAP 라우트(`/api/auth/apple`, `/api/billing/apple/confirm`)는 미운영이라
> 제거됐다. 관련 환경변수(`APPLE_CLIENT_ID`, `APPLE_SHARED_SECRET`)와 `users.apple_id` 컬럼도 없다.
> iOS 를 재개하면 라우트·시크릿·컬럼을 함께 되살려야 한다.

