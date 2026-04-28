# P31: 하드코딩된 한국어 문자열 i18n 전환

**날짜**: 2026-04-24
**BACKLOG 항목**: 자가 생성 — 코드 품질 개선 (i18n 누락 수정)

## 접근

코드 탐색에서 3개 파일에 하드코딩된 한국어 문자열을 발견. i18n `t()` 호출로 전환하여 영어 전환 시에도 정상 표시되도록 수정.

## 변경 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/i18n/ko.json` | `speakerPicker.*` 19키 + `alarms.*` 3키 + `character.*` 3키 추가 |
| `src/i18n/en.json` | 동일 25키 영어 번역 추가 |
| `app/voice/picker.tsx` | `useTranslation` import + 20개 하드코딩 문자열 → `t()` 전환 |
| `app/(tabs)/alarms.tsx` | 미리듣기 관련 3개 하드코딩 문자열 → `t()` 전환 |
| `app/character/index.tsx` | DEV_EVENTS `label` → `labelKey` + 렌더 시 `t()` 호출 |

### picker.tsx 변경 상세
- 제목, 설명, 버튼 텍스트, 상태 메시지, 에러 메시지, 접근성 라벨 모두 i18n 전환
- 총 ~20개 하드코딩 문자열 제거

### alarms.tsx 변경 상세
- `previewPlay`: 미리듣기 재생 토스트
- `previewFailed`: 재생 실패 토스트
- `a11yPreview`: 미리듣기 버튼 접근성 라벨

### character/index.tsx 변경 상세
- DEV_EVENTS 배열의 `label` 필드를 `labelKey`로 변경 (i18n 키 참조)
- 렌더 시 `t(e.labelKey)` 호출로 런타임 번역

## 검증

- mobile `npx tsc --noEmit` — 0 errors
- backend `npx tsc --noEmit` — 0 errors
- ko.json / en.json JSON parse 검증 통과

## 다음 루프

추가 하드코딩 문자열 존재 (홈 화면 t() 폴백 문자열 등). 다음 iteration에서 처리 가능.
