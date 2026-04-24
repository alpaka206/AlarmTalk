# P98 — Sentry 테스트 + 온보딩 접근성 개선

## 선택한 항목
BACKLOG 잔여 항목 모두 blocked/manual. Section 4에 따라 "테스트 커버리지 확장 + 접근성 강화" 선택.

## 작업 내역

### 1. sentry.ts 테스트 추가
모바일 lib 모듈 중 유일하게 미테스트였던 `sentry.ts`에 대한 단위 테스트 작성.
- DSN 미설정(undefined) 시 `Sentry.init` 호출 안 됨 확인
- 빈 문자열 DSN 시 `Sentry.init` 호출 안 됨 확인
- `@sentry/react-native`와 `expo-constants` 모킹

### 2. 온보딩 페이지 타이틀 접근성
- `onboarding.tsx` renderPage의 타이틀 Text에 `accessibilityRole="header"` 추가
- 스크린 리더(TalkBack/VoiceOver)에서 페이지 제목을 헤더로 인식하도록 개선

## 접근 판단
- 전체 코드베이스 접근성 감사 수행: 대부분의 터치 요소에 accessibilityLabel/Role 적절히 적용됨
- 온보딩 페이지 타이틀만 header role 누락 → 수정
- 모바일 lib 14개 모듈 중 sentry.ts만 테스트 미존재 → 추가

## 변경 파일 (2개)

### 신규 (1개)
1. `apps/mobile/test/sentry.test.ts` — Sentry 초기화 단위 테스트 (2 cases)

### 수정 (1개)
2. `apps/mobile/app/onboarding.tsx` — 페이지 타이틀에 accessibilityRole="header" 추가

## 검증
- sentry.test.ts: 2/2 통과
- typecheck: backend 0 errors, mobile 0 errors

## 다음 루프 참고
- 모바일 lib 모듈 전체(14/14) 테스트 완료
- 접근성 감사 결과 대부분 양호, 추가 개선 포인트 거의 없음
- 남은 BACKLOG 미완료: iOS/Android 렌더링 확인(manual), wrangler deploy(manual), Notion 기획서 3건(Notion 접근 필요)
