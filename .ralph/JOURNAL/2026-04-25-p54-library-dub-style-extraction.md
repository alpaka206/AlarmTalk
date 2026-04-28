# P54: library + dub/translate 스타일 추출

**날짜**: 2026-04-25
**BACKLOG 항목**: 자가 생성 — 500줄 이상 남은 화면 스타일 추출 (P48~P53 패턴 완료)

## 접근

P48~P53에서 확립된 createXxxStyles 패턴을 남은 500줄 이상 화면 2개에 적용:
1. `library/index.tsx` (536줄) — 라이브러리 화면
2. `dub/translate.tsx` (501줄) — 더빙 번역 화면

## 변경 파일 (4개)

| 파일 | 변경 내용 |
|------|----------|
| `src/styles/libraryStyles.ts` | 신규 — library 화면 스타일 180줄 추출 |
| `app/library/index.tsx` | createStyles 제거 + createLibraryStyles import (536→355줄, -34%) |
| `src/styles/dubTranslateStyles.ts` | 신규 — dub/translate 화면 스타일 192줄 추출 |
| `app/dub/translate.tsx` | createStyles 제거 + createDubTranslateStyles import (501→309줄, -38%) |

## 검증

- mobile `npx tsc --noEmit` — 0 errors
- backend `npx tsc --noEmit` — 0 errors
- mobile tests — 466/466 passed

## 대형 파일 현황 (P48~P54 후 — 스타일 추출 완료)

| 파일 | Before | After |
|------|--------|-------|
| alarm/create.tsx | 1146 | 641 |
| (tabs)/index.tsx | 820 | 468 |
| alarm/edit.tsx | 795 | 526 |
| people/index.tsx | 770 | 494 |
| message/create.tsx | 727 | 406 |
| alarms.tsx | 668 | 437 |
| voices.tsx | 619 | 348 |
| character/index.tsx | 541 | 298 |
| library/index.tsx | 536 | 355 |
| settings/index.tsx | 518 | 363 |
| dub/translate.tsx | 501 | 309 |

500줄 이상 남은 화면: alarm/create.tsx (641), alarm/edit.tsx (526). 두 파일 모두 alarmFormStyles.ts로 이미 공유 스타일 추출 완료 — 나머지는 비즈니스 로직/JSX로 추가 추출 의미 없음.

## 다음 루프 참고

- 스타일 추출 작업은 이 루프로 완료. 500줄 이상 파일은 alarm/create(641)과 alarm/edit(526)만 남았으나, 이미 P48에서 공유 스타일 추출 완료. 남은 코드는 폼 로직+JSX로 더 분할하면 오히려 가독성 저하.
- 다음 작업은 다른 카테고리에서 선택 필요 (테스트 확장, 접근성, 문서화 등).
