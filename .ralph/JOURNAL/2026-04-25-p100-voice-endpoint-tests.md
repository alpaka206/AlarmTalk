# P100 — 미테스트 Voice 엔드포인트 테스트 추가

## 선택한 항목
BACKLOG 잔여 미완료 항목 모두 manual/blocked. Section 4에 따라 "백엔드 테스트 커버리지 확장" 선택.
voice-profile.ts / voice-upload.ts에서 테스트가 없던 3개 엔드포인트 커버.

## 작업 내역

### 테스트 대상 분석
전체 route 모듈 vs 테스트 파일 대조 → 대부분 aggregator 통해 테스트 완료 확인.
미테스트 엔드포인트 3개 식별:
- `GET /voice/family` — 가족 멤버 음성 프로필 조회
- `POST /voice/clone` — ElevenLabs 음성 클론
- `POST /voice/diarize` — ElevenLabs 화자 분리

### 1. GET /voice/family (3 tests)
- 가족 멤버 없으면 빈 배열
- 가족 멤버의 ready 상태 음성 프로필 반환 (owner_name 포함)
- 가족 멤버 있지만 음성 프로필 없으면 빈 배열

### 2. POST /voice/clone (6 tests)
- MAX_VOICE_PROFILES(2) 초과 시 403 VOICE_LIMIT_REACHED
- audio 파일 누락 시 400 AUDIO_AND_NAME_REQUIRED
- name 누락 시 400 AUDIO_AND_NAME_REQUIRED
- name 50자 초과 시 400 NAME_TOO_LONG
- 정상 클론 시 201 + profile (voice_id, status=ready)
- ElevenLabs API 실패 시 500 VOICE_CLONING_FAILED

### 3. POST /voice/diarize (3 tests)
- audio 누락 시 400 AUDIO_FILE_REQUIRED
- 정상 분리 시 200 + speakers (label, total_duration 계산)
- ElevenLabs 실패 시 500 DIARIZATION_FAILED

### 인프라 변경
- voice.test.ts에 `vi.mock('../src/lib/elevenlabs')` 추가 → ElevenLabsClient mock
- `reqWithEnv()` 헬퍼 추가 — clone/diarize가 `c.env.ELEVENLABS_API_KEY` 접근하므로 Env 전달 필요
- 기존 38개 테스트는 ElevenLabs를 인스턴스화하지 않으므로 mock 추가에 영향 없음

## 변경 파일 (1개, 기존 수정)
1. `packages/backend/test/voice.test.ts` — 12 tests 추가 (38→53)

## 검증
- 신규 테스트: 12/12 통과
- 전체 테스트: 848/848 통과 (836 → 848, +12)
- typecheck: backend 0 errors, mobile 0 errors

## 다음 루프 참고
- voice-profile.ts, voice-upload.ts 엔드포인트 전체 테스트 완료
- 남은 미테스트 영역: character-mutation.ts (DB 의존 통합), billing-mutation.ts (DB 의존 통합) — 이미 aggregator 통해 간접 테스트됨
- 새로운 테스트 확장 방향: edge case 강화 (pagination, concurrent request), E2E 테스트, 또는 TypeScript strict 모드 강화
