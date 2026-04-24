# P102 — noUncheckedIndexedAccess 활성화 (모바일)

## 선택한 항목
BACKLOG 잔여 미완료 항목 모두 manual/blocked. Section 4에 따라 "TypeScript 엄격 모드 강화" 선택.
P101에서 백엔드에 적용한 `noUncheckedIndexedAccess`를 모바일 앱에도 적용.

## 작업 내역

### 배경
P101에서 백엔드 `noUncheckedIndexedAccess` 활성화 완료 (171개 에러, 27개 파일).
모바일 앱에도 동일 옵션 적용하여 배열/객체 인덱스 접근 시 `undefined` 가능성을 컴파일 타임에 검증.

### 변경 사항
1. `apps/mobile/tsconfig.json`에 `"noUncheckedIndexedAccess": true` 추가
2. 78개 TypeScript 에러 → 전체 수정 (27개 파일: 소스 13개 + 테스트 14개)

### 수정 패턴
- **패턴 1: `str.split(':').map(Number)` → tuple cast `as [number, number]`**
  - alarm time 파싱 (alarms.tsx, edit.tsx, notifications.ts)
- **패턴 2: `arr[0]` → `arr[0]!`** (가장 빈번)
  - `result.assets[0]` (length > 0 체크 후) — diarize, picker, upload
  - `(str || '?')[0]` → `[0]!` — friend/[id], message/create
  - `segments[0]` (length > 0 체크 후) — deepLink.ts
  - `parts[1]` (length === 3 체크 후) — auth.ts
- **패턴 3: `keys[idx]` → `keys[idx]!`** (i18n 키 접근)
  - character.ts, PresetMessageSection.tsx — 배열 길이 체크 후 인덱스 접근
- **패턴 4: `options as RecordingOptions`** (타입 호환)
  - audio.ts — spread된 RecordingOptionsPresets의 optional properties 문제
- **테스트 파일**: 주로 `mock.calls[0]!`, `result[0]!`, regex `match[1]!` 패턴

## 변경 파일 (27개)

### 소스 파일 (13개)
1. tsconfig.json — noUncheckedIndexedAccess 활성화
2. app/(tabs)/alarms.tsx — tuple cast + DAY_KEYS 인덱스
3. app/alarm/edit.tsx — tuple cast
4. app/friend/[id].tsx — string 인덱스
5. app/message/create.tsx — string 인덱스
6. app/voice/diarize.tsx — assets[0]
7. app/voice/picker.tsx — assets[0]
8. app/voice/upload.tsx — assets[0]
9. src/components/PresetMessageSection.tsx — keys 인덱스
10. src/lib/character.ts — keys 인덱스 (2곳)
11. src/lib/deepLink.ts — segments[0]
12. src/services/audio.ts — RecordingOptions cast
13. src/services/auth.ts — parts[1]
14. src/services/notifications.ts — tuple cast

### 테스트 파일 (14개)
15-27. test/*.test.ts — mock.calls, array index, regex match group 접근에 ! 추가

## 검증
- typecheck: mobile 0 errors ✅
- typecheck: backend 0 errors ✅
- 전체 테스트: 848/848 통과 ✅

## 다음 루프 참고
- Backend + Mobile 모두 `noUncheckedIndexedAccess: true` 완료
- 추가 strict 옵션 후보: `noImplicitReturns`, `exactOptionalPropertyTypes`
- `exactOptionalPropertyTypes`는 `undefined` vs 미지정을 구분 — 에러 수 예측 필요
