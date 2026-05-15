# Voice Profile Lazy Enrollment 설계

> 상태: Draft (proposal) — 미구현
> 작성: 2026-05-15
> 관련: PR #301, #302, #303 (선행 cleanup 작업)

## 1. 배경

현재 음성 프로필 흐름은 **eager enrollment** 다.

- 사용자가 `/voice/clone` 으로 오디오 업로드 → 즉시 ElevenLabs `POST /v1/voices/add` 호출 → `voice_id` 발급 → `voice_profiles.elevenlabs_voice_id` 컬럼에 저장
- ElevenLabs 무료/유료 플랜은 동시 보유 가능한 voice slot 수가 제한됨 (예: Starter 10개, Creator 30개)
- 우리 앱에서 사용자 1명이 만들 수 있는 프로필 수 (`MAX_VOICE_PROFILES`) 가 늘어나면 ElevenLabs 슬롯이 빠르게 고갈됨
- 보이스 클로닝 생성 자체는 character 비용을 소모하지 않음 (re-enroll 비용 = 0)
- 한 번 등록한 voice_id 는 사실상 식별자일 뿐, 그 자체에 큰 가치 없음

→ **언제든 raw 오디오로 재등록 가능**하다면, ElevenLabs 슬롯은 "최근 사용한 N개" 만 점유해도 충분.

## 2. 현재 상태 (As-Is)

### 2.1 흐름

```
[User]  upload audio + name
   │
   ▼
[POST /voice/clone]
   ├─ INSERT voice_profiles (status='processing')
   ├─ createEnrollmentAttempts() → ElevenLabs.createInstantClone(audioBuffer)
   ├─ UPDATE voice_profiles SET elevenlabs_voice_id=?, status='ready'
   └─ 201 { profile.id, voice_id }

[User] generate TTS
   │
   ▼
[POST /tts/generate]
   ├─ SELECT voice_profiles WHERE id=? → has elevenlabs_voice_id
   ├─ createSynthesisAttempts() → ElevenLabs.textToSpeech(voice_id, text)
   └─ 201 { audio_base64 }
```

### 2.2 데이터 모델

```
voice_profiles
├─ id (uuid)
├─ user_id
├─ name
├─ status (processing|ready|failed)
├─ elevenlabs_voice_id (텍스트, ElevenLabs voice_id)
├─ perso_voice_id (텍스트, 미사용)
├─ is_shared (boolean)
├─ deleted_at
└─ created_at / updated_at
```

R2 측에는 **raw 오디오 원본을 저장하지 않음** — `/voice/clone` 의 audioBuffer 는 ElevenLabs 로 한번 흘려보낸 뒤 메모리에서 사라짐.

### 2.3 한계

- ElevenLabs 슬롯이 가득 차면 신규 등록 실패 → 사용자에게 "음성 프로필을 만들 수 없습니다" 표시
- 사용자가 만든 voice 가 90일 이상 안 쓰여도 슬롯 점유 → 다른 사용자 신규 등록 차단
- 재가입/기기 교체 → ElevenLabs 등록은 그대로 남고 우리 측 DB 상태와 어긋날 수 있음

## 3. 목표 / 비목표

### Goals
- **G1.** ElevenLabs 슬롯 사용량을 "최근 N일/N번 합성한 voice" 로 한정
- **G2.** 사용자 입장에서는 프로필 수 제한 없이 자유롭게 음성 프로필을 만들 수 있도록 (DB 측 제한만 존재)
- **G3.** 슬롯 풀이 가득 차도 raw 오디오만 있으면 자동 재등록으로 합성 성공
- **G4.** 기존 알람 동작/캐시 키 비호환 없음 (`generated_audio_assets.request_hash` 의미 보존)

### Non-goals
- ElevenLabs 외 다른 TTS provider 도입 (별건)
- voice 의 long-term 백업/내보내기 기능
- 멀티 리전 R2 / CDN 최적화

## 4. 제안 설계 (To-Be)

### 4.1 데이터 모델 변경

```diff
 voice_profiles
   id, user_id, name, status, ...
-  elevenlabs_voice_id    -- (현재 그대로 유지하되 의미 변경: "현재 활성화된 slot")
+  elevenlabs_voice_id    -- nullable. enrolled 상태에서만 값이 있음.
+  raw_audio_object_key   -- NOT NULL once status='ready'. R2 객체 키. 재enroll 의 원천.
+  raw_audio_mime_type    -- e.g. 'audio/m4a'
+  raw_audio_size_bytes
+  raw_audio_duration_ms
+  last_enrolled_at       -- ElevenLabs 등록 / 갱신 시각 (LRU 선출용)
+  last_synthesized_at    -- 마지막으로 TTS 합성한 시각
```

원본 raw 오디오를 R2 에 영구 보관하는 것이 핵심.

### 4.2 새 API 흐름

```
[User] upload audio + name
   │
   ▼
[POST /voice/profile]   ← 이름만 변경 (semantic 다름)
   ├─ R2.put('voice-samples/{userPk}/{uuid}.m4a') ← raw 보관
   ├─ INSERT voice_profiles
   │     status='ready',
   │     raw_audio_object_key=..., raw_audio_mime_type=..., 등
   │     elevenlabs_voice_id=NULL (★ enroll 안 함)
   └─ 201 { profile }

[User] generate TTS
   │
   ▼
[POST /tts/generate]
   ├─ SELECT voice_profile
   ├─ if elevenlabs_voice_id NULL:
   │     ensureEnrolled(profile)              ← lazy enroll
   ├─ ElevenLabs.textToSpeech(voice_id, text)
   ├─ UPDATE voice_profiles SET last_synthesized_at=now()
   └─ 201 { audio_base64 }
```

### 4.3 `ensureEnrolled(profile)` 알고리즘

```
1. profile.elevenlabs_voice_id != NULL → return (이미 enroll됨)
2. raw = R2.get(profile.raw_audio_object_key)
3. try:
     vid = ElevenLabs.createInstantClone(raw.bytes, profile.name)
4. except slot_exhausted:
     evicted = findLruProfile()   ← 우리 DB에서 가장 오래 사용 안 한 enrolled 프로필
     ElevenLabs.deleteVoice(evicted.elevenlabs_voice_id)
     UPDATE voice_profiles SET elevenlabs_voice_id=NULL WHERE id = evicted.id
     vid = ElevenLabs.createInstantClone(raw.bytes, profile.name) ← retry
5. UPDATE voice_profiles SET elevenlabs_voice_id=vid, last_enrolled_at=now()
6. return vid
```

### 4.4 LRU 선출 정책

`findLruProfile()`:

```sql
SELECT id, elevenlabs_voice_id
FROM voice_profiles
WHERE elevenlabs_voice_id IS NOT NULL
  AND deleted_at IS NULL
  AND id != ?      -- 현재 enroll 시도 중인 자신 제외
ORDER BY COALESCE(last_synthesized_at, last_enrolled_at, created_at) ASC
LIMIT 1
```

후보군은 **전체 사용자의 enrolled voice** — ElevenLabs 슬롯은 전역 자원이므로 사용자 단위로 한정해서는 의미 없음.

### 4.5 호환성 / 마이그레이션

- 기존 `voice_profiles` 행은 `elevenlabs_voice_id` 가 채워져 있고 `raw_audio_object_key` 가 비어있음
- 마이그레이션 단계:
  1. 새 컬럼 추가 (`raw_audio_object_key` NULL 허용)
  2. 새 신규 클론은 이미 lazy 방식으로 저장
  3. 기존 enrolled 만 있는 행은 그대로 동작 — 단, eviction 후보에서는 제외 (raw 없으므로 재enroll 불가)
  4. 백필 옵션: 기존 사용자에게 "다시 녹음해주세요" 안내 후 점진 이행
- 모바일 API 응답 형태 변경 없음 — `profile.id` 만 사용

### 4.6 동시성 / 경합

- 같은 profile에 대해 동시 ensureEnrolled 호출 → 중복 enroll 가능성
  - 방어: 우리 DB 에서 `SELECT ... FOR UPDATE` 또는 Worker-level lock (Durable Object) 검토
  - 간이 방어: `INSERT INTO voice_enrollment_in_progress (profile_id) ON CONFLICT IGNORE` 후 확인
- LRU 선출과 신규 등록 사이에 다른 요청이 같은 evicted voice 를 enroll 시도할 가능성 → re-check 후 진행

### 4.7 R2 라이프사이클

- 프로필 삭제 시 raw 오디오 R2 객체도 함께 삭제 (PR #301 패턴 확장)
- 사용자 계정 삭제 시 cascade

### 4.8 비용 영향

| 항목 | 변화 | 추정 영향 |
|---|---|---|
| ElevenLabs voice slot 사용량 | ↓ (활성 voice 만 점유) | 슬롯 부족 사고 해소 |
| ElevenLabs clone API 호출 빈도 | ↑ (slot eviction 시 재enroll) | clone 호출 자체는 무과금 |
| ElevenLabs TTS character 비용 | 동일 | — |
| R2 저장 비용 | ↑ (raw sample 영구 보관) | 사용자당 30-60s × ~80kbps ≈ 300-600KB. 만 명 = 3-6GB |
| R2 GET 비용 | ↑ (재enroll 시 다운로드) | 평균 N회/voice — 미미 |

## 5. 실패 경로 / Edge case

| 케이스 | 처리 |
|---|---|
| R2 raw 객체가 사라짐 | profile.status = 'failed', UI 에서 "다시 녹음" 유도 |
| ElevenLabs API 다운 | 합성 실패 → 모바일은 기존 캐시 알람 그대로 작동 (이미 다운로드된 알람은 영향 없음) |
| eviction 대상이 없음 (모두 raw_audio 없는 legacy 행) | 신규 등록 실패 → 사용자에게 "잠시 후 다시 시도" |
| 같은 profile 동시 enroll 시도 | DB-side lock 또는 idempotent 보장 (4.6) |
| 사용자가 R2에 raw 가 있는 줄 모르고 voice 삭제 | profile delete 시 raw object 동반 삭제 (PR #301 정책 동일) |

## 6. 단계별 PR 분기 (제안)

1. **PR-A: 데이터 모델**
   - 마이그레이션 (`raw_audio_object_key`, `last_enrolled_at`, `last_synthesized_at` 컬럼 추가)
   - 기존 코드 동작 변화 없음 — 컬럼만 추가
2. **PR-B: lazy enrollment 백엔드**
   - `/voice/profile` 신규 엔드포인트 (raw 저장만, enroll X)
   - `ensureEnrolled(profile)` 헬퍼 + `findLruProfile()` 쿼리
   - `/tts/generate` 에 ensureEnrolled 훅 추가
   - 기존 `/voice/clone` 은 호환을 위해 유지 (deprecate)
3. **PR-C: 슬롯 eviction**
   - ElevenLabs 슬롯 가득 에러 catch → LRU evict → 재시도
   - 동시성 lock 도입
4. **PR-D: 모바일 전환**
   - 신규 엔드포인트로 호출 변경
   - 기존 사용자에게 "최신화" 안내
5. **PR-E: 기존 voice 마이그레이션 도구 (선택)**
   - 사용자가 raw 다시 업로드하면 lazy 로 전환되는 UI

## 7. 미결 결정 / Open questions

1. **raw 오디오 보관 기간** — 영구? 또는 N일 무합성 시 archive?
2. **공유 voice (가족/커플) 처리** — 공유 voice 도 lazy? 또는 공유 voice 는 항상 enrolled?
3. **eviction 정책 세분화** — LRU vs. LFU vs. (LRU + 활성 알람 가중치)
4. **첫 TTS 응답 지연 허용치** — clone(~3-5s) + TTS(~2-3s) = 5-8s. UX 상 사전 워밍업 필요한가?
5. **모바일 사전 enroll 트리거** — 사용자가 voice 선택할 때 백그라운드 enroll 요청 가능?
6. **레거시 voice (raw 없는 기존 enroll)** — 강제 재녹음 vs. 영구 유지

## 8. 다음 단계

- [ ] 본 문서 리뷰 / 결정 항목 합의
- [ ] PR-A 마이그레이션 시작 (실 코드는 아직 변화 없음 — 안전한 첫 단계)
- [ ] PR-B 백엔드 lazy enroll 구현
- 이후 PR-C ~ E 는 PR-B 안정화 후
