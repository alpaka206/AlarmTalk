# P112 — 화면 비즈니스 로직 테스트 (voices, compose, note/create)

## BACKLOG 항목
BACKLOG 고갈 → "백엔드 테스트 커버리지 확장" 대신 **모바일 화면 비즈니스 로직 테스트** 선택.
기존 컴포넌트/서비스는 전수 테스트 완료 상태(898/898). 화면(screen) 레벨 테스트가 0건이었으므로 여기를 채움.

## 접근
- React Native 렌더링 없이 순수 비즈니스 로직만 추출하여 테스트 (기존 프로젝트 패턴 준수)
- 3개 화면의 핵심 로직 커버:
  1. **voices** (R1): 2-profile limit, status badge, family section visibility, query enablement, display profiles fallback
  2. **compose** (R4): auth/plan access gates, unread count, note sender display, query enablement
  3. **note/create** (R4): recipient filtering (self 제외), canSend validation, display name, char count

## 변경 파일
- `apps/mobile/test/voicesScreen.test.ts` (신규) — 46 tests
- `apps/mobile/test/composeScreen.test.ts` (신규) — 37 tests
- `apps/mobile/test/noteCreate.test.ts` (신규) — 31 tests

## 검증 결과
- 3개 파일 114 tests 전체 통과
- 전체 스위트: 1012/1012 passed (58 suites)
- Backend typecheck: 0 errors
- Mobile typecheck: 0 errors

## 판단 기록
- UTC 날짜 테스트에서 KST 타임존 차이로 `getFullYear` → `getUTCFullYear` 수정 필요했음
- Jest (jest-expo) 사용 (프로젝트 기존 설정), vitest가 아님
- 화면 통합 테스트(렌더링)는 RNRTL 설정 필요 — 별도 이터레이션으로 분리

## 다음 루프 참고
- 모바일 테스트 1012건 (58 파일)
- 화면 렌더링 테스트는 RNRTL 설정 후 별도 진행 가능
- BACKLOG에 P112 완료 기록 필요
