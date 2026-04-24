# VoiceAlarm 기획서 Notion 동기화 가이드

> Notion MCP 도구 미사용 — 아래 내용을 Notion 기획서에 수동 반영 필요.
> Notion URL: https://www.notion.so/estsoft/34bf11f6ee6380c0a35bfefbd5e014d7

---

## 1. 섹션 7 "기술 스택" 교체 내용

기존 기획서 내용을 아래로 교체하라.

### 클라이언트

| 항목 | 기술 |
|------|------|
| 프레임워크 | React Native (Expo SDK 53) + expo-dev-client |
| 라우팅 | expo-router (파일 기반) |
| 언어 | TypeScript (strict mode + noUncheckedIndexedAccess) |
| 상태 관리 | Zustand (로컬) + React Query (서버) |
| 국제화 | i18next + react-i18next (한국어/영어) |
| 알림 | expo-notifications (로컬 + 푸시) |
| 오디오 | expo-av (녹음/재생) |
| 캐싱 | @react-native-async-storage/async-storage + expo-file-system |
| 폰트 | Pretendard (Regular/Medium/SemiBold/Bold) via expo-font |

### 백엔드

| 항목 | 기술 |
|------|------|
| 런타임 | Cloudflare Workers (무료 티어) |
| 프레임워크 | Hono v4 |
| 언어 | TypeScript (strict mode + noUncheckedIndexedAccess) |
| DB | Turso (libSQL, SQLite 호환) — `voice-alarm-devrel` |
| 인증 | JWT 자체 발급 (이메일/비밀번호 bcrypt, Google OAuth) |
| 스토리지 | Cloudflare R2 (음성 파일) |
| 푸시 | FCM (Firebase Cloud Messaging) via Cron Trigger |
| 검증 | Zod 스키마 (공유 패키지: packages/shared) |
| 미들웨어 | CORS, Rate Limiting, JWT 인증, 에러 핸들링, 구조화 로깅 |

### AI / 음성

| 항목 | 기술 | 상태 |
|------|------|------|
| 음성 클론 + TTS | Perso.ai API | 코드 완료, API 404 (blocked) |
| 보조 TTS | ElevenLabs API | 코드 완료, 통합 미완 (blocked) |
| 화자 분리 | Perso.ai Diarization | 코드 완료, API 404 (blocked) |

### 모노레포 구조

```
alarm/
├── apps/mobile/          # React Native (Expo) 앱
├── packages/backend/     # Cloudflare Workers API
├── packages/shared/      # 공유 Zod 스키마 + 타입
├── packages/ui/          # 디자인 토큰 (색상, 폰트, 간격)
└── packages/voice/       # 음성 프로바이더 인터페이스
```

---

## 2. 섹션 6 "개발 로드맵" 교체 내용

### 완료 (Phase 1 MVP)

- 이메일/비밀번호 + Google OAuth 인증
- 음성 프로필 관리 (녹음/업로드/삭제, 최대 2개 제한)
- 알람 CRUD + 로컬 스케줄링 (expo-notifications)
- 알람 음성 모드 (wake_mode: sound_only / sound_then_voice / voice_only)
- TTS 메시지 생성 API (Perso.ai 연동 코드)
- 친구 시스템 (요청/수락/삭제)
- 가족 플랜 (그룹, 초대코드, 멤버 관리, 알람 허용)
- 캐릭터 시스템 (나무 테마, 4단계 성장, XP, 스트릭, 능력치, 마일스톤)
- 메시지 작성 (쪽지 보내기/받기, 프리셋 메시지)
- 코드 등록 시스템 (이용권 + 가족 초대 코드)
- 결제 스텁 (플랜, 구독, 이용권)
- 온보딩 플로우 (4페이지 나무 스토리)
- 다크모드 (전체 22개 화면)
- 접근성 (WCAG AA, 120+ 라벨)
- 국제화 (한국어/영어, 200+ i18n 키)
- Pretendard 커스텀 폰트
- 오프라인 캐싱 (AsyncStorage + FileSystem)
- FCM 푸시 구조 (토큰 등록, Cron 트리거)
- R2 스토리지 (음성 파일 저장)

### UX 리빌드 (완료)

- R0: 탭 구조 변경 (8→4탭) + 프로필 드롭다운 + 알림 벨
- R1: 음성 관리 리빌드 (2개 제한, 가족 음성 읽기 전용)
- R2: 알람 설정 리빌드 (깨우기 방식 3종, 프리셋 메시지)
- R3: 코드 등록 시스템 (이용권 + 가족 초대 통합)
- R4: 메시지 작성 탭 (가족 알람 예약 + 쪽지 시스템)
- R5: 정비 (데드코드 제거, 홈 화면 정리, typecheck 통과)

### 테스트 현황

- 백엔드: 872 tests (6 파일) — 전체 라우트 + 미들웨어 + 유틸리티
- 모바일: 1,012 tests (54 파일) — API + hooks + services + 컴포넌트 + 화면 로직
- TypeScript strict mode 양쪽 모두 활성 (0 errors)

### 남은 작업

- Perso.ai API 정상화 후 음성 클론 + TTS 실 연동
- ElevenLabs 보조 TTS 통합
- EAS Build → App Store / Google Play 배포
- Sentry 에러 모니터링 연동
- 결제 실 연동 (PG사 선정 필요)

---

## 3. "현재 이슈" 교체 내용

| # | 이슈 | 심각도 | 상태 | 비고 |
|---|------|--------|------|------|
| 1 | Perso.ai API 404 응답 | Critical | Blocked | 음성 클론/TTS/화자분리 전체 의존. API 제공자 확인 필요 |
| 2 | ElevenLabs 통합 테스트 미완 | High | Blocked | 보조 TTS. Perso.ai 복구 전 대체 경로로 활용 가능 |
| 3 | TTS 변환 미구현 | High | 대기 | notes.audio_url 항상 null. API 정상화 후 연결 |
| 4 | eas.json iOS 설정 미완 | Medium | 대기 | ascAppId, appleTeamId placeholder 교체 필요 |
| 5 | eas.json Android 설정 미완 | Medium | 대기 | google-service-account.json 생성 필요 |
| 6 | Sentry DSN 미설정 | Low | 대기 | Sentry 프로젝트 생성 후 DSN 주입 |
| 7 | react / renderer 버전 불일치 | Low | 회피 | react 19.2.5 vs renderer 19.1.0. 테스트 시 mock 처리 |
