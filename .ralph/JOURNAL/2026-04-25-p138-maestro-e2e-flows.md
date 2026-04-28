# P138 — Maestro E2E 플로우 2개 추가 (home-character, alarm-edit-delete)

## 선택한 항목
BACKLOG 잔여 미완료 항목 모두 manual/blocked. Section 4에 따라 "모바일 E2E 테스트" 선택.
기존 9개 플로우에서 커버되지 않는 사용자 시나리오 2개 추가.

## 작업 내역

### 1. 10-home-character.yaml
홈 화면 핵심 요소 검증:
- 다음 알람 카운트다운 또는 빈 상태 텍스트 확인
- 빠른 시작 액션 그리드 존재 확인 (음성 녹음, 메시지 작성, 알람 추가, 코드 등록)
- 캐릭터 위젯 탭 → 캐릭터 상세 화면 이동 → 홈으로 복귀

### 2. 11-alarm-edit-delete.yaml
알람 편집/삭제 플로우:
- 알람 탭에서 알람 생성
- 생성된 알람의 시간 텍스트 탭 → 편집 화면 진입 확인
- 뒤로가기 → 스와이프 삭제 → 삭제 확인 다이얼로그

### 3. 기타
- config.yaml에 2개 플로우 등록
- README.md 테스트 수 보정: backend 1093→1099, E2E 9→11

## 변경 파일 (4개)
1. `apps/mobile/.maestro/10-home-character.yaml` (신규)
2. `apps/mobile/.maestro/11-alarm-edit-delete.yaml` (신규)
3. `apps/mobile/.maestro/config.yaml` (수정 — 2개 플로우 추가)
4. `README.md` (수정 — 테스트 수 보정)

## 검증
- typecheck: backend 0 errors, mobile 0 errors
- Maestro 플로우: YAML 문법 유효 (Maestro CLI 실행은 에뮬레이터 필요)

## 다음 루프 참고
- 커버되지 않는 시나리오: 다크모드 토글, 언어 전환, 로그아웃 플로우
- Jest worker leak 경고: 간헐적 발생, `forceExit: true` 추가 고려
