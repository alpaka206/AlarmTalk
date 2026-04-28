# 2026-04-24 P9: dub 라우트 테스트 커버리지 확장

## 집은 항목
자가 생성 풀 → 백엔드 테스트 커버리지 확장 (dub 라우트)

## 접근
dub.test.ts는 기존 10개 테스트에서 GET /jobs, GET /:id (ready/failed/uploading/uuid validation/404)만 커버.
GET /languages, POST /, GET /:id (processing 상태의 Perso 폴링)이 모두 미테스트.

### 추가한 테스트 (12건)
**GET /dub/languages (2건)**
- 언어 목록 정상 반환
- Perso API 에러 시 500

**POST /dub (8건)**
- audio 누락 → 400
- source_language 누락 → 400
- target_language 누락 → 400
- source == target → 400
- 잘못된 source_message_id 포맷 → 400
- 성공 → 201 + Perso 호출 체인 검증
- 성공 + source_message_id 포함
- Perso 에러 → 500 + DB에 failed 기록
- space 없음 → 500

**GET /dub/:id processing 분기 (3건)**
- Perso 진행률 폴링 정상 (progress 45%)
- Perso에서 실패 보고 (hasFailed: true)
- Perso 폴링 에러 → 500
- 진행 100% → 다운로드 불가(no translated voice)

### 기술 이슈 해결
1. **PersoClient mock**: `vi.fn().mockImplementation(() => ...)` → 화살표 함수는 `new`로 호출 불가. `function()` 형태로 변경.
2. **ENV 바인딩**: `c.env.PERSO_API_KEY` 접근 시 env가 undefined. `app.request(r, undefined, ENV)` 패턴으로 해결.
3. **DB mock 순서**: `getSpaceSeq` 실패 시 INSERT가 실행되지 않으므로, catch의 UPDATE가 첫 번째 DB 호출.

## 변경 파일
1. `packages/backend/test/dub.test.ts` — 10→22 tests (+12), PersoClient mock 재작성, ENV 주입

## 검증
- dub.test.ts: 22/22 통과
- 전체 테스트: 553/553 통과 (기존 538 + 신규 15)
- Backend typecheck: 통과
- Mobile typecheck: 통과

## 다음 루프
- BACKLOG에 P9 기록 + 다음 커버리지 확장 항목 선택
