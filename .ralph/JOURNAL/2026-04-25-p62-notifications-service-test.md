# P62 — notifications 서비스 테스트

## 선택한 항목
BACKLOG 고갈 → 자가 생성: notifications.ts 서비스 테스트 커버리지

## 선택 이유
BACKLOG의 모든 항목이 완료 또는 blocked(manual/Notion/user action). 미테스트 서비스 중 `notifications.ts`는 211줄로, 복잡한 비즈니스 로직을 포함:
- weekday 변환 (JS 0=일→Expo 1=일, JS 1=월→Expo 2=월)
- daily vs weekly 트리거 분기
- 권한 체크 가드
- 푸시 토큰 등록/해제 에러 억제

`audio.ts`도 미테스트이나 Expo 네이티브 모듈 의존도가 높아 mock 복잡도 대비 로직 검증 가치가 낮았음.

## 접근
expo-notifications 전체를 jest.mock factory 내부에서 jest.fn()으로 대체.
주의점: notifications.ts는 모듈 로드 시 top-level `setNotificationHandler()` 호출이 있어, mock 변수를 factory 외부에 선언하면 Jest hoisting으로 undefined 참조 발생. factory 내부에서 jest.fn() 직접 생성 후 import → as jest.Mock 캐스트 패턴으로 해결.

## 변경 파일
1. `test/notifications.test.ts` 신규 (258줄, 31 tests)

## 검증
- typecheck: mobile 0 errors, backend 0 errors
- 테스트: mobile 497/497 통과 (기존 466 + P62 31)

## 다음 루프 참고
- audio.ts 서비스도 미테스트이나 expo-av/expo-file-system 모킹이 복잡하여 우선순위 낮음
- packages/shared 타입 불일치 이슈 발견: mobile types.ts는 snake_case, shared는 camelCase → 구조적 개선 필요하지만 대규모 리팩토링
- 자가 생성 풀에서 다음 후보: audio 서비스 테스트, 또는 TypeScript strict 추가 강화
