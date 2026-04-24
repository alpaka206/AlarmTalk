# P74 — WCAG AA 색상 대비 버그 수정 + a11y 테스트 정확성

## 선택한 항목
BACKLOG 고갈 프로토콜에 따라 코드베이스 감사. 발견:
- `a11y-audit.test.ts`의 WCAG AA 색상 대비 테스트가 **stale 하드코딩 색상**을 사용 중
- 테스트에 하드코딩된 LightColors/DarkColors가 UI 패키지 값이지, 실제 앱의 `constants/theme.ts` 값과 다름
- 결과: 테스트가 통과하지만 실제 앱의 `textSecondary` (#8E8E93)는 WCAG AA 미달

## 발견된 접근성 버그
실제 앱 색상으로 테스트 실행 시 3건 실패:
1. **라이트 모드**: `textSecondary` (#8E8E93) vs `background` (#FFF5F3) → ~3.1:1 (4.5 미달)
2. **라이트 모드**: `textSecondary` (#8E8E93) vs `surface` (#FFFFFF) → ~3.1:1 (4.5 미달)
3. **다크 모드**: `textSecondary` (#8E8E93) vs `surface` (#2C2C2E) → ~4.2:1 (4.5 미달)

## 접근
1. `a11y-audit.test.ts`의 하드코딩 색상을 `Colors`에서 import하도록 변경
2. WCAG AA를 충족하도록 `textSecondary` 색상 수정:
   - 라이트: #8E8E93 → #6B7280 (대비 4.7:1 vs white)
   - 다크: #8E8E93 → #98989D (대비 4.9:1 vs #2C2C2E)
3. `logger.ts`의 `any` 검토 → Hono Context 타입 불변성으로 `any` 필요 (이유 문서화)

## 변경 파일 (3개)
1. `apps/mobile/test/a11y-audit.test.ts` — 하드코딩 색상 → `Colors` import + 테스트명 수정
2. `apps/mobile/src/constants/theme.ts` — textSecondary WCAG AA 달성 색상으로 변경
3. `packages/backend/src/lib/logger.ts` — eslint-disable 주석에 불변성 이유 문서화

## 검증
- typecheck: backend 0 errors, mobile 0 errors
- 테스트: backend 724/724 통과, mobile 625/625 통과
- a11y-audit: 30/30 통과 (이전 stale 테스트도 30 통과였으나 실제 색상 미검증)

## 다음 루프 참고
- `packages/ui/src/tokens.ts`의 LightColors/DarkColors도 동일한 불일치 존재 (app과 별도 색상값)
- UI 패키지와 모바일 앱 간 색상 동기화는 더 큰 리팩토링 과제 — 별도 BACKLOG 항목으로 분리
- `logger.ts`의 `any`는 Hono 프레임워크 한계로 인해 불가피 (Context 타입 불변성)
