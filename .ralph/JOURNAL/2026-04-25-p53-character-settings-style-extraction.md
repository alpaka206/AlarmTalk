# P53: character + settings 스타일 추출

**날짜**: 2026-04-25
**BACKLOG 항목**: 자가 생성 — 500줄 이상 남은 화면 스타일 추출 (P48~P52 패턴 계속)

## 접근

P48~P52에서 확립된 createXxxStyles 패턴을 남은 500줄 이상 화면 2개에 적용:
1. `character/index.tsx` (541줄) — 캐릭터 화면
2. `settings/index.tsx` (518줄) — 설정 화면

## 변경 파일 (4개)

| 파일 | 변경 내용 |
|------|----------|
| `src/styles/characterStyles.ts` | 신규 — character 화면 스타일 241줄 추출 |
| `app/character/index.tsx` | createStyles 제거 + createCharacterStyles import (541→298줄, -45%) |
| `src/styles/settingsStyles.ts` | 신규 — settings 화면 스타일 155줄 추출 |
| `app/settings/index.tsx` | createStyles 제거 + createSettingsStyles import (518→363줄, -30%) |

## 검증

- mobile `npx tsc --noEmit` — 0 errors
- backend `npx tsc --noEmit` — 0 errors
- mobile tests — 466/466 passed

## 대형 파일 현황 (P48~P53 후)

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
| settings/index.tsx | 518 | 363 |

500줄 이상 남은 화면: alarm/edit.tsx (526), library/index.tsx (536), dub/translate.tsx (501)

## 다음 루프 참고

- settings/index.tsx의 SettingRow 컴포넌트 내부는 인라인 스타일 사용 중 (Spacing/FontSize 등 직접 참조). 별도 추출하면 ThemeColors 전달이 필요해 오히려 복잡해져 현재 상태 유지.
- 남은 500줄 이상 3개 파일(alarm/edit, library, dub/translate)도 동일 패턴으로 추출 가능.
