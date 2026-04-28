# P66 — 프로덕션 API URL 수정

## 선택한 항목
BACKLOG 고갈 → 자가 생성: 프로덕션 API URL 플레이스홀더 버그 수정

## 선택 이유
BACKLOG 전체 완료. 코드베이스 전반을 점검하던 중, `core.ts`의 프로덕션 폴백 URL이 `voice-alarm-api.your-name.workers.dev`라는 플레이스홀더로 남아있는 것을 발견. `useAuth.tsx`의 `resolveApiBase()`도 `__DEV__` 체크 없이 항상 localhost로 폴백하는 문제가 있었음. EAS Build 프로덕션 빌드에서 `EXPO_PUBLIC_API_URL` env var 미설정 시 모든 API 호출이 실패하는 심각한 배포 버그.

## 접근
1. `core.ts` 프로덕션 폴백 URL을 실제 배포 URL로 수정
2. `useAuth.tsx`의 `resolveApiBase()`에 `__DEV__` 분기 추가 (core.ts와 일관성)
3. `eas.json`의 preview/production 빌드 프로필에 `EXPO_PUBLIC_API_URL` env var 추가

### 대안 검토
- 공유 상수 모듈로 추출: 두 파일에서만 사용되므로 과도한 추상화. 각 모듈에 상수로 유지.
- .env 파일로만 관리: EAS Build에서 .env는 빌드 시크릿이 필요하고, eas.json의 env가 더 명시적.

## 변경 파일
1. `apps/mobile/src/services/api/core.ts` — PRODUCTION_API_URL 상수 + 폴백 URL 수정
2. `apps/mobile/src/hooks/useAuth.tsx` — resolveApiBase()에 __DEV__ 분기 추가 + PRODUCTION_API_URL
3. `apps/mobile/eas.json` — preview/production env에 EXPO_PUBLIC_API_URL 추가

## 검증
- typecheck: mobile 0 errors, backend 0 errors
- 테스트: mobile 625/625 통과, backend 672/672 통과
- CORS: 모바일 네이티브 요청은 CORS 우회하므로 변경 불필요

## 다음 루프 참고
- CORS ALLOWED_ORIGINS는 localhost만 허용 (개발용) — 프로덕션 모바일 앱은 CORS 불필요
- Apple 토큰 검증이 stub 상태 (서명 미검증, JWT payload 디코딩만) — 프로덕션 전 JWKS 검증 구현 필요
- 코드베이스 내 TODO 2건 잔존: alarmPlayback.ts (Perso.ai URL), billing.ts (PG 연동) — 외부 서비스 의존
