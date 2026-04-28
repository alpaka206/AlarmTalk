# Architecture

## System Overview

```
┌─────────────┐     ┌──────────────────┐
│  Mobile App │     │  External APIs   │
│  (Expo RN)  │     │                  │
└──────┬──────┘     │  - Perso.ai      │
       │            │  - ElevenLabs    │
       │ HTTPS +    │  - Google OAuth  │
       │ Bearer     └────────┬─────────┘
       │                     │
┌──────▼───────┐             │
│  Cloudflare  │◄────────────┘
│  Workers     │   Server-side calls
│  (Hono)      │   (API keys never exposed)
└──────┬───────┘
       │
┌──────▼───────┐
│  Turso DB    │
│  (SQLite)    │
└──────────────┘
```

## Directory Structure

```
apps/mobile/                    React Native (Expo) 앱
├── app/
│   ├── (auth)/                 로그인/회원가입
│   ├── (tabs)/                 메인 탭 네비게이션 (4개)
│   │   ├── index.tsx           홈 (캐릭터 위젯 + 다음 알람)
│   │   ├── voices.tsx          음성 프로필 관리
│   │   ├── alarms.tsx          알람 목록
│   │   └── compose.tsx         메시지 작성 (가족/커플)
│   ├── alarm/{create,edit}.tsx 알람 생성/편집
│   ├── character/              캐릭터 (스트릭 + 능력치)
│   ├── code-register/          코드 등록 (이용권/초대)
│   ├── family-alarm/create.tsx 가족 알람 예약
│   ├── note/                   쪽지 작성/조회
│   ├── people/                 내 사람들 (멤버/친구)
│   ├── settings/               설정 (프로필 드롭다운)
│   ├── voice/{record,upload,diarize}.tsx
│   ├── gift/received.tsx       받은 선물
│   └── onboarding.tsx          온보딩
├── components/                 공유 컴포넌트 (QueryStateView 등)
└── services/                   API 클라이언트

packages/backend/               Cloudflare Workers API
├── src/
│   ├── index.ts                Hono 앱 진입점
│   ├── routes/                 API 라우트 핸들러 (대형 파일은 aggregator 패턴)
│   │   ├── alarm.ts            알람 CRUD (→ alarm-helpers/query/mutation)
│   │   ├── auth.ts             이메일/비밀번호 인증 (register/login)
│   │   ├── billing.ts          구독 + 이용권 (→ billing-helpers/query/mutation)
│   │   ├── character.ts        캐릭터 + 스트릭 (→ character-helpers/query/mutation)
│   │   ├── code.ts             코드 등록 (이용권/초대)
│   │   ├── dub.ts              음성 더빙 (Perso.ai)
│   │   ├── family.ts           가족 그룹 (→ family-group/invite/alarm)
│   │   ├── friend.ts           친구 시스템
│   │   ├── gift.ts             선물 시스템
│   │   ├── library.ts          메시지 라이브러리
│   │   ├── notes.ts            쪽지 (가족 간 텍스트)
│   │   ├── push.ts             푸시 토큰 관리
│   │   ├── stats.ts            사용자 활동 통계
│   │   ├── tts.ts              TTS 생성 + 프리셋
│   │   ├── user.ts             사용자 프로필
│   │   └── voice.ts            음성 프로필 + 클론 (→ voice-upload/profile)
│   ├── lib/
│   │   ├── db.ts               Turso 클라이언트 + 스키마
│   │   ├── migrations.ts       DB 마이그레이션 (13단계)
│   │   ├── streak.ts           스트릭 계산 로직
│   │   ├── xpRules.ts          XP 이벤트 규칙
│   │   ├── character.ts        캐릭터 능력치 계산
│   │   ├── logger.ts           구조화 로깅 + Sentry 연동
│   │   ├── perso.ts            Perso.ai 클라이언트
│   │   └── elevenlabs.ts       ElevenLabs 클라이언트
│   ├── middleware/
│   │   ├── auth.ts             JWT 인증 (Google + Apple + App JWT)
│   │   └── cors.ts             CORS 미들웨어
│   └── types.ts                공유 타입 정의
└── wrangler.toml               Workers 설정

```

## Database Schema

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│    users     │     │voice_profiles│     │   messages    │
├──────────────┤     ├──────────────┤     ├──────────────┤
│ id (PK)      │◄────│ user_id (FK) │  ┌──│ id (PK)      │
│ google_id    │     │ name         │  │  │ user_id (FK) │
│ email        │     │ perso_voice_id│  │  │ text         │
│ name         │     │ elevenlabs_id│  │  │ audio_url    │
│ plan         │     │ status       │  │  │ category     │
│ password_hash│     └──────────────┘  │  │ is_preset    │
└──────┬───────┘                       │  └──────────────┘
       │                               │
       │     ┌──────────────┐          │  ┌──────────────┐
       │     │   alarms     │          │  │message_library│
       │     ├──────────────┤          │  ├──────────────┤
       ├────►│ user_id (FK) │          │  │ user_id (FK) │
       │     │ message_id ──┼──────────┘  │ message_id   │
       │     │ time         │             │ is_favorite  │
       │     │ voice_mode   │             └──────────────┘
       │     │ wake_style   │
       │     └──────────────┘
       │
       │     ┌──────────────┐     ┌──────────────┐
       │     │ friendships  │     │    gifts      │
       │     ├──────────────┤     ├──────────────┤
       ├────►│ user_a (FK)  │     │ sender_id    │
       ├────►│ user_b (FK)  │     │ recipient_id │
       │     │ status       │     │ status       │
       │     └──────────────┘     └──────────────┘
       │
       │     ┌──────────────┐     ┌──────────────┐
       │     │  characters  │     │    notes      │
       │     ├──────────────┤     ├──────────────┤
       ├────►│ user_id (FK) │     │ sender_id    │
       │     │ xp, level    │     │ recipient_id │
       │     │ stage        │     │ text         │
       │     │ current_streak│     │ audio_url    │
       │     └──────┬───────┘     └──────────────┘
       │            │
       │     ┌──────▼───────┐     ┌──────────────┐
       │     │character_stats│     │plan_groups   │
       │     ├──────────────┤     ├──────────────┤
       │     │ diligence    │     │ owner_id(FK) │
       │     │ health       │     │ plan_id      │
       │     │ consistency  │     │ members[]    │
       │     └──────────────┘     │ invites[]    │
       │                          └──────────────┘
       │     ┌──────────────┐
       │     │ push_tokens  │
       │     ├──────────────┤
       └────►│ user_id (FK) │
             │ expo_token   │
             │ device_id    │
             └──────────────┘
```

### Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `users` | 사용자 프로필 + 플랜 | google_id, email, plan, daily_tts_count, password_hash |
| `voice_profiles` | AI 음성 클론 프로필 | perso_voice_id, elevenlabs_voice_id, status |
| `voice_uploads` | 원본 음성 업로드 | r2_key, duration_ms, sample_rate |
| `voice_speakers` | 화자 분리 결과 | upload_id, speaker_label, segments |
| `messages` | TTS 생성 메시지 | text, audio_url, category, is_preset |
| `alarms` | 알람 설정 | time, repeat_days, voice_mode, wake_style |
| `message_library` | 사용자 메시지 보관함 | is_favorite |
| `friendships` | 친구 관계 | user_a→user_b, status |
| `gifts` | 메시지 선물 | sender→recipient, status |
| `characters` | 나무 캐릭터 | xp, level, stage, current_streak, longest_streak |
| `character_xp_logs` | XP 이벤트 기록 | event_type, xp_amount, nonce |
| `character_stats` | 캐릭터 능력치 | diligence, health, consistency |
| `streak_achievements` | 스트릭 마일스톤 | milestone (7/30/90), achieved_at |
| `plans` | 구독 플랜 정의 | key, price, period_days |
| `subscriptions` | 사용자 구독 | plan_id, starts_at, expires_at |
| `voucher_codes` | 이용권/초대 코드 | code, type, redeemed_by |
| `plan_groups` | 가족 그룹 | owner_id, plan_id |
| `plan_group_members` | 그룹 멤버 | group_id, user_id, role |
| `plan_group_invites` | 그룹 초대 | group_id, code, expires_at |
| `push_tokens` | 푸시 토큰 | expo_token, device_id |
| `notes` | 가족 쪽지 | sender_id, recipient_id, text, audio_url |
| `dub_jobs` | 더빙 작업 | perso_project_id, status |

## Data Flow

### Voice Clone → TTS → Alarm

```
1. 사용자가 음성 녹음/업로드
   POST /api/voice/clone (multipart audio)
        │
        ▼
2. 백엔드가 외부 AI API 호출
   Perso.ai createVoiceClone() 또는
   ElevenLabs createInstantClone()
        │
        ▼
3. voice_profiles 테이블에 저장 (status: ready)
        │
        ▼
4. 사용자가 텍스트 입력 + 음성 선택
   POST /api/tts/generate
        │
        ▼
5. 백엔드가 TTS API 호출 → audio_base64 반환
   messages + message_library 테이블에 저장
        │
        ▼
6. 사용자가 알람 설정
   POST /api/alarm { message_id, time, repeat_days }
```

### Gift Flow

```
User A                          User B
  │                               │
  ├─ POST /api/gift ─────────────►│
  │  { recipient_email,           │
  │    message_id, note }         │
  │                               │
  │               GET /api/gift/received
  │                               │
  │          PATCH /api/gift/:id/accept
  │               │               │
  │               ▼               │
  │         message_library에     │
  │         메시지 자동 추가       │
  │                               │
  │                    POST /api/alarm
  │                    (선물 메시지로 알람 설정)
```

## Authentication

```
Client                    Backend                   Google/Apple
  │                         │                          │
  │  ID Token (JWT)         │                          │
  ├────────────────────────►│                          │
  │  Authorization: Bearer  │  tokeninfo API call      │
  │                         ├─────────────────────────►│
  │                         │  { sub, email, name }    │
  │                         │◄─────────────────────────┤
  │                         │                          │
  │                         │  users 테이블 조회/생성
  │                         │  (google_id = sub)
  │  200 OK                 │
  │◄────────────────────────┤
```

- Google: `oauth2.googleapis.com/tokeninfo` 호출로 검증
- Apple: JWT 페이로드 디코딩 + 만료 확인 (프로덕션은 JWKS 서명 검증 필요)

## Plan Limits

| 리소스 | Free | Personal | Family |
|--------|------|----------|--------|
| 음성 프로필 | 2개 | 2개 | 2개 (멤버 음성 읽기 전용) |
| 일일 TTS 생성 | 3회 | 무제한 | 무제한 |
| 알람 | 2개 | 무제한 | 무제한 |
| 가족 쪽지 | - | - | 무제한 |

## External Services

| Service | Purpose | Client Location |
|---------|---------|----------------|
| Perso.ai | 음성 클론 + TTS (1차) | `lib/perso.ts` |
| ElevenLabs | 음성 클론 + TTS + 화자분리 (보조) | `lib/elevenlabs.ts` |
| Turso | SQLite DB (Edge) | `lib/db.ts` |
| Google OAuth | 사용자 인증 | `middleware/auth.ts` |
| Apple Sign-In | iOS 사용자 인증 | `middleware/auth.ts` |

## Deployment

```
develop branch push
        │
        ├──► GitHub Actions: ci.yml
        │    (TypeScript check matrix: backend + mobile)
        │
        └──► deploy-backend.yml
             (packages/backend/** 변경 시 → Cloudflare Workers)
```

- `develop` → 자동 배포 (CI/CD)
- `main` ← `develop` 수동 머지 (리뷰 후)
