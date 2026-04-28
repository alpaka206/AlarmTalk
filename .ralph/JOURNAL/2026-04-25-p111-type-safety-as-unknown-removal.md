# P111 — `as unknown as` 타입 단언 제거

## BACKLOG 항목
TypeScript 엄격 모드 강화 (any 제거, 타입 보강) — 자가 생성 풀에서 선택

## 접근
소스 코드(테스트 제외)에서 `as unknown as` 패턴을 전수 조사하여 적절한 타입으로 교체.

### 발견된 캐스트 6건
1. `services/api/voice.ts` — `audioFile as unknown as Blob` 4건: React Native FormData는 `{uri, name, type}` 객체를 받지만 TS 타입에 반영되지 않음
2. `components/PresetMessageSection.tsx` — `width: '48%' as unknown as number` 1건: RN ViewStyle.width는 DimensionValue를 받으므로 캐스트 불필요
3. `services/audio.ts` — `status as unknown as { durationMillis: number }` 1건: expo-av RecordingStatus 타입에 durationMillis가 이미 정의됨

### 수정
1. `src/types/react-native-formdata.d.ts` 신규 — FormData.append에 RN 파일 객체 오버로드 추가 (global interface merge)
2. `services/api/voice.ts` — 4건 캐스트 제거 → `formData.append('audio', audioFile)` 직접 사용
3. `components/PresetMessageSection.tsx` — `width: '48%'` 직접 사용 (DimensionValue 호환)
4. `services/audio.ts` — `status.durationMillis` 직접 접근 (RecordingStatus 타입에 정의됨)

## 변경 파일
- `apps/mobile/src/types/react-native-formdata.d.ts` (신규)
- `apps/mobile/src/services/api/voice.ts` (수정)
- `apps/mobile/src/components/PresetMessageSection.tsx` (수정)
- `apps/mobile/src/services/audio.ts` (수정)

## 검증
- Backend typecheck: 0 errors
- Mobile typecheck: 0 errors
- Backend tests: 872/872 passed
- Mobile tests: 898/898 passed

## 잔여 `as unknown as` 현황
- `packages/backend/src/lib/db-types.ts` — `typedRow<T>(row: Row): T` 함수의 중앙 집중식 캐스팅 (의도적 설계, 유지)
- 모바일 src 소스: 0건 (전부 제거 완료)
- 테스트 파일: mock/stub용 캐스트 존재 (정상)

## 다음 루프 참고
- `as unknown as` 0건 달성 (소스 코드 기준)
- db-types.ts의 typedRow는 Turso Row의 index signature 제한 때문에 불가피 — 향후 Turso SDK가 제네릭 지원하면 제거 가능
