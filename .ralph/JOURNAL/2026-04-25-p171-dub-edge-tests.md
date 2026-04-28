# P171 — dub 라우트 엣지 케이스 테스트 확장

## 선택한 항목
BACKLOG P171: dub/translate 라우트 엣지 케이스 테스트 확장

## 접근
기존 22개 테스트에서 미검증 코드 경로를 분석하여 14개 엣지 케이스 추가:

### GET /dub/languages (1개 추가)
- 빈 언어 목록 → 200 + empty array

### POST /dub (4개 추가)
- `getSasToken` 실패 → 500 + DB failed 기록 + error detail
- `uploadToBlob` 실패 → 500 + DB failed 기록
- `requestTranslation` 실패 → 500 + DB failed 기록
- non-Error throw → `detail: 'Unknown error'` + DB에도 'Unknown error' 기록

### GET /dub/jobs (1개 추가)
- SQL에 user_id 필터 + LIMIT 20 포함 확인 (다른 userId로 검증)

### GET /dub/:id (8개 추가)
- `ready` + `progress: null` → `Number(null) = 0` 반환
- `failed` + `error_message: null` → null 반환
- `processing` + `hasFailed` + empty `progressReason` → 기본 'Dubbing failed' 메시지
- 진행 100% + download 응답에 `audioFile: null` → 'Download link unavailable'
- 진행 100% + 오디오 fetch 실패 (404) → 500
- 진행 100% + source_message_id + 원본 메시지 존재 → 결과 메시지 + 라이브러리 생성 (full success path)
- 진행 100% + source_message_id + 원본 없음 → resultMessageId null
- `processing` + non-Error throw → `detail: 'Unknown error'`

### 기술 변경
- PersoClient mock을 IIFE 패턴에서 변수+static 할당 패턴으로 변경 (`toFileUrl` 정적 메서드 지원)
- full success path 테스트에서 `globalThis.fetch` 임시 교체 + 복원 패턴 사용

## 변경 파일
1. `packages/backend/test/dub.test.ts` — 14 tests 추가 (22→36)

## 검증
- `vitest run test/dub.test.ts` → 36 passed ✅
- `vitest run` (전체) → 1245 passed, 58 files ✅
- `tsc --noEmit` → backend 0 errors, mobile 0 errors ✅

## 다음 루프 참고
- notification 라우트 테스트 커버리지 추가 후보 (push 외 알림 관련)
- alarm-mutation 통합 테스트 확장 가능
