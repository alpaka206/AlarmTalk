# P118 — voice-profile + voice-upload 통합 테스트

## 선택한 항목
BACKLOG P118: voice-profile.test.ts + voice-upload.test.ts 작성

## 작업 내역

### 1. voice-profile.test.ts (47 tests)
기존 voice.test.ts가 aggregator를 통해 테스트하던 것을 split module 직접 import로 재구성 + 엣지 케이스 추가:

- **GET / 프로필 목록** (8 tests): 빈 목록, 기본 pagination, limit 클램핑 (최대 100, 0→50 폴백), offset 음수→0, status 필터 (ready/processing/failed 유효, invalid 무시)
- **GET /:id 상세** (4 tests): UUID 검증, 404, 정상 반환, user_id 소유권 쿼리 검증
- **PATCH /:id 이름 변경** (9 tests): UUID 검증, JSON 아닌 body, 빈 이름, 공백만(trim), 51자 초과, 50자 정확히, 숫자 타입 name, 404, 정상 변경 + updated_at
- **GET /:id/stats** (4 tests): UUID, 404, 통계 반환(메시지+알람), target_user_id 포함 검증
- **POST /clone** (8 tests): 2개 제한 403, 1개일 때 통과, audio/name 누락, name 50자 초과/정확히, INSERT→UPDATE 순서 검증, ElevenLabs 실패 500, audioBuffer 전달 확인
- **DELETE /:id** (8 tests): UUID, 404, 409(in-use), force=true cascade(4단계 DELETE 순서), 메시지 없을 때 바로 삭제, ElevenLabs 삭제 호출/실패 허용/미호출 조건
- **GET /family** (5 tests): 멤버 없음, 멤버+음성, 멤버+음성 없음, ready 필터, 자기 자신 제외

### 2. voice-upload.test.ts (41 tests)
- **POST /upload** (13 tests): 정상 201, audio 누락, MIME 불일치 415, 빈 파일, 10MiB 초과 413, 10MiB 정확히 통과, durationMs(0/음수/문자열→400, 생략→null), originalName(200자 잘림, 생략→파일명), DB INSERT 값 검증
- **POST /separate** (4 tests): UUID, 404, 403, 정상 201(speakers+provider), DELETE→INSERT 멱등성
- **GET /speakers** (5 tests): UUID, 404, 403, 정상(정렬), 빈 배열, ORDER BY 쿼리 검증
- **PATCH /speakers** (12 tests): uploadId/speakerId UUID, JSON body, label(빈/공백/51자/50자), 404(업로드/화자), 403, 정상 200, UPDATE 쿼리 검증
- **POST /diarize** (4 tests): audio 누락, 성공(라벨+duration 계산), 500, non-Error 예외, DB 쿼리 0건

## 변경 파일 (2개, 모두 신규)
1. `packages/backend/test/voice-profile.test.ts` — 47 tests
2. `packages/backend/test/voice-upload.test.ts` — 41 tests

## 검증
- 신규 테스트: 88/88 통과
- 전체 테스트: backend 1068/1068 (57 suites), mobile 1012/1012
- typecheck: backend 0 errors, mobile 0 errors

## 다음 루프 참고
- P118 완료. BACKLOG의 남은 미완료 항목은 모두 manual/blocked (iOS/Android 렌더링 확인, wrangler deploy)
- Section 4 지침에 따라 새 항목을 BACKLOG에 추가하여 진행해야 함
