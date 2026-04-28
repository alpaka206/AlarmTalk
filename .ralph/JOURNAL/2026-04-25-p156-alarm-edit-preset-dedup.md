# P156 — 알람 편집 PresetMessageSection 추가 + 타입 중복 제거

## 선택한 항목
BACKLOG 잔여 미완료 항목 모두 manual/blocked. R0-R5 QA 검증 수행 결과, R2 스펙 갭 발견:
알람 편집 화면(`alarm/edit.tsx`)에 PresetMessageSection이 누락되어 있어 기존 메시지만 선택 가능하고 프리셋에서 새 TTS를 생성할 수 없었음.
추가로 `AlarmMode`/`VibrationPattern`/`WakeMode` 타입이 `types.ts`와 `alarmForm.ts`에 중복 정의되어 있던 코드 품질 이슈도 수정.

## 작업 내역

### 1. 알람 편집 화면 PresetMessageSection 추가
`alarm/edit.tsx`에 `alarm/create.tsx`와 동일한 프리셋 메시지 기능 추가:
- `showPreset`, `presetCategory`, `presetText`, `presetVoiceId`, `recentPresets` 상태 5개 추가
- `loadRecentPresets` 콜백 + useEffect (offlineCache에서 최근 프리셋 로드)
- `ttsMutation` (generateTTS API 호출) + `handlePresetGenerate` (캐시 확인 → TTS 생성)
- `PresetMessageSection` 컴포넌트 렌더링 (메시지 목록과 저장 버튼 사이)
- `generateTTS`, `getRecentPresetMessages`, `addRecentPresetMessage` import 추가
- `useCallback` import 추가

### 2. 타입 중복 제거
- `src/lib/alarmForm.ts`에서 `AlarmMode`, `VibrationPattern`, `WakeMode` 로컬 정의 삭제
- `src/types.ts`에서 import하도록 변경
- `AlarmFormInput`/`AlarmCreatePayload` 인터페이스는 import된 타입을 그대로 참조

## 변경 파일 (2개)
1. `apps/mobile/app/alarm/edit.tsx` — PresetMessageSection 통합 (imports + state + mutations + 렌더링)
2. `apps/mobile/src/lib/alarmForm.ts` — 중복 타입 정의 제거, `types.ts`에서 import

## 검증
- Backend typecheck: 0 errors ✅
- Mobile typecheck: 0 errors ✅

## 다음 루프 참고
- 알람 편집 화면에서도 프리셋 TTS 생성이 가능해짐 (create/edit 기능 대칭 완성)
- 테스트 파일들(`alarmEditScreen.test.ts`, `alarmCreateScreen.test.ts`)은 자체 로컬 타입 정의를 사용하므로 영향 없음
