# P182-B2 — Prettier 포맷팅 Batch 2 (Backend: data + lib + middleware 일부)

## 선택 이유
BACKLOG P182 Prettier 포맷팅 배치 작업. Batch 1(shared/ui/voice 22파일)에 이어 backend src/ 53파일 중 첫 20파일 진행.

## 적용 내용
20파일 Prettier 포맷팅 완료:
- `packages/backend/src/data/presets.ts` (1파일)
- `packages/backend/src/index.ts` (1파일)
- `packages/backend/src/lib/*.ts` (15파일: character, db, elevenlabs, family-helpers, fcm, invites, jwt, logger, migrations, password, perso, scheduler, validate, vouchers, xpRules)
- `packages/backend/src/middleware/auth.ts`, `bodyLimit.test.ts`, `bodyLimit.ts` (3파일)

## 잔여
- Backend middleware 잔여: cache.test.ts, cache.ts, cors.test.ts, logger.test.ts, logger.ts, rateLimit.test.ts, rateLimit.ts, securityHeaders.test.ts, securityHeaders.ts (9파일)
- Backend routes: ~24파일
- Mobile: ~136파일
- 총 잔여: ~169파일 → Batch 3~N에서 계속

## 검증
- Backend typecheck: ✅ 0 errors
- Backend tests: ✅ 1379 passed (58 files)
- Mobile typecheck: ✅ 0 errors

## 다음 루프 주의사항
- 다음 배치: backend middleware 잔여 9파일 + routes 11파일 = 20파일 (Batch 3)
