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
| `APPLE_CLIENT_ID` | Sign in with Apple audience / iOS bundle ID | iOS 로그인 시 필수 |
| `APPLE_SHARED_SECRET` | App Store Connect "앱 전용 공유 비밀" — `POST /api/billing/apple/confirm` 게이트 | iOS IAP 구독 사용 시 필수 |

### Apple IAP confirm 검증 강화 로드맵

`POST /api/billing/apple/confirm` 은 서버가 Apple transaction 을 직접 검증하기 전까지 fail-closed 로 작동한다.

- 라우트 진입에는 authMiddleware (JWT) 가 선행해 호출자 신원을 보장.
- 알려진 SKU 화이트리스트 (`com.voicealarm.nativeapp.ios.{personal|couple|family}_{monthly|yearly}`) 만 수락.
- `APPLE_SHARED_SECRET` 미설정 시 503 으로 즉시 거부 (운영자 설정 강제).
- secret 과 SKU 가 유효해도 클라이언트가 보낸 transaction_id/product_id 만으로 entitlement 를 갱신하지 않는다.
- 현재는 501 `APPLE_TRANSACTION_VERIFICATION_REQUIRED` 를 반환하고 DB 를 변경하지 않는다.

후속 PR 에서 다음 server-to-server 검증을 추가해 영수증 진위까지 본인 검증한다.

1. Apple App Store Server API v2 의 `GET https://api.storekit.itunes.apple.com/inApps/v1/transactions/{transactionId}`
   (sandbox: `https://api.storekit-sandbox.itunes.apple.com/...`) 호출.
2. 응답의 JWS 헤더에서 X5C 체인을 추출 → Apple 루트 CA 까지 chain 검증
   (`crypto.subtle.verify` + Apple Root CA 인증서).
3. JWS payload 의 `productId` / `originalTransactionId` 가 클라이언트 입력과 일치하는지 대조.
4. payload 의 `expiresDate` 를 `subscriptions.expires_at` 의 권위로 채택 (현재는 plans.period_days 기반 산출).

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

- `POST /api/auth/apple` accepts an Apple `id_token`, verifies its RS256 signature with Apple JWKS, checks issuer/audience/expiry/nonce, and returns the app JWT.
- `APPLE_CLIENT_ID` must match the iOS bundle ID, for example `com.voicealarm.nativeapp.ios`.
- Configure the secret in production:

  ```bash
  wrangler secret put APPLE_CLIENT_ID
  # paste: com.voicealarm.nativeapp.ios
  ```

- Migration `35_apple-login-users` adds `users.apple_id` and a nullable unique index for Apple account linking.

### Nonce 정책 (replay 방어)

클라이언트(iOS)는 매 로그인 시 `SecRandomCopyBytes` 로 raw nonce 를 생성한 뒤,
`ASAuthorizationAppleIDRequest.nonce` 에는 raw nonce 의 SHA-256 hex 문자열을
설정하고, 동일한 raw nonce 를 `POST /api/auth/apple` 요청 본문(`nonce` 필드)에 함께
보낸다. 서버는 전달받은 raw nonce 를 SHA-256 으로 다시 해싱해 Apple 이 발급한
`id_token.nonce` 클레임과 비교한다. 불일치 시 `AUTH_APPLE_NONCE_MISMATCH` (401)
로 거부한다. 토큰엔 `nonce` 클레임이 있는데 요청에 `nonce` 가 빠지면 mismatch 로
처리한다. 클라이언트가 `nonce` 를 보내지 않는 레거시 호환 경로는 통과하지만
서버 로그에 경고가 남는다.
