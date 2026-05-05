# VoiceAlarm — 기술 스택 & 아키텍처

> 레거시 문서: 이 문서는 React Native/Expo 프로토타입 단계의 아키텍처 기록이다. 현재 제품 구현 기준은 Android native 앱, backend API, `docs/native-rebuild/` 문서다.

## 1. 기술 스택

```
┌──────────────────────────────────────────────────────────┐
│                     클라이언트                             │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  React Native (Expo) + expo-router                  │ │
│  │  TypeScript │ React Query │ i18next │ Zustand       │ │
│  │  expo-notifications │ expo-av │ expo-file-system    │ │
│  └─────────────────────────────────────────────────────┘ │
│                         │ HTTPS                          │
│                         ▼                                │
│                     백엔드 API                            │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  Cloudflare Workers + Hono Framework                │ │
│  │  TypeScript │ JWT Auth │ Zod Validation             │ │
│  │  Rate Limiting │ CORS │ Structured Logging          │ │
│  └──────┬──────────────┬──────────────┬────────────────┘ │
│         │              │              │                  │
│         ▼              ▼              ▼                  │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐          │
│  │  Turso DB  │ │  R2 Storage│ │  AI APIs   │          │
│  │  (SQLite)  │ │  (오디오)   │ │ Perso.ai   │          │
│  │  libSQL    │ │  음성 파일  │ │ ElevenLabs │          │
│  └────────────┘ └────────────┘ └────────────┘          │
└──────────────────────────────────────────────────────────┘
```

### 프론트엔드 (삭제된 레거시 Expo 앱)
| 기술 | 용도 |
|------|------|
| React Native (Expo SDK) | 크로스 플랫폼 모바일 앱 |
| expo-router | 파일 기반 라우팅 (탭 + 스택) |
| expo-dev-client | 네이티브 모듈 개발 빌드 |
| @tanstack/react-query | 서버 상태 관리 (캐싱, 자동 재시도) |
| zustand | 클라이언트 상태 (다크모드, 언어 설정) |
| i18next + react-i18next | 다국어 (한국어/영어) |
| expo-notifications | 로컬 알림 + 푸시 수신 |
| expo-av | 오디오 녹음/재생 |
| expo-file-system | 음성 파일 로컬 캐싱 |
| expo-font | Pretendard 커스텀 폰트 |
| expo-haptics | 진동 패턴 |
| @react-native-async-storage | 오프라인 데이터 캐싱 |

### 백엔드 (packages/backend)
| 기술 | 용도 |
|------|------|
| Cloudflare Workers | 서버리스 엣지 컴퓨팅 |
| Hono | 경량 웹 프레임워크 (라우팅, 미들웨어) |
| @libsql/client | Turso DB 연결 (HTTP) |
| jose | JWT 생성/검증 |
| zod | 입력 스키마 검증 |
| bcryptjs | 비밀번호 해싱 |
| vitest | 테스트 프레임워크 |

### 데이터 저장소
| 기술 | 용도 |
|------|------|
| Turso (libSQL) | 메인 DB — 사용자, 알람, 메시지, 캐릭터 등 |
| Cloudflare R2 | 오브젝트 스토리지 — 음성 파일 (MP3/WAV) |
| AsyncStorage | 모바일 로컬 — 오프라인 캐싱, 설정 |
| expo-file-system | 모바일 로컬 — 오디오 파일 캐싱 |

### AI / 외부 API
| 기술 | 용도 | 상태 |
|------|------|------|
| Perso.ai | 음성 클론 + TTS (1차) | 코드 완성, API 미연동 |
| ElevenLabs | TTS (보조) | 코드 완성, API 미연동 |
| FCM | 푸시 알림 | 구조 구현 (mock 클라이언트) |

---

## 2. 시스템 아키텍처

### 요청 흐름

```
[모바일 앱]
    │
    │  HTTPS (Bearer JWT)
    ▼
[Cloudflare Workers Edge]
    │
    ├── Middleware Chain:
    │   ├── Logger (구조화 로깅)
    │   ├── Rate Limiter (60 req/min per IP)
    │   ├── Body Limit (512KB)
    │   ├── CORS (화이트리스트)
    │   └── Auth (JWT 검증, userId 주입)
    │
    ├── Route Handler (Hono)
    │   ├── Input validation (Zod)
    │   ├── Business logic
    │   └── Response serialization
    │
    ├──→ [Turso DB] (libSQL over HTTP)
    │     └── SQLite 쿼리 실행
    │
    ├──→ [R2 Storage] (Cloudflare binding)
    │     └── 음성 파일 읽기/쓰기
    │
    └──→ [External APIs] (선택적)
          ├── Perso.ai (음성 클론)
          └── ElevenLabs (TTS)
```

### 알람 스케줄링 흐름

```
[Cron Trigger: */5 * * * *]
    │
    ▼
[scheduled() handler]
    │
    ├── DB 쿼리: 현재 시각 ± 5분 이내 활성 알람 조회
    │   └── 요일 필터링 (repeat_days)
    │
    ├── 각 알람에 대해:
    │   ├── push_tokens에서 사용자 FCM 토큰 조회
    │   ├── FCM 전송 (현재 mock — console.warn)
    │   └── wake_mode에 따라 payload 구성
    │
    └── 실패 시 에러 로깅 (개별 알람 격리)
```

### 인증 플로우

```
[이메일/비밀번호 가입]
    POST /auth/register
    │ email + password
    ▼
    bcrypt.hash(password) → DB 저장
    JWT 발급 (userId, exp: 7일)
    │
    └──→ 클라이언트: SecureStore에 토큰 저장

[Google OAuth 로그인]
    POST /auth/google
    │ Google ID token
    ▼
    Google 토큰 검증 → 사용자 조회/생성
    JWT 발급
    │
    └──→ 클라이언트: SecureStore에 토큰 저장

[API 호출]
    GET /api/alarm
    │ Authorization: Bearer <JWT>
    ▼
    Auth middleware: JWT 검증 → userId 추출
    │
    └──→ Route handler (c.get('userId'))
```

### 음성 등록 → TTS → 알람 재생 흐름

```
[1. 음성 등록]
    사용자 → 녹음/업로드 → POST /voice/clone
    │
    ├── 오디오 파일 → R2 저장
    ├── Perso.ai → 음성 클론 프로필 생성
    └── DB: voice_profiles 레코드 생성 (status: ready)

[2. 알람 설정]
    사용자 → 알람 생성 + 음성 프로필 선택 + 메시지 입력
    │
    └── DB: alarms 레코드 (voice_profile_id, message, wake_mode)

[3. TTS 생성]
    POST /tts/generate
    │ voice_profile_id + text
    ▼
    Perso.ai TTS → 음성 파일 생성 → R2 저장
    │
    └── DB: messages 레코드 (audio_url)

[4. 알람 트리거]
    Cron → 알람 시각 도달 → FCM 푸시
    │
    ▼
    모바일 앱:
    ├── expo-notifications → 알림 표시 (스누즈/끄기)
    ├── 사용자 탭 → Player 화면 열림
    ├── wake_mode 판별:
    │   ├── sound_then_voice: 시스템 소리 → 3초 후 음성
    │   └── voice_only: 바로 음성 재생
    └── expo-av → 캐싱된 음성 파일 재생
```

---

## 3. 모노레포 구조

```
alarm/
├── apps/
│   └── mobile/                  # React Native (Expo) 앱
│       ├── app/                 # expo-router 파일 기반 라우팅
│       │   ├── (tabs)/          # 하단 탭 (4개)
│       │   │   ├── _layout.tsx  # 탭 네비게이션 설정
│       │   │   ├── index.tsx    # 🏠 홈 탭
│       │   │   ├── voices.tsx   # 🎙️ 음성 탭
│       │   │   ├── alarms.tsx   # ⏰ 알람 탭
│       │   │   └── compose.tsx  # 💌 메시지 탭
│       │   ├── _layout.tsx      # 루트 레이아웃 (Stack, 인증, 푸시)
│       │   ├── alarm/           # 알람 생성/편집 (모달)
│       │   ├── voice/           # 음성 녹음/업로드/상세
│       │   ├── character/       # 캐릭터 상세
│       │   ├── people/          # 내 사람들
│       │   ├── settings/        # 설정
│       │   ├── note/            # 쪽지 작성
│       │   ├── message/         # 메시지 상세/작성
│       │   ├── code-register/   # 코드 등록
│       │   ├── family-alarm/    # 가족 알람
│       │   ├── friend/          # 친구 프로필
│       │   ├── gift/            # 받은 선물
│       │   ├── library/         # 메시지 보관함
│       │   ├── dub/             # 음성 더빙
│       │   ├── onboarding.tsx   # 온보딩
│       │   └── player.tsx       # 오디오 플레이어 (모달)
│       ├── src/
│       │   ├── services/        # API 클라이언트, 알람 재생, 푸시
│       │   ├── hooks/           # useTheme, useAuth 등
│       │   ├── components/      # 공유 컴포넌트
│       │   ├── constants/       # 테마, 설정
│       │   ├── i18n/            # ko.json, en.json
│       │   ├── lib/             # 유틸리티 (캐릭터, 오프라인 캐시)
│       │   ├── store/           # Zustand 스토어
│       │   └── types/           # 타입 정의
│       ├── assets/fonts/        # Pretendard 폰트 파일
│       └── test/                # 모바일 유닛 테스트 (168개)
│
├── packages/
│   ├── backend/                 # Cloudflare Workers API
│   │   ├── src/
│   │   │   ├── index.ts         # 진입점 (미들웨어 + 라우트 등록)
│   │   │   ├── routes/          # API 라우트 핸들러 (17개)
│   │   │   ├── lib/             # 비즈니스 로직
│   │   │   │   ├── migrations.ts # DB 마이그레이션 (18개)
│   │   │   │   ├── streak.ts    # 스트릭 계산
│   │   │   │   ├── character.ts # 캐릭터 능력치
│   │   │   │   ├── xpRules.ts   # XP 규칙
│   │   │   │   ├── r2-storage.ts # R2 음성 저장
│   │   │   │   └── fcm.ts       # FCM 푸시 (mock)
│   │   │   ├── middleware/      # auth, cors
│   │   │   └── types.ts         # Env 타입, Hono 바인딩
│   │   ├── test/                # 백엔드 테스트 (553개)
│   │   └── wrangler.toml        # Workers 배포 설정
│   │
│   ├── shared/                  # 공유 타입 & Zod 스키마
│   ├── ui/                      # 디자인 토큰 (컬러, 폰트, 간격)
│   └── voice/                   # 음성 프로바이더 인터페이스
│
├── docs/                        # 프로젝트 문서
├── .ralph/                      # Ralph 자율 루프 상태 관리
└── CLAUDE.md                    # AI 에이전트 지시서
```

---

## 4. 데이터 흐름 요약

### 읽기 (앱 → 서버 → DB)
```
앱 시작 → React Query 자동 fetch → API 호출 (JWT) → DB 쿼리 → JSON 응답 → 캐싱
         └ staleTime: 30s, retry: 2회
```

### 쓰기 (앱 → 서버 → DB)
```
사용자 액션 → useMutation → API 호출 → Zod 검증 → DB INSERT/UPDATE → 응답
              └ onSuccess: queryClient.invalidateQueries() → UI 자동 갱신
```

### 오프라인 폴백
```
네트워크 없음 → API 실패 → React Query retry 실패
                         → AsyncStorage/FileSystem에서 캐싱 데이터 로드
                         → 오프라인 배너 표시
네트워크 복구 → React Query refetchOnReconnect → 서버 데이터 동기화
```
