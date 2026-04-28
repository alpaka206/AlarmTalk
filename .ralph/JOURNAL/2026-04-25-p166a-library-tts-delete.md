# P166-A — 라이브러리 화면 TTS 메시지 삭제 UI 연동

## 선택한 항목
BACKLOG P166 "라이브러리 화면에 TTS 메시지 삭제 UI 연동 (deleteTtsMessage 활용)"

## 작업 내역

### 문제 파악
기존 라이브러리 삭제는 `deleteLibraryItem`만 호출 → 보관함 참조(message_library)만 제거, 실제 messages 레코드는 남아 DB에 고아 데이터 생성.
`deleteTtsMessage` API는 이미 구현되어 있었으나 (P164) UI에 미연결 상태.

### 구현
1. **LibraryListItem**: `onDelete` 시그니처를 `(id: string, messageId: string)` 로 확장하여 library item ID와 message ID 둘 다 전달
2. **Library screen**: 삭제 시 2가지 옵션 제공:
   - "보관함에서만 제거" → 기존 `deleteLibraryItem(id)` (shallow)
   - "완전히 삭제" → 확인 2차 알림 후 `deleteTtsMessage(messageId, true)` (deep, force)
3. **Deep delete**: 알람 쿼리도 무효화 (`queryKey: ['alarms']`) — 알람이 참조하던 메시지가 삭제될 수 있으므로
4. **i18n 4키 추가** (ko + en): removeFromLibrary, deletePermanently, deletePermanentlyTitle, deletePermanentlyConfirm

## 변경 파일 (4개)
1. `apps/mobile/src/components/LibraryListItem.tsx` — onDelete 시그니처 변경 (2줄)
2. `apps/mobile/app/library/index.tsx` — deepDeleteMutation 추가 + handleDelete 3단계 알림 로직
3. `apps/mobile/src/i18n/ko.json` — library 삭제 관련 i18n 4키 추가
4. `apps/mobile/src/i18n/en.json` — 동일 4키 영어 번역

## 검증
- typecheck: backend 0 errors, mobile 0 errors
- 전체 테스트: 1938/1938 통과 (변경 없음)
- i18n 키 검증: 14/14 통과 (ko/en 키 일치)

## 다음 루프 참고
- P166 남은 항목: 구독 관리 화면 구축 (getSubscription + checkout 활용)
- README 테스트 수는 이미 1938로 정확
