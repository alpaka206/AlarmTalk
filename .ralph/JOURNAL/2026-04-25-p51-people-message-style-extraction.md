# P51: people/index.tsx + message/create.tsx 스타일 추출

**날짜**: 2026-04-25
**BACKLOG 항목**: 자가 생성 — 대형 화면 파일 스타일 추출 (P48/P50 패턴 계속)

## 접근

P48/P50에서 alarm/create, alarm/edit, index.tsx의 스타일을 추출한 패턴을 두 개의 가장 큰 남은 파일에 적용:
1. `people/index.tsx` (770줄) — 내 사람들 화면
2. `message/create.tsx` (727줄) — 메시지 작성 화면

## 변경 파일 (4개)

| 파일 | 변경 내용 |
|------|----------|
| `src/styles/peopleStyles.ts` | 신규 — people 화면 스타일 275줄 추출 |
| `app/people/index.tsx` | createStyles 제거 + createPeopleStyles import (770→494줄, -36%) |
| `src/styles/messageCreateStyles.ts` | 신규 — message/create 스타일 320줄 추출 |
| `app/message/create.tsx` | createStyles 제거 + createMessageCreateStyles import (727→406줄, -44%) |

## 검증

- mobile `npx tsc --noEmit` — 0 errors
- mobile tests — 466/466 passed
- backend typecheck — 0 errors

## 대형 파일 현황 (P48+P50+P51 후)

| 파일 | Before | After |
|------|--------|-------|
| people/index.tsx | 770 | 494 |
| message/create.tsx | 727 | 406 |
| alarm/create.tsx | 1146 | 641 |
| (tabs)/index.tsx | 820 | 468 |
| alarm/edit.tsx | 795 | 526 |

500줄 이상 남은 화면: alarms.tsx (668), voices.tsx (619), character/index.tsx (541), library/index.tsx (536), alarm/edit.tsx (526), alarm/create.tsx (641), settings/index.tsx (518), dub/translate.tsx (501)
