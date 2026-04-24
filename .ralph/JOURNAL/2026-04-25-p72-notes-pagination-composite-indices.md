# P72 — Notes 페이지네이션 완성 + 복합 DB 인덱스

## 선택한 항목
BACKLOG 고갈 프로토콜에 따라 새 항목 탐색. 코드베이스 감사 결과:
- TypeScript `any` 타입: 전체 157 파일 중 1건만 존재 (justified) → 작업 불필요
- Rate limiting: 이미 구현됨 (sliding window 60 req/min)
- Notes 페이지네이션: `total` count 누락 (다른 list 엔드포인트와 불일치)
- DB 복합 인덱스: 주요 쿼리 패턴에 대한 인덱스 부재

## 선택 이유
프로덕션 준비도 향상. Notes 엔드포인트만 `total`이 없어 프론트엔드에서 전체 개수/페이지 수를 알 수 없었음.
복합 인덱스는 데이터 증가 시 쿼리 성능에 직접 영향.

## 접근
1. `notes.ts`의 GET /received, GET /sent에 `Promise.all`로 COUNT 쿼리 병렬 실행
2. 응답에 `total`, `limit`, `offset` 추가 (기존 paginated 엔드포인트와 동일 패턴)
3. Migration 19 추가: 6개 복합 인덱스

## 변경 파일 (4개)
1. `routes/notes.ts` — GET /received, GET /sent에 COUNT 쿼리 + total/limit/offset 응답 추가
2. `lib/migrations.ts` — Migration 19: composite-indices (6개 인덱스)
   - `idx_friendships_a_status(user_a, status)` — WHERE user_a=? AND status=? 최적화
   - `idx_friendships_b_status(user_b, status)` — WHERE user_b=? AND status=? 최적화
   - `idx_gifts_recipient_created(recipient_id, created_at DESC)` — 수신 선물 정렬
   - `idx_gifts_sender_created(sender_id, created_at DESC)` — 발신 선물 정렬
   - `idx_alarms_user_active(user_id, is_active)` — 활성 알람 필터
   - `idx_alarms_target_active(target_user_id, is_active)` — 수신 알람 필터
3. `test/notes.test.ts` — COUNT 쿼리 mock 결과 추가 + total/limit/offset assertion
4. `test/api-latency.test.ts` — notes/received latency 테스트 mock 수정

## 검증
- typecheck: backend 0 errors, mobile 0 errors
- 테스트: backend 684/684 통과

## 다음 루프 참고
- 모든 list 엔드포인트가 이제 일관된 페이지네이션 응답 (total/limit/offset) 반환
- `dub/jobs`, `user/search`, `stats/activity`는 하드코딩 LIMIT (의도적 — 사용 맥락상 페이지네이션 불필요)
- `voice/family`는 unbounded지만 가족 그룹 크기가 작아서 (최대 6명 × 2 음성 = 12건) 실질적 리스크 없음
- BACKLOG 고갈 상태 유지 — 다음 루프에서 새 항목 탐색 필요
