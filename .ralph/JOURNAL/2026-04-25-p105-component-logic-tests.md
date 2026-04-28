# P105 — NotificationBell + CoupleView 비즈니스 로직 테스트

## 선택 이유
STATE.md에서 명시적으로 "미테스트: 모바일 컴포넌트 (NotificationBell, CoupleView 등)"으로 언급됨.
BACKLOG 내 실행 가능 항목이 모두 완료되어 자가 생성 풀에서 선택.

## 접근
React 컴포넌트를 직접 렌더링하지 않고, 컴포넌트 내부의 순수 비즈니스 로직을 추출하여 테스트.
기존 프로젝트 패턴(profileDropdown.test.ts, stateView.test.ts)과 동일한 방식.

## 변경 파일
- `apps/mobile/test/notificationBell.test.ts` (신규) — 16 tests
  - formatBadgeCount: 5건 (1, 9, 10, 99, 0)
  - shouldShowBadge: 3건 (0, 1, 50)
  - getBellAccessibilityLabel: 3건 (0, 3, 1)
  - computeBadgeCount: 5건 (undefined, null, empty, non-empty, large)
- `apps/mobile/test/coupleView.test.ts` (신규) — 23 tests
  - sortCoupleMembers: 7건 (empty, single, owner-second, owner-first, two-members, immutability, extra-members)
  - areBothAlarmAllowed: 4건 (both true, first false, second false, both false)
  - computeInitialFromDisplayName: 5건 (lowercase, uppercase, Korean, emoji-surrogate, single char)
  - buildMemberDisplayName: 5건 (name, null name→email, both null→i18n, name priority, empty string→email)
  - getRoleLabelKey: 2건 (owner, member)

## 검증
- typecheck: backend + mobile 0 errors ✅
- 테스트: mobile 782/782 (기존 743 + 신규 39) ✅
- backend 테스트 미변경 (872/872 유지)

## 다음 루프 참고
- 남은 미테스트 컴포넌트: OfflineBanner, LoginButtons, PeopleSkeletonCard, QueryStateView
- OfflineBanner와 PeopleSkeletonCard는 순수 표시 컴포넌트로 추출할 로직이 최소
- LoginButtons는 auth 의존성이 강하여 통합 테스트가 더 적합
