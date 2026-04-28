# P19 — DB Row 타입 안전성 강화 (as unknown as 제거)

## BACKLOG 항목
P19: `as unknown as` 더블 어서션 패턴 제거 + 기타 라우트 `as Record<string, unknown>` 패턴 개선

## 접근
1. `db-types.ts` 유틸리티 신규 작성:
   - `typedRow<T>(row: Row): T` — 더블 어서션을 한 곳으로 중앙화
   - `getFormFile(formData, name)` — FormData에서 File 추출 시 타입 안전 함수 (런타임 타입 가드)
2. 3개 파일의 10개 `as unknown as` 패턴 모두 제거:
   - `auth.ts` (2건): DB row → typedRow
   - `voice.ts` (7건): FormData 4건 → getFormFile, DB row 3건 → typedRow
   - `dub.ts` (1건): FormData → getFormFile
3. 기타 라우트의 `as Record<string, unknown>` 패턴도 개선:
   - `character.ts`: rowToCharacter 시그니처를 `Record<string, unknown>` → `Row`로 변경 (호출부 캐스트 2건 제거), loadStats/loadAchievements/xp-log 3건 → typedRow
   - `tts.ts`: alarmCount 1건 → typedRow
   - `voice.ts`: count/cnt 3건 → typedRow

## 대안 검토
- 런타임 유효성 검증 (getString/getNumber 등): 안전하지만 모든 필드 접근 패턴을 대대적으로 변경해야 하므로 비용 대비 효과 낮음
- `Row` 직접 사용: `rowToCharacter`처럼 함수 시그니처를 `Row`로 변경하면 캐스트 불필요. character.ts에 적용

## 변경 파일 (7개)
- `packages/backend/src/lib/db-types.ts` (신규) — typedRow + getFormFile
- `packages/backend/src/routes/auth.ts` — 2건 제거
- `packages/backend/src/routes/voice.ts` — 10건 제거 (7 as unknown as + 3 as Record)
- `packages/backend/src/routes/dub.ts` — 1건 제거
- `packages/backend/src/routes/character.ts` — 5건 개선 (rowToCharacter 시그니처 변경 + typedRow)
- `packages/backend/src/routes/tts.ts` — 1건 개선

## 검증
- Backend typecheck: 0 errors
- Mobile typecheck: 0 errors
- Backend tests: 596/596 passed
- `as unknown as` 잔존: db-types.ts 1곳 (중앙화된 유틸리티 내부)만 남음

## 다음 루프 주의사항
- `as Record<string, unknown>` 패턴이 alarm.ts에 4건 남아 있지만, AlarmRow가 이미 Record<string, unknown> 기반이라 단일 어서션으로 안전함
- `as string` 단일 어서션 (friend.ts의 google_id, dub.ts의 formData.get)도 남아 있으나 이는 TypeScript 표준 패턴
