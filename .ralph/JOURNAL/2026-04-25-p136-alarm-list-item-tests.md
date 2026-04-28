# P136 — AlarmListItem 컴포넌트 단위 테스트 추가

## 선택한 항목
BACKLOG 잔여 미완료 항목 모두 manual/blocked. Section 4에 따라 "백엔드 테스트 커버리지 확장" → 모바일 컴포넌트 테스트 커버리지 확장 선택.
AlarmListItem은 유일하게 테스트가 없는 React.memo 컴포넌트였음.

## 작업 내역

### AlarmListItem.test.tsx (17 tests)
- 시간 표시 렌더링
- 음성 이름 표시
- 메시지 텍스트 표시
- 반복 요일 formatRepeatDays 콜백 연동
- 활성/비활성 알람 CountdownText 조건부 렌더링
- TTS/sound-only 모드 뱃지 표시
- 카드 탭 → onPress(alarm) 호출
- 카드 롱프레스 → onDelete(id) 호출
- 미리듣기 버튼 → onPreview(alarm) 호출 (stopPropagation mock 필요)
- 토글 스위치 → onToggle(id, value) 호출
- 수신 가족 알람 뱃지 표시/비표시
- 접근성: 카드 라벨에 시간+음성, Switch에 toggleAlarm 라벨+checked 상태
- React.memo 래핑 확인

### 구현 시 해결한 문제
1. Swipeable mock 시 preview 버튼 중복 → `getAllByRole` + 마지막 요소 선택
2. `e.stopPropagation()` 호출 → `fireEvent`에 mock event 객체 전달

## 변경 파일 (1개, 신규)
1. `apps/mobile/test/AlarmListItem.test.tsx`

## 검증
- 신규 테스트: 17/17 통과
- 전체 모바일 테스트: 1113/1113 통과 (1096 → 1113, +17)
- typecheck: backend 0 errors, mobile 0 errors

## 다음 루프 참고
- 모바일 React.memo 컴포넌트 전체 테스트 완료 (19개 컴포넌트 × 테스트 파일 존재)
- Jest worker leak 경고 여전히 존재 — expo-notifications 모듈의 DevicePushTokenAutoRegistration이 원인. 실사용에는 무해하나 CI 개선 가능
- Section 4의 다른 영역 고려: Maestro E2E 추가, ADR 문서 작성, 또는 코드 품질 개선
