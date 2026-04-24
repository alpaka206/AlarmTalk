# P110 — 미테스트 모바일 컴포넌트 3개 단위 테스트 추가

## 선택한 항목
BACKLOG 잔여 항목 모두 완료/manual/blocked. Section 4에 따라 "테스트 커버리지 확장" 선택.
모바일 컴포넌트 14개 중 3개(FamilyMemberRow, MiniWaveformPlayer, Toast)에 전용 테스트 파일 없음 → 추가.

## 작업 내역

### 1. familyMemberRow.test.ts (22 tests)
- 아바타 이니셜 계산: 영어, 한국어, 이메일 폴백, i18n 폴백
- 역할 감지: owner/member 판별, 레이블 키 매핑
- 조건부 렌더링 프레디케이트: 이메일 표시 여부, 알람 허용 표시 여부
- 커플 카드 스타일 적용 로직
- 표시 이름 우선순위: name > email > i18n fallback

### 2. miniWaveformPlayer.test.ts (26 tests)
- 진행률 계산: 0 duration, 음수 duration, 중간, 시작, 끝, 소수점
- 재생 상태 업데이트: 위치/길이 갱신, 재생 완료 처리, 0 duration 무시, 불변성
- 토글 액션 결정: pause/resume/replay/play_new/no_cache 5가지 분기
- 바 색상: progress 기준 primary/light 분기, 양 극단
- 접근성: play/pause 레이블 전환
- 시간 표시: duration 유무 분기, 분 경계

### 3. toast.test.ts (9 tests)
- 가시성: message 존재 시 렌더, null 시 미렌더, 빈 문자열, 공백
- 메시지 추출: 정상, null, 한국어, 이모지
- 포인터 이벤트: 항상 비활성 (pass-through)

## 변경 파일 (3개, 모두 신규)
1. `apps/mobile/test/familyMemberRow.test.ts`
2. `apps/mobile/test/miniWaveformPlayer.test.ts`
3. `apps/mobile/test/toast.test.ts`

## 검증
- 신규 테스트: 57/57 통과 (Jest)
- typecheck: backend 0 errors, mobile 0 errors

## 다음 루프 참고
- 모바일 컴포넌트 14개 전체 전용 테스트 파일 보유 완료
- 남은 테스트 갭: 화면 통합 테스트 (tab screens, stack screens), E2E 테스트
- 대안 작업: README 업데이트, 앱 아이콘/스플래시, 스토어 메타데이터 준비
