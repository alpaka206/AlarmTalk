# VoiceAlarm Backend

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
| `APPLE_CLIENT_ID` | Sign in with Apple audience / iOS bundle ID | iOS 로그인 시 필수 |

## 로컬 실행

```bash
cd packages/backend
cp .dev.vars.example .dev.vars   # 환경 변수 설정
npm run dev                       # wrangler dev (localhost:8787)
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
| `POST /api/auth/apple` | Apple identity token 검증 후 앱 JWT 발급 |
| `GET /api/auth/me` | 현재 사용자 정보 |
| `/api/voice/*` | 음성 프로필 CRUD + 업로드 + 화자 분리 |
| `/api/tts/*` | TTS 생성 + 메시지 관리 |
| `/api/alarm/*` | 알람 CRUD + 스케줄러 |
| `/api/friend/*` | 친구 요청/수락/삭제 |
| `/api/gift/*` | 선물 전송/수신 |
| `/api/billing/*` | 결제 스텁 + 이용권 코드 |
| `/api/family/*` | 가족 플랜 그룹 + 초대 + 알람 |
| `/api/characters/*` | 캐릭터 조회 + XP 지급 |
| `/api/user/*` | 사용자 프로필 + 설정 |

## Apple Login

- `POST /api/auth/apple` accepts an Apple `id_token`, verifies its RS256 signature with Apple JWKS, checks issuer/audience/expiry, and returns the app JWT.
- `APPLE_CLIENT_ID` must match the iOS bundle ID, for example `com.voicealarm.nativeapp.ios`.
- Migration `35_apple-login-users` adds `users.apple_id` and a nullable unique index for Apple account linking.
