# P32: t() 폴백 문자열 패턴 정리

**날짜**: 2026-04-24
**BACKLOG 항목**: 자가 생성 풀 — t() 폴백 문자열 패턴 정리

## 접근

`t('key', '폴백')` 패턴은 i18n 키가 누락될 때 하드코딩된 한국어 문자열을 표시하는 방어 코드였다. 문제:
1. 일부 폴백이 실제 i18n 값과 불일치 (예: `common.loadError` 폴백 "불러오기 실패" vs 실제 "데이터를 불러올 수 없습니다")
2. 영어 사용자에게 한국어 폴백이 노출될 위험
3. i18n 키 누락을 감추어 버그 발견을 어렵게 함

해결: 누락 키를 모두 추가한 뒤 폴백 인자를 제거.

## 변경 파일

### i18n 키 추가 (14키 × 2파일 = 28건)
- `src/i18n/ko.json` — home.activeAlarms/messages/friends/pendingGifts (4), login.error/saveFailed/noToken/unknownError/googleFailed/appleFailed (6), giftReceived.rejectSuccess (1), settings.notifPermission/permitted/notPermitted (3)
- `src/i18n/en.json` — 동일 14키 영어 번역

### 폴백 제거 (6파일, 24건)
- `app/(tabs)/index.tsx` — 11건 (home.*, common.*)
- `src/components/LoginButtons.tsx` — 7건 (login.*)
- `app/gift/received.tsx` — 1건
- `app/friend/[id].tsx` — 1건
- `app/_layout.tsx` — 1건
- `app/settings/index.tsx` — 4건 (settings.name/email/notifPermission/permitted/notPermitted → 3 t() 호출)

## 설계 결정

- `common.back` 기존 폴백이 `< 돌아가기`였으나 i18n 값은 `돌아가기`. `< ` 접두사는 UI 장식이므로 i18n에 포함하지 않음 — JSX에서 필요 시 별도 추가하는 것이 올바름. 현재 코드에서는 `accessibilityLabel`이 이미 별도 처리하고 있으므로 문제 없음.

## 검증

- `grep -r "t('[^']+', '" apps/mobile/**/*.tsx` — 0건 (모든 폴백 제거 확인)
- mobile `npx tsc --noEmit` — 0 errors
- backend `npx tsc --noEmit` — 0 errors

## 다음 루프

BACKLOG 자가 생성 풀에서 다음 항목: `백엔드 console.error → 구조화 로깅 전환` 또는 `접근성 자동화 테스트`.
