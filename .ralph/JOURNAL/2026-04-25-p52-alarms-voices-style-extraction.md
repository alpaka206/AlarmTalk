# P52: alarms.tsx + voices.tsx 스타일 추출

**날짜**: 2026-04-25
**BACKLOG 항목**: 자가 생성 — 대형 탭 화면 스타일 추출 (P48/P50/P51 패턴 계속)

## 접근

P48/P50/P51에서 확립된 스타일 추출 패턴을 남은 2개의 가장 큰 탭 화면에 적용:
1. `alarms.tsx` (668줄) — 알람 목록 탭
2. `voices.tsx` (619줄) — 음성 관리 탭

## 변경 파일 (4개)

| 파일 | 변경 내용 |
|------|----------|
| `src/styles/alarmsStyles.ts` | 신규 — alarms 화면 스타일 228줄 추출 |
| `app/(tabs)/alarms.tsx` | createStyles 제거 + createAlarmsStyles import (668→437줄, -35%) |
| `src/styles/voicesStyles.ts` | 신규 — voices 화면 스타일 268줄 추출 |
| `app/(tabs)/voices.tsx` | createStyles 제거 + createVoicesStyles import (619→348줄, -44%) |

## 검증

- mobile `npx tsc --noEmit` — 0 errors
- backend `npx tsc --noEmit` — 0 errors
- mobile tests — 466/466 passed

## 대형 파일 현황 (P48~P52 후)

| 파일 | Before | After |
|------|--------|-------|
| alarm/create.tsx | 1146 | 641 |
| (tabs)/index.tsx | 820 | 468 |
| alarm/edit.tsx | 795 | 526 |
| people/index.tsx | 770 | 494 |
| message/create.tsx | 727 | 406 |
| alarms.tsx | 668 | 437 |
| voices.tsx | 619 | 348 |

500줄 이상 남은 화면: character/index.tsx (541), library/index.tsx (536), alarm/edit.tsx (526), settings/index.tsx (518), dub/translate.tsx (501)
