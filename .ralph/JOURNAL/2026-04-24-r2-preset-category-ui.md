# R2: 프리셋 메시지 카테고리 선택 UI 개선

**날짜**: 2026-04-24
**BACKLOG 항목**: R2 미완료 — 프리셋 메시지 카테고리 선택 UI 개선

## 접근

기존 프리셋 카테고리 UI는 8개 항목이 수평 스크롤 칩으로 표시되어 한 번에 3~4개만 보였고, 카테고리 라벨이 한국어로 하드코딩되어 i18n이 적용되지 않았다.

## 변경 사항

### 1. presets.ts — i18n 키 전환
- `label` 필드 → `i18nKey` 필드로 변경 (기존 `library.categoryMorning` 등 활용)
- `getCategoryLabel(cat, t)` 헬퍼 함수 추가
- `PresetCategory` 인터페이스 업데이트

### 2. alarm/create.tsx — 카테고리 UI 리빌드
- **수평 스크롤 칩 → 2열 그리드 카드**: 8개 카테고리가 2x4 그리드로 한 눈에 보임
- 각 카드: 이모지(24px) + i18n 라벨, 수평 배치
- 선택된 카드: primary 색상 배경 + 흰색 텍스트
- **랜덤 선택 버튼**: 메시지 목록 상단에 "🎲 랜덤" 버튼 추가 — 선택한 카테고리에서 랜덤으로 1개 메시지 선택
- **메시지 섹션 헤더**: "메시지 선택" 라벨 + 랜덤 버튼을 한 줄에 배치

### 3. message/create.tsx — i18n 적용
- `getCategoryLabel` import + `cat.label` → `getCategoryLabel(cat, t)` 전환

### 4. i18n 키 추가
- `alarmCreate.presetMessages`: "메시지 선택" / "Select message"
- `alarmCreate.randomMessage`: "🎲 랜덤" / "🎲 Random"

## 설계 결정

- **2열 그리드 선택**: 4열은 라벨이 잘리고, 1열은 너무 길다. 2열이 모바일에서 최적.
- **i18nKey 방식**: 기존 `library.category*` 키가 이미 ko/en 모두 존재하므로 새 키 생성 없이 재활용.
- **getCategoryLabel 헬퍼**: 인터페이스에서 `label` 직접 접근 대신 함수로 추상화하여 i18n 전환 보장.

## 변경 파일

| 파일 | 변경 |
|------|------|
| `src/constants/presets.ts` | PresetCategory.label → i18nKey, getCategoryLabel 추가 |
| `app/alarm/create.tsx` | 카테고리 그리드 + 랜덤 버튼 + 새 스타일 7개 |
| `app/message/create.tsx` | getCategoryLabel import + 사용 |
| `src/i18n/ko.json` | 2키 추가 |
| `src/i18n/en.json` | 2키 추가 |

## 검증

- mobile `npx tsc --noEmit` — 0 errors
- backend `npx tsc --noEmit` — 0 errors

## 다음 루프

R2 세부사항 계속: 최근 사용 메시지 목록 (AsyncStorage 캐싱).
