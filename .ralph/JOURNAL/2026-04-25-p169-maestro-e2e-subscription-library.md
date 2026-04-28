# P169 — Maestro E2E 플로우 2개 추가 (subscription, library-delete)

## 작업 항목
- BACKLOG P169: 모바일 E2E 테스트 확장 (Maestro — subscription, library-delete 플로우)

## 접근
- 기존 11개 Maestro 플로우 패턴을 따라 일관된 스타일로 작성
- subscription: 프로필 드롭다운 → 설정 → 구독 관리 화면 진입 → 플랜 카드 3개(Free/Plus/패밀리) 확인 → 가격 표시 → 업그레이드 다이얼로그 → 취소
- library-delete: 홈 → 전체 보기 → 보관함 진입 → 필터 탭 전환 → 메시지 스와이프 삭제 → 2단계 삭제 다이얼로그 → 취소
- 두 플로우 모두 빈 상태(empty state) 대응을 위해 optional 플래그 적극 사용

## 변경 파일
- `apps/mobile/.maestro/12-subscription.yaml` — 신규 E2E 플로우
- `apps/mobile/.maestro/13-library-delete.yaml` — 신규 E2E 플로우
- `apps/mobile/.maestro/config.yaml` — 실행 순서에 2개 추가
- `README.md` — E2E 테스트 수 11→13 플로우 업데이트

## 검증
- Backend typecheck: 통과 (0 errors)
- Mobile typecheck: 통과 (0 errors)
- YAML syntax: 기존 패턴과 동일한 구조

## 다음 루프 참고
- Maestro 실행은 에뮬레이터 필요 — 사용자가 직접 `maestro test` 실행해야 함
- 남은 P169 항목: alarm-mutation 통합 테스트 확장
