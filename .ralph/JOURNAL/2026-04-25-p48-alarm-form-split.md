# P48: 대형 화면 파일 컴포넌트 분할 리팩토링 (alarm/create + edit)

**날짜**: 2026-04-25
**BACKLOG 항목**: 자가 생성 풀 — "대형 화면 파일 컴포넌트 분할 리팩토링 (alarm/create.tsx 1147줄, alarm/edit.tsx 796줄)"

## 접근

alarm/create.tsx (1146줄)와 alarm/edit.tsx (795줄)에서 스타일 코드가 70%+ 중복됨을 확인.

3가지 추출:
1. **공유 스타일 모듈** (`src/styles/alarmFormStyles.ts`): 두 화면이 동일하게 사용하는 50+ 스타일 키를 단일 `createAlarmFormStyles(colors)` 함수로 추출
2. **PresetMessageSection 컴포넌트** (`src/components/PresetMessageSection.tsx`): create.tsx의 프리셋 메시지 섹션(카테고리 선택, 메시지 목록, TTS 생성)을 독립 컴포넌트로 추출
3. **각 화면별 로컬 스타일**: 화면 고유 스타일만 `createLocalStyles`로 잔류

## 결과

| 파일 | Before | After | 변화 |
|------|--------|-------|------|
| `alarm/create.tsx` | 1146 | 641 | -44% |
| `alarm/edit.tsx` | 795 | 526 | -34% |
| `src/styles/alarmFormStyles.ts` | (신규) | 281 | — |
| `src/components/PresetMessageSection.tsx` | (신규) | 302 | — |

## 변경 파일 (4개)

| 파일 | 변경 내용 |
|------|----------|
| `app/alarm/create.tsx` | 공유 스타일 import + PresetMessageSection 컴포넌트 사용으로 리팩토링 |
| `app/alarm/edit.tsx` | 공유 스타일 import으로 리팩토링, 중복 스타일 제거 |
| `src/styles/alarmFormStyles.ts` | 신규 — 50+ 공유 스타일 키 (timePicker, days, mode, snooze, message, voice 등) |
| `src/components/PresetMessageSection.tsx` | 신규 — 프리셋 메시지 토글/카테고리/목록/TTS 생성 UI |

## 검증

- mobile `npx tsc --noEmit` — 0 errors
- backend `npx tsc --noEmit` — 0 errors
- mobile tests — 466/466 passed
- backend tests — 672/672 passed
- bundleAudit tests — 15/15 passed (파일 크기 예산 준수)

## 다음 루프

남은 대형 파일: `(tabs)/index.tsx` (820줄). 하지만 이 파일은 홈 화면으로 다양한 위젯이 모여 있어 분할 이점이 제한적.
다른 후보: ADR 작성 또는 추가 품질 개선 항목.
