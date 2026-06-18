# ElevenLabs API 사용 현황

AlarmTalk 백엔드(Cloudflare Workers)가 ElevenLabs로 호출하는 모든 API를 정리한 문서.

- **Base URL**: `https://api.elevenlabs.io`
- **인증**: 모든 요청 헤더에 `xi-api-key: <ELEVENLABS_API_KEY>`
- **API 키**: 환경 변수 `ELEVENLABS_API_KEY` (Worker secret)
- **클라이언트 래퍼**: `packages/backend/src/lib/elevenlabs.ts` 의 `ElevenLabsClient` 클래스 하나로 모든 호출을 감싼다.
- **사용 모델**
  - TTS: `eleven_v3` (기본값, `DEFAULT_TTS_MODEL_ID`)
  - STT/화자분리: `scribe_v2`

---

## 1. Instant Voice Clone — 음성 클론 생성

| 항목 | 값 |
|------|-----|
| 메서드 | `POST /v1/voices/add` |
| 본문 | `multipart/form-data` (`files`, `name`, `remove_background_noise`) |
| 응답 | `{ voice_id }` |
| 래퍼 | `ElevenLabsClient.createInstantClone()` |

**용도**: 사용자가 업로드한 60~120초 음성 샘플로 즉시 음성 프로필을 만든다. `remove_background_noise: true`로 배경 잡음 제거.

**호출 경로**
- `lib/voice-provider.ts` → `createEnrollmentAttempts()` 의 `enroll()`
- `routes/voice-profile.ts` → `POST /clone` (유료 플랜 전용, 음성 프로필 1개 한도)

---

## 2. Text to Speech — 텍스트 음성 변환

| 항목 | 값 |
|------|-----|
| 메서드 | `POST /v1/text-to-speech/{voiceId}` |
| 본문 | JSON (`text`, `model_id`, `language_code`, 조건부 `voice_settings`) |
| 헤더 | `Accept: audio/mpeg` |
| 응답 | 오디오 바이너리 (`ArrayBuffer`, mp3) |
| 래퍼 | `ElevenLabsClient.textToSpeech()` |

**voice_settings** (모델이 `eleven_v3`가 **아닐** 때만 전송):
- `stability` (기본 0.5)
- `similarity_boost` (기본 0.82)
- `style` (기본 0.25)
- `speed` (기본 0.96)
- `use_speaker_boost` (옵션)

> `eleven_v3`는 voice_settings를 보내지 않고 `text` + `model_id` (+ `language_code`)만 전송한다.

**지원 언어**: ko, en, ja, fr, it (`SUPPORTED_SYNTHESIS_LANGUAGES`)

**호출 경로**
- `lib/voice-provider.ts` → `createSynthesisAttempts()` 의 `synthesize()`
- `routes/tts.ts` → `POST /generate`
  - 생성 전 캐시(`generated_audio_assets.request_hash`) 확인 → **히트 시 ElevenLabs 호출 없이** R2 저장 오디오 재사용
  - 시스템(스톡) 보이스는 전체 사용자가 캐시 공유 → 한계 비용 ≈ 0
  - 무료 플랜은 시스템 보이스 + 프리셋 고정 문구만 허용, 일일 생성 한도(free 3회)

---

## 3. Speech to Text (화자 분리) — Diarization

| 항목 | 값 |
|------|-----|
| 메서드 | `POST /v1/speech-to-text` |
| 본문 | `multipart/form-data` (`file`, `model_id=scribe_v2`, `diarize=true`, `timestamps_granularity=word`, `tag_audio_events=false`) |
| 응답 | 단어별 타임스탬프 + `speaker_id` → 화자별 세그먼트로 가공 |
| 래퍼 | `ElevenLabsClient.diarize()` |

**용도**: 업로드 음성에서 화자를 분리(최대 3명). 단어 간격 0.35초(`DIARIZATION_MERGE_GAP_SECONDS`) 이내는 같은 세그먼트로 병합.

**호출 경로**
- `routes/voice-upload.ts` → `POST /uploads/:uploadId/separate` (저장된 업로드 분리)
- `routes/voice-upload.ts` → `POST /diarize` (즉석 업로드 분리)

---

## 4. Delete Voice — 음성 프로필 삭제

| 항목 | 값 |
|------|-----|
| 메서드 | `DELETE /v1/voices/{voiceId}` |
| 응답 | 없음 (void) |
| 래퍼 | `ElevenLabsClient.deleteVoice()` |

**용도**: 음성 프로필 삭제 시 ElevenLabs 쪽 보이스도 정리. 외부 삭제가 실패해도 로컬 DB 삭제는 진행(best-effort).

**호출 경로**
- `routes/voice-profile.ts` → `DELETE /:id`
- `lib/audio-retention.ts` → 보존기간 만료/유료 해지 정리 크론

---

## 5. List Voices — 음성 목록 조회

| 항목 | 값 |
|------|-----|
| 메서드 | `GET /v1/voices` |
| 응답 | `{ voices: [{ voice_id, name }] }` |
| 래퍼 | `ElevenLabsClient.listVoices()` |

**용도**: 사용 가능한 보이스 목록 조회. (현재 클라이언트에 구현되어 있으며, 운영/디버깅 보조용)

---

## 요약 매트릭스

| # | ElevenLabs API | 래퍼 메서드 | 주요 호출 위치 |
|---|----------------|-------------|----------------|
| 1 | `POST /v1/voices/add` | `createInstantClone` | voice-profile `/clone`, voice-provider enroll |
| 2 | `POST /v1/text-to-speech/{id}` | `textToSpeech` | tts `/generate`, voice-provider synthesize |
| 3 | `POST /v1/speech-to-text` | `diarize` | voice-upload `/separate`, `/diarize` |
| 4 | `DELETE /v1/voices/{id}` | `deleteVoice` | voice-profile `/:id` 삭제, audio-retention 크론 |
| 5 | `GET /v1/voices` | `listVoices` | (보조/운영) |

## 비용·캐싱 메모

- TTS는 **글자 수 과금**이라 재생성도 매번 차감된다. → `request_hash` 기반 캐시로 동일 (보이스 × 문구 × 언어 × 모델 × 포맷) 조합은 **단 한 번만** 생성.
- 클론 생성은 보이스 슬롯을 소모 → `VOICE_LIMIT_REACHED` / `voice_add_edit_counter` 등 슬롯 소진 에러를 `VOICE_SLOT_EXHAUSTED`(503)로 변환.
- 생성 오디오는 R2(`VOICE_BUCKET`)에 저장하고 DB(`generated_audio_assets`)에 메타·해시 기록.
