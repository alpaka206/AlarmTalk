# P1: People 탭 세그먼트 컨트롤 + 플랜별 분기

## 집은 항목
BACKLOG P1 — People 탭 신규 생성 (세그먼트 컨트롤, 플랜별 분기, 멤버 세그먼트)

## 접근
Phase 1-C에서 만든 기본 people.tsx를 3-세그먼트 구조로 확장. 

### 대안 검토
- **세그먼트를 탭 네비게이터(중첩)로 구현**: Expo Router에서 중첩 탭은 복잡하고 성능 이슈 가능. 단순한 상태 기반 세그먼트 컨트롤이 적합. 기각.
- **가족 알람 폼을 인라인으로 포함**: 화면이 비대해짐. `/family-alarm/create` 스택 화면으로 분리가 BACKLOG에 명시. 이번 루프에서는 버튼만 추가, 폼은 후속 루프에서 생성. 채택.

## 변경 파일 목록

### 수정
- `apps/mobile/app/(tabs)/people.tsx` — 전면 재작성:
  - 3-세그먼트 컨트롤 (Members/Friends/Requests)
  - `useAppStore`에서 plan 조회 → family 플랜이면 Members 세그먼트 표시 (기본), free/personal이면 숨김 (기본: Friends)
  - Members 세그먼트: `getFamilyGroupCurrent()` → 멤버 목록, 역할 뱃지(소유자/멤버), allow_family_alarms 표시
  - 커플 감지 (members.length === 2): 카드 스타일 강조
  - "가족 알람 보내기" 버튼 → `/family-alarm/create`로 이동
  - Friends 세그먼트: 기존 친구 목록 + 이메일 추가
  - Requests 세그먼트: 대기 요청 + 수락
- `apps/mobile/src/i18n/ko.json` — `people.*` 키 9개 추가
- `apps/mobile/src/i18n/en.json` — `people.*` 키 9개 추가

## 검증 결과
- `npx tsc --noEmit` (mobile) — 통과

## 다음 루프 주의사항
- **`/family-alarm/create` 스택 화면 미생성**. P1 "가족 알람 분리" 항목으로 남아 있음. 현재는 라우트가 없어서 탭하면 404. 다음 루프에서 생성 필요.
- **컴포넌트 추출 미완료**: `FamilyMemberRow`, `PeopleSkeletonCard` 추출은 P1 하위 항목.
- **커플 뷰**: 현재는 카드 border만 강조. 더 간결한 2인 전용 레이아웃은 후속 작업.
- `buildMemberDisplayName`은 `familyAlarmForm.ts`에서 import. P1 완료 후 컴포넌트 추출 시 위치 재검토 가능.
