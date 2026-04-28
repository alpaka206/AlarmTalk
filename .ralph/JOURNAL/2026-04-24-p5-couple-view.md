# P5: 커플 뷰 개선 — 전용 2인 카드 레이아웃

## 작업 항목
BACKLOG P5 — 커플 뷰(family 2인 그룹): 서로가 보이는 간결한 카드 레이아웃

## 접근 방식
기존: 2인 그룹일 때 개별 FamilyMemberRow에 `borderWidth: 1` 테두리만 추가하는 방식.
개선: 두 멤버를 하나의 카드 안에 나란히 보여주는 전용 CoupleView 컴포넌트 생성.

### 디자인 결정
- 두 아바타를 나란히 배치하고 💕 이모지로 연결 시각화
- 아바타 아래에 이름 + 역할 표시
- 하단에 알람 수신 상태와 "가족 알람 보내기" 버튼 통합
- Owner 아바타는 primary 색상으로 구분
- 초대 코드 섹션은 `renderInviteSection()` 헬퍼로 추출하여 커플 뷰와 일반 멤버 리스트 모두에서 재사용

### 대안 검토
- 전용 페이지로 분리: 과잉 — 2인이므로 카드 하나로 충분
- 수평 스크롤 카드: 2인에는 불필요한 복잡성

## 변경 파일 (4개)
1. `apps/mobile/src/components/CoupleView.tsx` (신규) — 전용 2인 카드 컴포넌트
2. `apps/mobile/app/(tabs)/people.tsx` — CoupleView import + isCouple 분기 + renderInviteSection 추출
3. `apps/mobile/src/i18n/ko.json` — 3개 키 추가 (coupleConnected, bothAlarmAllowed, coupleAlarmHint)
4. `apps/mobile/src/i18n/en.json` — 동일 3개 키 추가

## 검증
- Mobile typecheck: ✅ 통과
- Backend typecheck: ✅ 통과

## 다음 작업
P5 카드 스타일 일관성 또는 알람 시간 설정 UI 개선으로 진행
