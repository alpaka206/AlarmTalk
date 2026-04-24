# P101 — noUncheckedIndexedAccess 활성화 (백엔드)

## 선택한 항목
BACKLOG 잔여 미완료 항목 모두 manual/blocked. Section 4에 따라 "TypeScript 엄격 모드 강화" 선택.
`noUncheckedIndexedAccess` 컴파일러 옵션 활성화 — 배열/객체 인덱스 접근 시 `undefined` 가능성을 강제 체크.

## 작업 내역

### 배경
`noUncheckedIndexedAccess`는 `arr[0]`이나 `obj[key]` 접근 시 `T | undefined`를 반환하도록 강제하는 TypeScript 옵션.
이를 통해 런타임 undefined 접근 버그를 컴파일 타임에 잡아낸다.

### 변경 사항
1. `packages/backend/tsconfig.json`에 `"noUncheckedIndexedAccess": true` 추가
2. 171개 TypeScript 에러 → 전체 수정 (27개 소스 파일)

### 수정 패턴
- **패턴 1: `rows[0]` → `rows[0]!`** (가장 빈번)
  - DB 쿼리 결과에서 `rows[0]` 접근 전 `rows.length` 체크가 이미 존재
  - 길이 체크 후 `!` non-null assertion 추가
- **패턴 2: Array destructuring → tuple cast**
  - `const [h, m] = str.split(':').map(Number)` → `as [number, number]`
  - `const [a, b, c] = parts` → `as [string, string, string]`
- **패턴 3: String split → `!`**
  - `str.split('T')[0]` → `str.split('T')[0]!` (ISO date 파싱)
- **패턴 4: Bounded loop → `!`**
  - `for (i < arr.length) arr[i]` → `arr[i]!`
- **패턴 5: Record property access → `!`**
  - `Row` (Record<string, Value>) property access → `row.field!`

## 변경 파일 (27개, 기존 수정)
1. `tsconfig.json` — noUncheckedIndexedAccess 활성화
2. `src/lib/jwt.ts` — bounded loop + tuple cast
3. `src/lib/invites.ts` — bounded loop
4. `src/lib/vouchers.ts` — bounded loop + string index
5. `src/lib/family-helpers.ts` — rows[0]
6. `src/middleware/auth.ts` — parts[1]
7-27. `src/routes/*.ts` (21개) — rows[0], split()[0], typedRow() 패턴

## 검증
- typecheck: backend 0 errors ✅
- typecheck: mobile 0 errors ✅ (별도 tsconfig, 미적용)
- 전체 테스트: 848/848 통과 ✅

## 다음 루프 참고
- 백엔드 `noUncheckedIndexedAccess` 완료
- 모바일 앱에도 동일 옵션 적용 가능 (apps/mobile/tsconfig.json)
- `noImplicitReturns`, `exactOptionalPropertyTypes` 등 추가 strict 옵션도 검토 가능
