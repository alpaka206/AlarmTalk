# P167 — 구독 화면 비즈니스 로직 테스트

## 선택한 항목
BACKLOG 고갈 → Section 4에 따라 "테스트 커버리지 확장" 선택. P166-B에서 만든 구독 화면의 비즈니스 로직 테스트.

## 작업 내역

### subscriptionScreen.test.ts (32 tests)
- **PLANS 상수 검증** (7): 개수, 순서, 유일키, 최소 기능 수, 기능 수 순서, i18n 네임스페이스
- **planTypeToUserPlan** (4): family→family, personal→plus, free→free, unknown→free
- **getActivePlanType** (4): 구독 있음, plan null, data undefined, plan만 존재
- **isPlanCurrent** (5): 일치, free+무구독, free+다른플랜, 불일치, free+구독
- **isPlanUpgrade** (5): free→personal, free→family, personal→family, free는 업그레이드 아님, 동일 플랜
- **formatDate** (3): 한국어, 영어, 미지원 로케일
- **피처 오버랩 검증** (4): 공통 기능 상속, 업그레이드 변환, family 독점 기능

### 수정 사항
- `queryCache.test.ts`: `subscription` 키 등록 (P166-B에서 누락 — 여기서 수정 확인)
- `README.md`: 테스트 수 1938→1970

## 변경 파일 (2개)
1. `apps/mobile/test/subscriptionScreen.test.ts` — 신규 (32 tests)
2. `README.md` — 테스트 수 업데이트

## 검증
- typecheck: backend 0 errors, mobile 0 errors
- 전체 테스트: 1970/1970 통과 (86 suites)
- i18n: 14/14 통과
