# P162 — People 탭 가족 관리 UI 추가 (탈퇴/양도/멤버 제거)

## 선택한 항목
BACKLOG: "People 탭에 가족 관리 UI 추가 (탈퇴/양도/멤버 제거 — P161 API 함수 활용)"

## 작업 내역

### 1. FamilyMemberRow 액션 버튼 추가
- `onRemove?: () => void`, `onTransfer?: () => void` 프로퍼티 추가
- 소유자가 다른 멤버를 볼 때: 👑 (양도) + ✕ (제거) 버튼 표시
- 자기 자신이거나 소유자인 멤버에게는 버튼 미표시
- 액션 버튼 스타일: 36x36 원형, 양도=surfaceVariant 배경, 제거=error 반투명 배경

### 2. People 화면 관리 기능 통합
- `leaveFamilyGroup`, `transferFamilyOwnership`, `removeFamilyMember` import + useMutation 3개 추가
- 각 mutation에 성공 시 `family-group` 쿼리 무효화 + 토스트 표시
- 에러 시 `getApiErrorMessage` 로 번역된 에러 메시지 표시
- Alert.alert 로 확인 다이얼로그 구현 (모든 작업이 파괴적이므로 style: 'destructive')
- renderMember에서 isOwner + isSelf 기반으로 액션 콜백 조건부 전달
- 비소유자 멤버용 "그룹 탈퇴" 버튼: 커플뷰 하단 + FlatList 푸터에 배치

### 3. i18n 키 추가 (ko/en 각 11개)
- leaveGroup, leaveGroupTitle, leaveGroupConfirm, leaveGroupSuccess
- transferOwnership, transferOwnershipTitle, transferOwnershipConfirm, transferOwnershipSuccess
- removeMember, removeMemberTitle, removeMemberConfirm, removeMemberSuccess
- manage

### 4. 스타일 추가
- FamilyMemberRow: actions, actionBtn, actionBtnText, removeActionBtn, removeActionBtnText
- peopleStyles: leaveGroupBtn, leaveGroupBtnText
- coupleContainer에 paddingHorizontal 추가 (탈퇴 버튼 정렬용)

## 변경 파일 (5개)
1. `apps/mobile/src/components/FamilyMemberRow.tsx` — 액션 버튼 프로퍼티 + UI + 스타일
2. `apps/mobile/app/people/index.tsx` — 3개 mutation + 핸들러 + renderMember 업데이트 + 탈퇴 버튼
3. `apps/mobile/src/styles/peopleStyles.ts` — leaveGroupBtn 스타일 + coupleContainer 패딩
4. `apps/mobile/src/i18n/ko.json` — people.* 키 11개 추가
5. `apps/mobile/src/i18n/en.json` — people.* 키 11개 추가

## 검증
- Mobile typecheck: 0 errors ✅
- Backend typecheck: 0 errors ✅

## 다음 루프 참고
- 커플뷰(CoupleView)에서도 멤버 관리 액션이 필요할 수 있으나, 커플뷰는 2인 전용 특수 레이아웃이라 FamilyMemberRow를 쓰지 않음. 별도 액션 필요하면 추후 추가.
- 양도 후 UI가 즉시 갱신되는지 실기기 테스트 필요
