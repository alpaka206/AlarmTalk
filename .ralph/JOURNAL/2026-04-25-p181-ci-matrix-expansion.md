# P181 + P182-B1 — CI 매트릭스 확장 + Prettier 포맷팅 Batch 1

## 선택 이유
BACKLOG 잔여 항목 모두 사용자 액션 대기 상태 (Sentry DSN, 앱 아이콘 에셋, wrangler deploy, 디바이스 테스트). Section 4 규칙에 따라 새 항목 발굴 → CI 파이프라인 갭 발견.

## 발견된 갭
1. `packages/ui` (38 tests) + `packages/voice` (11 tests)가 CI typecheck/test 매트릭스에서 누락
2. `npm run format:check` 스크립트 존재하지만 CI에 미포함 → 263파일 포맷 불일치로 즉시 추가 불가

## 적용 내용
- `.github/workflows/ci.yml` — typecheck 매트릭스에 `packages/ui`, `packages/voice` 추가 (3→5)
- `.github/workflows/ci.yml` — test 매트릭스에 `packages/ui`, `packages/voice` 추가 (3→5)
- `README.md` — 테스트 현황 표에 UI 토큰(38), Voice 어댑터(11) 행 추가
- `format:check` 추가는 보류 — 263파일 포맷팅 수정이 선행 필요 (BACKLOG에 기록)

## P182 Batch 1 — Prettier 포맷팅
- packages/shared (6), packages/ui (9), packages/voice (7) = 22파일 포맷팅
- 모든 패키지 테스트 통과: shared 12, ui 38, voice 11
- 잔여: backend 107파일 + mobile 136파일 → 다음 루프에서 배치 진행

## 변경 파일
- `.github/workflows/ci.yml`
- `README.md`
- `packages/shared/**` (6파일)
- `packages/ui/**` (9파일)
- `packages/voice/**` (7파일)

## 검증
- Backend typecheck: ✅ 0 errors
- Mobile typecheck: ✅ 0 errors
- packages/ui typecheck + 38 tests: ✅
- packages/voice typecheck + 11 tests: ✅

## 다음 루프 주의사항
- Prettier 포맷팅 수정은 263파일 → 20파일씩 배치로 진행해야 함 (mega-commit 금지 규칙)
- BACKLOG에 P182 포맷팅 배치 작업 추가됨
