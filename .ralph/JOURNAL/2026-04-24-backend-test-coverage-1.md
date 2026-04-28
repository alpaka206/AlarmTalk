# 2026-04-24 백엔드 테스트 커버리지 확장 — Batch 1

## 집은 항목
자가 생성 풀: "백엔드 테스트 커버리지 확장 (character, family, billing, dub 라우트)"
→ 구체적으로: 테스트 미비 모듈 3개 (push route, streak lib, fcm lib) 테스트 작성

## 접근
기존 테스트 파일과 대조하여 커버리지 갭 분석:
- **push.ts 라우트** — 테스트 0건 → 신규 작성
- **streak.ts lib** — 테스트 0건 → 신규 작성
- **fcm.ts lib** — 테스트 0건 → 신규 작성
- r2-storage.ts — R2Bucket 모킹 복잡도 높아 다음 배치로 연기

대안: character.route.test.ts 기존 실패 수정도 고려했으나, rowToCharacter 호환 mock 구조 변경 필요하여 별도 배치로 분리.

## 변경 파일
1. `test/push.test.ts` (신규) — 14 tests: POST /push/token (8: validation + 3 platforms + trim + edge), DELETE /push/token (6: validation + 멱등성 + user isolation)
2. `test/streak.test.ts` (신규) — 17 tests: computeStreak (13: null, same-day, consecutive, gap, milestones 7/30/90, month/year boundary, reset), MILESTONE_BONUS_XP (4)
3. `test/fcm.test.ts` (신규) — 11 tests: getTokensForUser (3), sendPushNotifications (3: empty + success + log format), sendAlarmPush (3: no tokens + single + multi device)

## 검증
- 신규 3파일: 42 tests 전체 통과
- 전체 테스트: 521/528 통과 (7 실패는 기존 결함 — character.xp 4건, voice.e2e 2건, voice.test 1건)
- typecheck: 통과

## 기존 테스트 실패 분석
7개 기존 실패는 모두 R2/캐릭터 mock 구조 불일치:
- `character.xp.test.ts`: rowToCharacter가 row.id 접근 시 undefined — mock row에 필요 필드 누락
- `voice.e2e.test.ts` + `voice.test.ts`: R2 bucket(VOICE_BUCKET) mock 부재
→ 다음 배치에서 수정 예정

## Batch 2 (같은 루프에서 추가 진행)

기존 실패 7건도 이번 루프에서 수정 완료:
- `test/character.xp.test.ts` — baseCharacter에 streak 필드 3개 추가, mock 시퀀스에 ensureStatsRow/UPDATE stats/loadStats/loadAchievements 결과 추가. 전체 8/8 통과.
- `src/routes/voice.ts` — `getStorage(env)` → `getStorage(env?)` + optional chaining. c.env가 undefined인 테스트 환경 방어.
- voice.test.ts/voice.e2e.test.ts: 코드 수정 불요, 런타임 환경 방어 후 정상.

**결과: 42 test files, 528 tests, 0 failures. typecheck 통과.**

## 다음 루프
1. r2-storage.ts 테스트 작성 (R2Bucket mock 필요)
2. 자가 생성 풀에서 다음 항목
