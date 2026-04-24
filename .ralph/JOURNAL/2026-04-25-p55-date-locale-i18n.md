# P55: 날짜 로캘 하드코딩 → i18n 동적 전환

**날짜**: 2026-04-25
**BACKLOG 항목**: 자가 생성 — `toLocaleDateString('ko-KR')` 하드코딩 7건을 i18n 언어 설정에 따라 동적으로 전환

## 문제

7개 화면 파일에서 `toLocaleDateString('ko-KR', ...)` 형태로 날짜를 표시하고 있어, 사용자가 영어 모드로 전환해도 날짜가 항상 한국어 형식으로 표시되는 i18n 버그.

## 접근

1. `src/i18n/index.ts`에 `getDateLocale()` 유틸 추가 — `i18n.language`를 `Intl` 로캘 문자열로 매핑 (ko→ko-KR, en→en-US)
2. 5개 파일 7건의 하드코딩 `'ko-KR'`을 `getDateLocale()` 호출로 교체

## 변경 파일 (6개)

| 파일 | 변경 내용 |
|------|----------|
| `src/i18n/index.ts` | `getDateLocale()` 함수 추가 (LOCALE_MAP + i18n.language 매핑) |
| `app/(tabs)/index.tsx` | `toLocaleDateString('ko-KR', ...)` → `getDateLocale()` |
| `app/(tabs)/voices.tsx` | `toLocaleDateString('ko-KR')` → `getDateLocale()` |
| `app/friend/[id].tsx` | `toLocaleDateString('ko-KR', ...)` → `getDateLocale()` |
| `app/message/[id].tsx` | `toLocaleDateString('ko-KR', ...)` → `getDateLocale()` |
| `app/library/index.tsx` | `toLocaleDateString('ko-KR', ...)` → `getDateLocale()` |
| `app/voice/[id].tsx` | `toLocaleDateString('ko-KR')` 2건 → `getDateLocale()` |

## 검증

- mobile `npx tsc --noEmit` — 0 errors
- mobile tests — 466/466 passed
- `grep 'ko-KR'` — 0건 (완전 제거 확인)

## 다음 루프 참고

- `compose.tsx`, `note/[id].tsx`, `people/index.tsx`에도 `toLocaleDateString()` 호출이 있으나, 이들은 인자 없이 호출하여 시스템 로캘을 사용 → 정상 동작이므로 변경 불필요.
