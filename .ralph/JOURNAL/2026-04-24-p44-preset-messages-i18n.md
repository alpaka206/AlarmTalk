# P44: 프리셋 메시지 i18n 전환

**날짜**: 2026-04-24
**BACKLOG 항목**: 자가 생성 — 프리셋 메시지 하드코딩 한국어 → i18n 전환

## 발견된 문제

`presets.ts`의 `PRESET_CATEGORIES`에 8개 카테고리 × 3개 = 24개 한국어 프리셋 메시지가 하드코딩되어 있었음:
- 영어 전환 시에도 한국어 메시지만 표시
- TTS 음성 생성 시에도 한국어 텍스트만 전달

## 접근

- `PresetCategory.messages: string[]` → `messageKeys: string[]` (i18n 키 배열)
- i18n 키 `preset.<category>.<index>` 패턴 (24개): ko 원본 + en 번역
- 소비자 2곳 (alarm/create, message/create)에서 `.map((key) => { const msg = t(key); ... })` 패턴으로 변환
- 테스트 업데이트: `cat.messages` → `cat.messageKeys`, 키 형식 검증

## 변경 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/constants/presets.ts` | `messages` → `messageKeys` (인터페이스 + 데이터) |
| `app/alarm/create.tsx` | 랜덤 선택 + 리스트 렌더 `t(key)` 전환 |
| `app/message/create.tsx` | 리스트 렌더 `t(key)` 전환 |
| `src/i18n/ko.json` | `preset.*` 24키 추가 |
| `src/i18n/en.json` | `preset.*` 24키 추가 (영어 번역) |
| `test/presets.test.ts` | `messages` → `messageKeys` + 키 형식 검증 변경 |

## 검증

- mobile `npx tsc --noEmit` — 0 errors
- backend `npx tsc --noEmit` — 0 errors
- mobile tests — 450/450 passed
- backend tests — 672/672 passed

## 다음 루프

하드코딩 한국어 문자열이 완전히 제거되었는지 최종 감사 필요.
