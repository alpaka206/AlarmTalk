# P40: alarmPlayback.ts i18n 전환 — 하드코딩 한국어 문자열 제거

**날짜**: 2026-04-24
**BACKLOG 항목**: 자가 생성 — 하드코딩 한국어 문자열 제거 (alarmPlayback.ts)

## 발견된 문제

`src/lib/alarmPlayback.ts`에 6개 하드코딩 한국어 문자열이 남아있었음:
- `getAlarmModeBadge`: `'원본'` 라벨 → 영어 전환 시에도 한국어 표시
- `resolveAlarmPlayback`: fallback/error `reason` 4건 → 사용자에게 한국어만 표시
- `buildAlarmPreviewAction`: `${voiceName} 의 원본 샘플` → 한국어 캡션 하드코딩

이는 P31/P32에서 i18n 전환 작업 시 누락된 항목. 유틸 함수가 React 훅 바깥에 있어 `t()` 직접 사용이 불가했기 때문.

## 접근

- 유틸 함수가 **i18n 키(문자열)**를 반환하고, 소비자(컴포넌트)가 `t(key)` 로 번역하는 패턴
- 인터페이스 변경: `reason` → `reasonKey`, `label` → `labelKey`, `caption` → `captionKey` + `captionParams`
- 기존 테스트 17건 모두 업데이트 (하드코딩 문자열 매칭 → i18n 키 매칭)

## 변경 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/lib/alarmPlayback.ts` | 인터페이스 6개 필드명 변경 + 구현 7곳 i18n 키 반환으로 변경 |
| `app/(tabs)/alarms.tsx` | `t(action.captionKey)`, `t(action.messageKey)`, `t(badge.labelKey)` 호출 |
| `src/i18n/ko.json` | `alarmPlayback.*` 7키 추가 |
| `src/i18n/en.json` | `alarmPlayback.*` 7키 추가 (영어 번역) |
| `test/alarmPlayback.test.ts` | 테스트 6건 업데이트 (reason→reasonKey, label→labelKey 등) |

## 검증

- mobile `npx tsc --noEmit` — 0 errors
- backend `npx tsc --noEmit` — 0 errors
- alarmPlayback.test.ts — 17/17 통과
- a11y-audit.test.ts — 30/30 통과 (i18n 키 동기화 포함)
- 전체 mobile 테스트 — 395/395 통과

## 다음 루프

BACKLOG 자가 생성 풀에서 다음 항목 선택. 후보:
- 백엔드 API 응답 시간 벤치마크 테스트
- 모바일 번들 사이즈 모니터링
- 모바일 화면 컴포넌트 인터랙션 테스트
