# VoiceAlarm — DB 스키마 문서

**DB**: Turso (libSQL/SQLite)
**테이블 수**: 22개 (+ `_migrations` 추적 테이블)
**마이그레이션 수**: 18개

## ER 다이어그램 (관계도)

```
┌──────────────────────────────────────────────────────────────────────┐
│                            users                                     │
│  id | email | name | plan | password_hash | google_id | ...          │
└──┬───┬───┬───┬───┬───┬───┬───┬───┬────────────────────────────────────┘
   │   │   │   │   │   │   │   │   │
   │   │   │   │   │   │   │   │   └─── push_tokens (user_id)
   │   │   │   │   │   │   │   └─────── notes (sender_id, receiver_id)
   │   │   │   │   │   │   └─────────── plan_group_members (user_id)
   │   │   │   │   │   └─────────────── subscriptions (user_id)
   │   │   │   │   └─────────────────── characters (user_id) ──┬── character_xp_logs
   │   │   │   │                                               ├── character_stats
   │   │   │   │                                               └── streak_achievements
   │   │   │   └─────────── friendships (user_a, user_b)
   │   │   └─────────────── gifts (sender_id, recipient_id)
   │   └─────────────────── dub_jobs (user_id)
   └─────────────────────── voice_profiles (user_id)
                              │
                              └── messages (voice_profile_id)
                                    │
                                    ├── alarms (message_id)
                                    └── message_library (message_id)

┌──────────────────┐          ┌──────────────────────┐
│     plans         │◄────────│    plan_groups        │
│  id | key | type  │         │  id | owner | plan_id │
└──────────────────┘          └──┬───────────────────┘
        │                        │
        └── subscriptions        ├── plan_group_members
            voucher_codes        ├── plan_group_invites
                                 └── (커플/가족 그룹)

voice_uploads (user_id)
  └── voice_speakers (upload_id)
```

---

## 테이블 상세

### 1. users
사용자 계정 정보

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| id | TEXT | PK | UUID |
| google_id | TEXT | UNIQUE, nullable | Google OAuth ID |
| email | TEXT | NOT NULL, UNIQUE | 이메일 |
| password_hash | TEXT | nullable | bcrypt 해시 (이메일 가입 시) |
| name | TEXT | nullable | 표시 이름 |
| picture | TEXT | nullable | 프로필 사진 URL |
| plan | TEXT | DEFAULT 'free' | free/plus/family |
| daily_tts_count | INTEGER | DEFAULT 0 | 일일 TTS 사용 횟수 |
| daily_tts_reset_at | TEXT | nullable | TTS 카운트 리셋 시각 |
| allow_family_alarms | INTEGER | DEFAULT 0 | 가족 알람 수신 허용 |
| last_active_at | TEXT | DEFAULT now() | 마지막 활동 시각 |
| created_at | TEXT | DEFAULT now() | 가입일 |
| updated_at | TEXT | DEFAULT now() | 수정일 |

**인덱스**: `idx_users_email` (UNIQUE), `idx_users_google_id` (UNIQUE, WHERE NOT NULL)

---

### 2. voice_profiles
음성 클론 프로필 (사용자당 최대 2개)

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| id | TEXT | PK | UUID |
| user_id | TEXT | NOT NULL, FK→users | 소유자 |
| name | TEXT | NOT NULL | 프로필 이름 ("엄마 목소리") |
| perso_voice_id | TEXT | nullable | Perso.ai 음성 ID |
| elevenlabs_voice_id | TEXT | nullable | ElevenLabs 음성 ID |
| avatar_url | TEXT | nullable | 프로필 이미지 |
| status | TEXT | DEFAULT 'processing' | processing/ready/failed |
| created_at | TEXT | DEFAULT now() | |
| updated_at | TEXT | DEFAULT now() | |

**인덱스**: `idx_voice_profiles_user`

---

### 3. messages
TTS 생성 메시지

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| id | TEXT | PK | UUID |
| user_id | TEXT | NOT NULL, FK→users | 작성자 |
| voice_profile_id | TEXT | NOT NULL, FK→voice_profiles | 음성 |
| text | TEXT | NOT NULL | 메시지 텍스트 |
| audio_url | TEXT | nullable | 생성된 오디오 URL |
| category | TEXT | DEFAULT 'custom' | 카테고리 |
| is_preset | INTEGER | DEFAULT 0 | 프리셋 여부 |
| created_at | TEXT | DEFAULT now() | |

**인덱스**: `idx_messages_user`, `idx_messages_voice`

---

### 4. alarms
알람 설정

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| id | TEXT | PK | UUID |
| user_id | TEXT | NOT NULL, FK→users | 소유자 |
| target_user_id | TEXT | nullable | 가족 알람 수신자 |
| message_id | TEXT | NOT NULL, FK→messages | 재생 메시지 |
| time | TEXT | NOT NULL | 알람 시각 ("07:30") |
| repeat_days | TEXT | DEFAULT '[]' | 반복 요일 ("1,2,3,4,5") |
| is_active | INTEGER | DEFAULT 1 | 활성/비활성 |
| snooze_minutes | INTEGER | DEFAULT 5 | 스누즈 시간 |
| mode | TEXT | DEFAULT 'tts' | sound-only/tts |
| wake_mode | TEXT | DEFAULT 'sound_then_voice' | sound_then_voice/voice_only |
| voice_profile_id | TEXT | nullable | 선택 음성 |
| speaker_id | TEXT | nullable | 선택 화자 |
| vibration_pattern | TEXT | DEFAULT 'default' | default/strong/none |
| created_at | TEXT | DEFAULT now() | |
| updated_at | TEXT | DEFAULT now() | |

**인덱스**: `idx_alarms_user`, `idx_alarms_target`, `idx_alarms_message`, `idx_alarms_active`, `idx_alarms_voice_profile`, `idx_alarms_speaker`

---

### 5. message_library
메시지 보관함

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| id | TEXT | PK | UUID |
| user_id | TEXT | NOT NULL, FK→users | 소유자 |
| message_id | TEXT | NOT NULL, FK→messages | 메시지 |
| is_favorite | INTEGER | DEFAULT 0 | 즐겨찾기 |
| received_at | TEXT | DEFAULT now() | 수신일 |

**인덱스**: `idx_library_user`, `idx_library_message`

---

### 6. friendships
친구 관계

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| id | TEXT | PK | UUID |
| user_a | TEXT | NOT NULL | 요청자 |
| user_b | TEXT | NOT NULL | 수신자 |
| status | TEXT | DEFAULT 'pending' | pending/accepted/blocked |
| created_at | TEXT | DEFAULT now() | |

**인덱스**: `idx_friendships_user_a`, `idx_friendships_user_b`, `idx_friendships_status`

---

### 7. gifts
선물 (메시지 주고받기)

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| id | TEXT | PK | UUID |
| sender_id | TEXT | NOT NULL | 보낸 사람 |
| recipient_id | TEXT | NOT NULL | 받는 사람 |
| message_id | TEXT | NOT NULL, FK→messages | 선물 메시지 |
| status | TEXT | DEFAULT 'pending' | pending/accepted/rejected |
| note | TEXT | nullable | 메모 |
| created_at | TEXT | DEFAULT now() | |

**인덱스**: `idx_gifts_sender`, `idx_gifts_recipient`, `idx_gifts_status`

---

### 8. dub_jobs
음성 더빙/번역 작업

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| id | TEXT | PK | UUID |
| user_id | TEXT | NOT NULL | 작업자 |
| source_message_id | TEXT | nullable | 원본 메시지 |
| source_language | TEXT | NOT NULL | 원본 언어 |
| target_language | TEXT | NOT NULL | 대상 언어 |
| status | TEXT | DEFAULT 'uploading' | uploading/processing/ready/failed |
| perso_space_seq | INTEGER | nullable | Perso API 참조 |
| perso_project_seq | INTEGER | nullable | Perso API 참조 |
| perso_media_seq | INTEGER | nullable | Perso API 참조 |
| result_message_id | TEXT | nullable | 결과 메시지 |
| progress | INTEGER | DEFAULT 0 | 진행률 (%) |
| error_message | TEXT | nullable | 실패 사유 |
| created_at | TEXT | DEFAULT now() | |

**인덱스**: `idx_dub_jobs_user`, `idx_dub_jobs_status`

---

### 9. voice_uploads
음성 파일 업로드

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| id | TEXT | PK | UUID |
| user_id | TEXT | NOT NULL, FK→users | 업로더 |
| object_key | TEXT | NOT NULL | R2 오브젝트 키 |
| mime_type | TEXT | NOT NULL | 파일 타입 |
| size_bytes | INTEGER | NOT NULL | 파일 크기 |
| duration_ms | INTEGER | nullable | 오디오 길이 |
| original_name | TEXT | nullable | 원본 파일명 |
| created_at | TEXT | DEFAULT now() | |

**인덱스**: `idx_voice_uploads_user`, `idx_voice_uploads_created`

---

### 10. voice_speakers
화자 분리 결과

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| id | TEXT | PK | UUID |
| upload_id | TEXT | NOT NULL, FK→voice_uploads | 원본 업로드 |
| label | TEXT | NOT NULL | 화자 라벨 |
| start_ms | INTEGER | NOT NULL | 시작 지점 (ms) |
| end_ms | INTEGER | NOT NULL | 종료 지점 (ms) |
| confidence | REAL | NOT NULL | 신뢰도 (0~1) |
| created_at | TEXT | DEFAULT now() | |

**인덱스**: `idx_voice_speakers_upload`

---

### 11. plans
플랜 정의 (seed data: free/plus/family)

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| id | TEXT | PK | UUID |
| key | TEXT | UNIQUE, NOT NULL | 플랜 키 (free/plus/family) |
| name | TEXT | NOT NULL | 표시 이름 |
| plan_type | TEXT | NOT NULL | free/personal/family |
| period_days | INTEGER | DEFAULT 30 | 구독 기간 (일) |
| max_members | INTEGER | DEFAULT 1 | 최대 멤버 수 |
| price_krw | INTEGER | DEFAULT 0 | 가격 (원) |
| is_active | INTEGER | DEFAULT 1 | 활성 여부 |
| created_at | TEXT | DEFAULT now() | |

**인덱스**: `idx_plans_key` (UNIQUE)

---

### 12. subscriptions
사용자 구독

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| id | TEXT | PK | UUID |
| user_id | TEXT | NOT NULL, FK→users | 구독자 |
| plan_id | TEXT | NOT NULL, FK→plans | 플랜 |
| plan_group_id | TEXT | nullable | 가족 그룹 |
| status | TEXT | DEFAULT 'active' | active/expired/cancelled |
| starts_at | TEXT | NOT NULL | 시작일 |
| expires_at | TEXT | NOT NULL | 만료일 |
| created_at | TEXT | DEFAULT now() | |
| updated_at | TEXT | DEFAULT now() | |

**인덱스**: `idx_subscriptions_user`, `idx_subscriptions_status`, `idx_subscriptions_expires`

---

### 13. voucher_codes
이용권 코드 (VA-XXXX-XXXX-XXXX)

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| id | TEXT | PK | UUID |
| code | TEXT | UNIQUE, NOT NULL | 코드 원문 |
| code_hash | TEXT | UNIQUE, NOT NULL | 해시 값 |
| plan_id | TEXT | NOT NULL, FK→plans | 대상 플랜 |
| issuer_user_id | TEXT | NOT NULL, FK→users | 발급자 |
| issuer_subscription_id | TEXT | nullable, FK→subscriptions | 발급 구독 |
| redeemed_by_user_id | TEXT | nullable, FK→users | 사용자 |
| status | TEXT | DEFAULT 'issued' | issued/used/expired |
| issued_at | TEXT | DEFAULT now() | |
| used_at | TEXT | nullable | 사용일 |
| expires_at | TEXT | NOT NULL | 만료일 |

**인덱스**: `idx_voucher_codes_hash` (UNIQUE), `idx_voucher_codes_issuer`, `idx_voucher_codes_status`

---

### 14. plan_groups
가족/커플 그룹

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| id | TEXT | PK | UUID |
| owner_user_id | TEXT | NOT NULL, FK→users | 그룹 소유자 |
| plan_id | TEXT | NOT NULL, FK→plans | 플랜 |
| max_members | INTEGER | DEFAULT 6 | 최대 인원 |
| created_at | TEXT | DEFAULT now() | |
| updated_at | TEXT | DEFAULT now() | |

**인덱스**: `idx_plan_groups_owner`

---

### 15. plan_group_members
그룹 멤버

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| id | TEXT | PK | UUID |
| plan_group_id | TEXT | NOT NULL, FK→plan_groups | 그룹 |
| user_id | TEXT | NOT NULL, FK→users | 멤버 |
| role | TEXT | DEFAULT 'member' | owner/member |
| joined_at | TEXT | DEFAULT now() | 가입일 |

**인덱스**: `idx_plan_group_members_group`, `idx_plan_group_members_user`, UNIQUE(plan_group_id, user_id)

---

### 16. plan_group_invites
가족 초대 코드 (6자리 숫자)

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| id | TEXT | PK | UUID |
| plan_group_id | TEXT | NOT NULL, FK→plan_groups | 그룹 |
| inviter_user_id | TEXT | NOT NULL, FK→users | 초대자 |
| code | TEXT | UNIQUE, NOT NULL | 6자리 코드 |
| status | TEXT | DEFAULT 'pending' | pending/used/revoked/expired |
| created_at | TEXT | DEFAULT now() | |
| expires_at | TEXT | NOT NULL | 만료일 |
| used_by_user_id | TEXT | nullable, FK→users | 사용자 |
| used_at | TEXT | nullable | 사용일 |

**인덱스**: `idx_plan_group_invites_code` (UNIQUE), `idx_plan_group_invites_group`, `idx_plan_group_invites_status`

---

### 17. characters
캐릭터 (나무 테마)

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| id | TEXT | PK | UUID |
| user_id | TEXT | NOT NULL, UNIQUE, FK→users | 1:1 |
| name | TEXT | DEFAULT '내 캐릭터' | 캐릭터 이름 |
| level | INTEGER | DEFAULT 1 | 레벨 |
| xp | INTEGER | DEFAULT 0 | 경험치 |
| affection | INTEGER | DEFAULT 0 | 친밀도 |
| stage | TEXT | DEFAULT 'seed' | seed/sprout/tree/bloom |
| daily_xp | INTEGER | DEFAULT 0 | 일일 XP 누적 |
| daily_xp_reset_at | TEXT | nullable | XP 리셋 시각 |
| current_streak | INTEGER | DEFAULT 0 | 현재 연속 기상 |
| longest_streak | INTEGER | DEFAULT 0 | 최장 연속 기상 |
| last_wakeup_date | TEXT | nullable | 마지막 기상일 (YYYY-MM-DD) |
| created_at | TEXT | DEFAULT now() | |
| updated_at | TEXT | DEFAULT now() | |

**인덱스**: `idx_characters_user` (UNIQUE)

---

### 18. character_xp_logs
XP 획득 이력 (멱등성 보장)

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| id | TEXT | PK | UUID |
| character_id | TEXT | NOT NULL, FK→characters | 캐릭터 |
| event | TEXT | NOT NULL | 이벤트 타입 |
| client_nonce | TEXT | nullable | 멱등성 키 |
| granted_xp | INTEGER | DEFAULT 0 | 부여 XP |
| affection_delta | INTEGER | DEFAULT 0 | 친밀도 변화 |
| capped | INTEGER | DEFAULT 0 | 일일 캡 도달 여부 |
| created_at | TEXT | DEFAULT now() | |

**인덱스**: `idx_character_xp_logs_character`, `idx_character_xp_logs_created`, UNIQUE(character_id, client_nonce)

---

### 19. character_stats
캐릭터 능력치

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| id | TEXT | PK | UUID |
| character_id | TEXT | NOT NULL, UNIQUE, FK→characters | 1:1 |
| diligence | INTEGER | DEFAULT 0 | 뿌리 깊이 |
| health | INTEGER | DEFAULT 0 | 줄기 튼튼함 |
| consistency | INTEGER | DEFAULT 0 | 잎 무성함 |
| updated_at | TEXT | DEFAULT now() | |

**인덱스**: `idx_character_stats_character` (UNIQUE)

---

### 20. streak_achievements
스트릭 마일스톤

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| id | TEXT | PK | UUID |
| character_id | TEXT | NOT NULL, FK→characters | 캐릭터 |
| milestone | INTEGER | NOT NULL | 7/30/90 |
| bonus_xp | INTEGER | NOT NULL | 보상 XP |
| achieved_at | TEXT | DEFAULT now() | 달성일 |

**인덱스**: `idx_streak_achievements_character`, UNIQUE(character_id, milestone)

---

### 21. push_tokens
FCM 푸시 토큰

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| id | TEXT | PK | UUID |
| user_id | TEXT | NOT NULL, FK→users | 사용자 |
| token | TEXT | NOT NULL | FCM 토큰 |
| platform | TEXT | NOT NULL | ios/android/web |
| created_at | TEXT | DEFAULT now() | |
| updated_at | TEXT | DEFAULT now() | |

**인덱스**: `idx_push_tokens_user`, UNIQUE(user_id, token)

---

### 22. notes
사용자 간 쪽지

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| id | TEXT | PK | UUID |
| sender_id | TEXT | NOT NULL, FK→users | 발신자 |
| receiver_id | TEXT | NOT NULL, FK→users | 수신자 |
| text | TEXT | NOT NULL | 쪽지 내용 (500자) |
| audio_url | TEXT | nullable | TTS 변환 URL (미구현) |
| read_at | TEXT | nullable | 읽은 시각 |
| created_at | TEXT | DEFAULT now() | |

**인덱스**: `idx_notes_receiver` (receiver_id, created_at DESC), `idx_notes_sender` (sender_id, created_at DESC)

---

## 마이그레이션 히스토리

| # | 이름 | 주요 변경 | 날짜 |
|---|------|----------|------|
| 1 | initial-schema | 핵심 8개 테이블 생성 | 초기 |
| 2 | email-password-auth | users: google_id nullable, password_hash 추가 | - |
| 3 | voice-uploads | voice_uploads 테이블 | - |
| 4 | voice-speakers | voice_speakers 테이블 | - |
| 5 | alarm-mode-voice-speaker | alarms: mode, voice_profile_id, speaker_id | - |
| 6 | plans-and-subscriptions | plans, subscriptions + seed data | - |
| 7 | voucher-codes | voucher_codes 테이블 | - |
| 8 | plan-groups | plan_groups, plan_group_members | - |
| 9 | plan-group-invites | plan_group_invites 테이블 | - |
| 10 | user-allow-family-alarms | users: allow_family_alarms | - |
| 11 | characters | characters 테이블 | - |
| 12 | character-xp-logs | character_xp_logs + characters: daily_xp | - |
| 13 | character-streak-stats | character_stats, streak_achievements + streak 컬럼 | - |
| 14 | push-tokens | push_tokens 테이블 | - |
| 15 | alarm-vibration-pattern | alarms: vibration_pattern | - |
| 16 | user-last-active | users: last_active_at | - |
| 17 | alarm-wake-mode | alarms: wake_mode | - |
| 18 | notes-table | notes 테이블 | - |

마이그레이션은 `_migrations` 테이블에서 실행 여부를 추적하며, `POST /api/init-db` 호출 시 미적용 마이그레이션을 순차 실행합니다.
