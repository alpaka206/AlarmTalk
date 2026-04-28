# P50: 홈 화면 스타일 추출 + 마지막 하드코딩 한국어 수정

**날짜**: 2026-04-25
**BACKLOG 항목**: P48 잔여 — index.tsx (820줄) 분할

## 접근

P48에서 alarm/create (1146줄)와 alarm/edit (795줄)의 스타일을 추출한 패턴을 홈 화면에도 적용.
추가로, `또는`이라는 하드코딩 한국어 문자열 1건을 발견 → i18n 전환.

## 변경 파일 (4개)

| 파일 | 변경 내용 |
|------|----------|
| `src/styles/homeStyles.ts` | 신규 — 홈 화면 스타일 351줄 추출 |
| `(tabs)/index.tsx` | createStyles 제거 + createHomeStyles import (820→468줄, -43%) |
| `src/i18n/ko.json` | `common.or: "또는"` 추가 |
| `src/i18n/en.json` | `common.or: "or"` 추가 |

## i18n 발견

P46에서 "하드코딩 한국어 전면 전환 완료"로 선언했으나, `또는`이 1건 누락되어 있었다.
Grep 패턴 `또는|없습니다|입니다|합니다|하세요` 로 전체 앱 스캔 → 추가 누락 없음 확인.

## 검증

- mobile `npx tsc --noEmit` — 0 errors
- mobile tests — 466/466 passed
- 남은 하드코딩 한국어: 0건 (의도적 제외: ko.json, ProfileDropdown/dub '한국어' 네이티브 표기, 테스트 데이터)

## 대형 파일 현황 (P48+P50 후)

| 파일 | Before | After |
|------|--------|-------|
| alarm/create.tsx | 1146 | 641 |
| (tabs)/index.tsx | 820 | 468 |
| alarm/edit.tsx | 795 | 526 |

모든 화면 파일이 700줄 이하로 정리됨.
