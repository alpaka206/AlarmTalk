# P46: 하드코딩 한국어 i18n 전환 Batch 2~4

**날짜**: 2026-04-25
**BACKLOG 항목**: P46 — 하드코딩 한국어 i18n 전환 잔여 (voucherShare, ErrorBoundary, character, friend fallback)

## Batch 2: voucherShare.ts
- `formatVoucherStatus` → TFunction 주입, 3건 (사용됨/만료/미사용) → `voucher.status*` 키
- `buildVoucherShareText` → TFunction 주입, 5줄 공유 메시지 → `voucher.share*` 키 (보간 포함)
- 테스트: mock t + i18n 키 검증

## Batch 3: ErrorBoundary.tsx
- `ErrorFallback` 함수 컴포넌트에 `useTranslation()` 추가
- 4건 → `errorBoundary.title`, `errorBoundary.subtitle`, `errorBoundary.retry`

## Batch 4: character.ts
- `STAGE_LABEL` → `STAGE_LABEL_KEYS` (i18n 키 매핑): 4건
- `DIALOGUES` → `DIALOGUE_KEYS` (i18n 키 배열): 28건 (4 스테이지 × 7 대사)
- `STREAK_DIALOGUES` → `STREAK_DIALOGUE_KEYS` (i18n 키 배열): 14건 (5 티어)
- `stageToLabel`, `listDialogues`, `pickRandomDialogue`, `pickStreakAwareDialogue` → TFunction 주입
- `character/index.tsx` 소비자 업데이트
- 테스트: mock t + i18n 키 검증 + listDialogues 키 형식 테스트 추가

## 기타
- `friend/[id].tsx` — '친구' fallback → `t('friendProfile.friendFallback')`

## 변경 파일 (10개)

| 파일 | 변경 내용 |
|------|----------|
| `src/lib/voucherShare.ts` | TFunction 주입, 8건 → i18n 키 |
| `src/components/ErrorBoundary.tsx` | useTranslation + 4건 → i18n 키 |
| `src/lib/character.ts` | TFunction 주입, 46건 → i18n 키 |
| `app/character/index.tsx` | stageToLabel(s, t), pickStreakAwareDialogue(s, streak, t, rng) |
| `app/friend/[id].tsx` | t('friendProfile.friendFallback') |
| `src/i18n/ko.json` | 58키 추가 (voucher 8, errorBoundary 3, character 46, friendFallback 1) |
| `src/i18n/en.json` | 동일 58키 추가 |
| `test/voucherShare.test.ts` | mock t + 키 검증 |
| `test/character.test.ts` | mock t + i18n 키 검증 |
| `test/familyAlarmLabel.test.ts` | (P45에서 이미 처리) |

## 검증

- mobile `npx tsc --noEmit` — 0 errors
- backend `npx tsc --noEmit` — 0 errors
- mobile tests — 451/451 passed (기존 450 + listDialogues i18n 키 형식 1건)
- backend tests — 672/672 passed

## 결과

P45+P46으로 하드코딩 한국어 문자열 **전면 제거 완료**. 남은 한국어 문자열:
- `src/i18n/ko.json` — 의도적 (한국어 번역 원본)
- `ProfileDropdown.tsx` '한국어' — 의도적 (언어 이름은 네이티브 표기)
- `dub/translate.tsx` '한국어' — 의도적 (ISO 언어 이름 네이티브 표기)
- 테스트 파일의 한국어 테스트 데이터 — 의도적

## 다음 루프

자가 생성 풀 잔여: 모바일 번들 사이즈 모니터링.
하드코딩 한국어 문자열 전면 전환 완료로 국제화 품질 대폭 향상.
