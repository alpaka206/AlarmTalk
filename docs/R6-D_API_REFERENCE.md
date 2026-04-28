# VoiceAlarm — API 레퍼런스

**Base URL**: `https://voice-alarm-api.voicealarm.workers.dev`

## 인증

모든 보호된 엔드포인트는 `Authorization: Bearer <JWT>` 헤더가 필요합니다.
JWT는 로그인/회원가입 시 발급되며, 유효기간은 7일입니다.

## 미들웨어

| 미들웨어 | 설명 |
|----------|------|
| Logger | 구조화 로깅 (method, path, status, duration) |
| Rate Limiter | 60 req/min per IP |
| Body Limit | 512KB 최대 |
| CORS | 화이트리스트 기반 |
| Auth | JWT 검증 → userId 주입 |

## 공통 에러 응답

```json
{
  "error": "에러 코드",
  "message": "사람이 읽을 수 있는 설명"
}
```

| HTTP 상태 | 에러 코드 | 설명 |
|-----------|-----------|------|
| 400 | VALIDATION_ERROR | 입력 검증 실패 |
| 401 | UNAUTHORIZED | 인증 토큰 없음/만료 |
| 403 | FORBIDDEN | 권한 부족 |
| 404 | NOT_FOUND | 리소스 없음 |
| 429 | RATE_LIMITED | 요청 제한 초과 |
| 500 | INTERNAL_ERROR | 서버 내부 오류 |

---

## 1. 인증 API (`/api/auth`)

### POST /api/auth/register
회원가입 (이메일/비밀번호)

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securePassword123",
  "name": "홍길동"
}
```

**Response (201):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "홍길동",
    "plan": "free"
  }
}
```

### POST /api/auth/login
로그인 (이메일/비밀번호)

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securePassword123"
}
```

**Response (200):** 동일 형태 (token + user)

### GET /api/auth/me
현재 사용자 조회 (수동 토큰 확인)

**Headers:** `Authorization: Bearer <JWT>`

**Response (200):**
```json
{
  "user": { "id": "uuid", "email": "...", "name": "...", "plan": "free" }
}
```

---

## 2. 사용자 API (`/api/user`) 🔒

### GET /api/user/me
현재 사용자 프로필 + 통계

### PATCH /api/user/me
사용자 설정 업데이트

**Request Body:**
```json
{ "allow_family_alarms": true }
```

### PATCH /api/user/plan
플랜 변경

**Request Body:**
```json
{ "plan": "family" }
```

### DELETE /api/user/me
계정 삭제 (관련 데이터 전체 cascading 삭제)

### GET /api/user/search
이메일로 사용자 검색

**Query:** `?q=user@example.com`

---

## 3. 음성 API (`/api/voice`) 🔒

### GET /api/voice
내 음성 프로필 목록

**Query:** `?page=1&limit=10`

**Response (200):**
```json
{
  "profiles": [
    {
      "id": "uuid",
      "name": "엄마 목소리",
      "status": "ready",
      "provider": "perso",
      "created_at": "2026-01-01T00:00:00Z"
    }
  ],
  "total": 1
}
```

### GET /api/voice/family
가족 멤버 음성 프로필 (읽기 전용)

**Response (200):**
```json
{
  "profiles": [
    {
      "id": "uuid",
      "name": "아빠 목소리",
      "status": "ready",
      "owner_name": "홍아빠",
      "owner_id": "uuid"
    }
  ]
}
```

### GET /api/voice/:id
음성 프로필 상세

### PATCH /api/voice/:id
음성 프로필 이름 수정

**Request Body:**
```json
{ "name": "새 이름" }
```

### POST /api/voice/clone
음성 클론 생성 (최대 2개 제한)

**Request Body:** `multipart/form-data`
- `audio`: 오디오 파일 (MP3/WAV)
- `name`: 프로필 이름

**에러 코드:**
- `VOICE_LIMIT_REACHED`: 음성 프로필 2개 초과

### POST /api/voice/upload
오디오 파일 업로드 (클론 전 전처리)

### POST /api/voice/uploads/:uploadId/separate
업로드 파일 화자 분리

### GET /api/voice/uploads/:uploadId/speakers
분리된 화자 목록 조회

### PATCH /api/voice/uploads/:uploadId/speakers/:speakerId
화자 라벨 수정

### POST /api/voice/diarize
ElevenLabs 화자 분리

### GET /api/voice/:id/stats
음성 프로필 사용 통계

### DELETE /api/voice/:id
음성 프로필 삭제

**Query:** `?force=true` (연관 데이터 포함 삭제)

---

## 4. TTS API (`/api/tts`)

### GET /api/tts/presets ⚡ (Public)
프리셋 메시지 목록 (인증 불필요)

**Response (200):**
```json
{
  "presets": [
    {
      "id": "uuid",
      "text": "좋은 아침이에요!",
      "category": "morning",
      "language": "ko"
    }
  ]
}
```

### POST /api/tts/generate 🔒
TTS 음성 생성

**Request Body:**
```json
{
  "voice_profile_id": "uuid",
  "text": "좋은 아침이에요, 오늘도 화이팅!",
  "language": "ko"
}
```

**Response (201):**
```json
{
  "message": {
    "id": "uuid",
    "text": "...",
    "audio_url": "https://r2.../audio.mp3",
    "voice_profile_id": "uuid"
  }
}
```

### GET /api/tts/messages 🔒
생성된 메시지 목록

### DELETE /api/tts/messages/:id 🔒
메시지 삭제

---

## 5. 알람 API (`/api/alarm`) 🔒

### GET /api/alarm
알람 목록

**Query:** `?page=1&limit=20&active=true`

**Response (200):**
```json
{
  "alarms": [
    {
      "id": "uuid",
      "time": "07:30",
      "label": "기상",
      "repeat_days": "1,2,3,4,5",
      "is_active": true,
      "mode": "tts",
      "wake_mode": "sound_then_voice",
      "voice_profile_id": "uuid",
      "vibration_pattern": "default",
      "message": "좋은 아침!",
      "created_at": "..."
    }
  ],
  "total": 3
}
```

### GET /api/alarm/:id
알람 상세

### POST /api/alarm
알람 생성

**Request Body:**
```json
{
  "time": "07:30",
  "label": "기상",
  "repeat_days": "1,2,3,4,5",
  "mode": "tts",
  "wake_mode": "sound_then_voice",
  "voice_profile_id": "uuid",
  "vibration_pattern": "default",
  "message": "좋은 아침이에요!"
}
```

### PATCH /api/alarm/:id
알람 수정 (부분 업데이트)

### DELETE /api/alarm/:id
알람 삭제

### GET /api/alarm/tick
디버그: 현재 시각 기준 발동 알람 조회

---

## 6. 친구 API (`/api/friend`) 🔒

### POST /api/friend
친구 요청 (이메일)

**Request Body:**
```json
{ "email": "friend@example.com" }
```

### GET /api/friend/list
친구 목록

**Query:** `?q=검색어&page=1&limit=20`

### GET /api/friend/pending
대기 중인 친구 요청 (받은 것)

### PATCH /api/friend/:id/accept
친구 요청 수락

### DELETE /api/friend/:id
친구 삭제 / 요청 거부

---

## 7. 선물 API (`/api/gift`) 🔒

### POST /api/gift
선물 보내기

**Request Body:**
```json
{
  "friend_id": "uuid",
  "message_id": "uuid",
  "note": "생일 축하해!"
}
```

### GET /api/gift/received
받은 선물 목록

### GET /api/gift/sent
보낸 선물 목록

### PATCH /api/gift/:id/accept
선물 수락

### PATCH /api/gift/:id/reject
선물 거부

---

## 8. 쪽지 API (`/api/notes`) 🔒

### POST /api/notes
쪽지 보내기 (가족 멤버 간에만)

**Request Body:**
```json
{
  "receiver_id": "uuid",
  "text": "오늘 하루도 힘내! 화이팅 💪"
}
```

**제한:** 500자, 같은 plan_group 멤버만

### GET /api/notes/received
받은 쪽지 목록

**Query:** `?page=1&limit=20`

### GET /api/notes/sent
보낸 쪽지 목록

### PATCH /api/notes/:id/read
쪽지 읽음 처리 (수신자만)

---

## 9. 가족 API (`/api/family`) 🔒

### POST /api/family/invites
초대 코드 발급 (그룹 owner만)

### GET /api/family/invites
발급한 초대 코드 목록

### POST /api/family/invites/:code/accept
초대 코드로 그룹 가입

### POST /api/family/invites/:code/revoke
초대 코드 취소

### GET /api/family/groups/current
현재 가족 그룹 + 멤버 목록

### POST /api/family/groups/:groupId/leave
그룹 탈퇴 (일반 멤버)

### POST /api/family/groups/:groupId/transfer-ownership
소유권 이전

### DELETE /api/family/groups/:groupId/members/:userId
멤버 강제 퇴출 (owner만)

### POST /api/family/alarms
가족 알람 생성 (텍스트 메시지)

### POST /api/family/alarms/voice
가족 알람 생성 (음성 첨부)

---

## 10. 캐릭터 API (`/api/characters`) 🔒

### GET /api/characters/me
내 캐릭터 조회 (없으면 자동 생성)

**Response (200):**
```json
{
  "character": {
    "id": "uuid",
    "name": "내 나무",
    "stage": "sprout",
    "level": 5,
    "xp": 320,
    "xp_to_next": 500,
    "affection": 75,
    "current_streak": 12,
    "longest_streak": 15,
    "stats": {
      "diligence": 65,
      "health": 50,
      "consistency": 80
    },
    "achievements": [
      { "milestone": 7, "achieved_at": "2026-01-07T06:30:00Z" }
    ]
  }
}
```

### POST /api/characters/xp
XP 부여 (멱등성 키 지원)

**Request Body:**
```json
{
  "event": "alarm_dismiss",
  "idempotency_key": "alarm_dismiss_2026-04-24",
  "local_date": "2026-04-24"
}
```

**이벤트 타입:** `alarm_dismiss`, `message_listen`, `streak_bonus_7`, `streak_bonus_30`, `streak_bonus_90`

---

## 11. 푸시 API (`/api/push`) 🔒

### POST /api/push/token
FCM 토큰 등록/갱신

**Request Body:**
```json
{
  "token": "ExponentPushToken[xxx]",
  "platform": "android"
}
```

### DELETE /api/push/token
FCM 토큰 해제

**Request Body:**
```json
{ "token": "ExponentPushToken[xxx]" }
```

---

## 12. 코드 등록 API (`/api/code`) 🔒

### POST /api/code/register
통합 코드 등록 (이용권 또는 가족 초대)

**Request Body:**
```json
{ "code": "VA-XXXX-XXXX-XXXX" }
```

**코드 타입 자동 판별:**
- `VA-XXXX-XXXX-XXXX`: 이용권 코드 → 구독 생성 + 플랜 업그레이드
- `6자리 숫자`: 가족 초대 코드 → 그룹 가입

**에러 코드:** `INVALID_FORMAT`, `EXPIRED`, `ALREADY_USED`, `NOT_FOUND`, `SELF_INVITE`, `GROUP_FULL`

---

## 13. 결제 API (`/api/billing`) 🔒

### POST /api/billing/checkout
결제 스텁 (mock)

### GET /api/billing/vouchers
발급된 이용권 코드 목록

### GET /api/billing/subscription
활성 구독 정보

### POST /api/billing/redeem
이용권 코드 사용

---

## 14. 통계 API (`/api/stats`) 🔒

### GET /api/stats
사용자 통계 (알람/음성/메시지/친구 카운트 + 트렌드)

### GET /api/stats/activity
최근 활동 내역

---

## 15. 더빙 API (`/api/dub`) 🔒

### GET /api/dub/languages
지원 더빙 언어 목록

### POST /api/dub
더빙 작업 생성 (오디오 업로드)

### GET /api/dub/jobs
더빙 작업 목록

### GET /api/dub/:id
더빙 작업 진행/결과 조회

---

## 16. 라이브러리 API (`/api/library`) 🔒

### GET /api/library
메시지 라이브러리 (즐겨찾기 상단, 카테고리 필터)

**Query:** `?category=morning&favorite=true&page=1&limit=20`

### PATCH /api/library/:id/favorite
즐겨찾기 토글

### DELETE /api/library/:id
라이브러리에서 삭제

---

## 17. 스케줄러 (Cron)

### scheduled() — `*/5 * * * *`
5분 간격 실행. 현재 시각 기준 발동 알람 조회 → FCM 푸시 전송.

---

## 18. 헬스 / 초기화

### GET /
헬스 체크 (DB 상태 포함)

### POST /api/init-db
DB 스키마 초기화 (마이그레이션 실행)
