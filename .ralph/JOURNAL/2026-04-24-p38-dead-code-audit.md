# P38: 미사용 export/함수 감사 (dead code 탐지 + 정리)

**날짜**: 2026-04-24
**BACKLOG 항목**: 자가 생성 풀 — 미사용 export/함수 감사

## 접근

전체 코드베이스에서 `export` 선언을 추출하고, 각각이 다른 파일에서 import되는지 검증.
백엔드(types, lib, routes, middleware)와 모바일(services, lib, components, hooks, constants) 모두 조사.

## 발견 사항

### 백엔드 (`packages/backend/src/types.ts`)
- **7개 미사용 인터페이스 발견**: VoiceProfile, Message, Alarm, UserProfile, Friendship, Gift, DubJob
- 이 타입들은 DB 행 구조를 문서화하기 위해 작성됐으나, 실제로 어디서도 import하지 않음
- 모바일 앱은 자체 `types.ts`에 별도 타입 정의 보유
- `Env`, `AppEnv`, `SentryClient`, `AuthVariables`만 실 사용 중

### 모바일 (`apps/mobile/src/components/QueryStateView.tsx`)
- **2개 미사용 컴포넌트 발견**: `LoadingView`, `EmptyView`
- `ErrorView`만 3곳에서 import (alarms, voices, library)
- `LoadingView`는 SkeletonCard 패턴으로 대체됨
- `EmptyView`는 StateView + 인라인 빈 상태 UI로 대체됨

### 유지 결정 (삭제하지 않은 항목)
- **invites.ts 4개 상수**: 내부 전용이나 테스트에서 import → export 유지
- **vouchers.ts `generateVoucherCodePlain`**: 테스트에서 import → export 유지
- **shared schemas 6개**: 테스트에서 검증 + 공개 API → export 유지
- **mobile api.ts 미사용 함수 7개**: 미래 기능용 API 표면 → 유지
- **character.ts `listDialogues`/`stageIndex`**: 테스트 전용이나 유효한 유틸 → 유지
- **auth.ts 3개 함수**: useAuth 훅 보조 유틸 → 유지

## 변경 파일

| 파일 | 변경 |
|------|------|
| `packages/backend/src/types.ts` | 7개 미사용 인터페이스 삭제 (83줄 → 27줄) |
| `apps/mobile/src/components/QueryStateView.tsx` | `LoadingView`, `EmptyView` 삭제 + ActivityIndicator import 제거 |

## 검증

- backend `npx tsc --noEmit` — 0 errors
- mobile `npx tsc --noEmit` — 0 errors
- backend tests: 653/653 passed
- mobile tests: 392/392 passed

## 다음 루프

자가 생성 풀에서 다음 항목 선택. 후보:
- 모바일 화면 컴포넌트 인터랙션 테스트
- ErrorBoundary 화면별 세분화
- 백엔드 API 응답 시간 벤치마크 테스트
