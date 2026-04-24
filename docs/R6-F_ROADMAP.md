# VoiceAlarm — 로드맵

## 1. 완료된 작업

### Phase 0 — 프로젝트 기반 구축
- 모노레포 구조 설정 (apps/mobile, packages/backend, packages/shared, packages/ui, packages/voice)
- Cloudflare Workers + Hono 백엔드 기초
- React Native (Expo) + expo-router 모바일 앱 기초
- Turso DB 연결 + 마이그레이션 시스템
- JWT 인증 (이메일/비밀번호 + Google OAuth)
- 기본 API 엔드포인트 (user, alarm, voice, tts, message)

### Phase 1 — 핵심 기능
- 음성 프로필 관리 (녹음/업로드/클론/삭제)
- 알람 CRUD + 스케줄링
- TTS 메시지 생성 API
- 친구 시스템 (요청/수락/삭제)
- 선물 시스템 (보내기/수락/거부)
- 메시지 라이브러리 (보관/즐겨찾기)
- 음성 더빙/번역 (Perso.ai 연동 코드)
- 화자 분리 (Diarization)

### Phase 2 — 서비스화
- 가족 플랜 (그룹, 초대코드, 멤버 관리)
- 결제 스텁 (플랜, 구독, 이용권)
- 캐릭터 시스템 (성장 단계, XP, 스트릭, 능력치, 마일스톤)
- R2 스토리지 (음성 파일 저장)
- FCM 푸시 구조 (토큰 등록, Cron 트리거)
- 온보딩 플로우 (4페이지 나무 스토리)

### Phase 3 — 품질 강화 (P5~P10)
- 전체 앱 다크모드 지원 (22개 화면)
- 접근성 (WCAG AA, ~120개 라벨, 터치 타겟 44px)
- 국제화 (한국어/영어, 200+ i18n 키)
- Pretendard 커스텀 폰트
- 오프라인 캐싱 (AsyncStorage + FileSystem)
- 백엔드 테스트 553개 / 모바일 테스트 168개
- TypeScript strict mode
- 카드 스타일/레이아웃 일관성
- 알람 시간 설정 UI 개선
- 진동 패턴, 마지막 접속 시간, 알람 정렬 등 소규모 기능

### UX 리빌드 (R0~R5)
- **R0**: 탭 구조 변경 (5→4탭) + 프로필 드롭다운 + 알림 벨
- **R1**: 음성 관리 리빌드 (2개 제한, 가족 음성)
- **R2**: 알람 설정 리빌드 (깨우기 방식, wake_mode)
- **R3**: 코드 등록 시스템 (이용권 + 가족 초대 통합)
- **R4**: 메시지 작성 탭 (가족 알람 + 쪽지 시스템)
- **R5**: 정비 (데드코드 분석, 홈 화면 정리, typecheck 통과)

### 문서화 (R6)
- 프로젝트 개요 + 주요 기능 정의
- 요구사항 정의서 (FR + NFR)
- 기술 스택 & 아키텍처
- API 레퍼런스 (65+ 엔드포인트)
- DB 스키마 문서 (22 테이블)
- 로드맵 (이 문서)

---

## 2. 현재 상태

### 구현 완료, 연동 미완
| 항목 | 상태 | 차단 요인 |
|------|------|----------|
| Perso.ai 음성 클론 | 코드 완성 | API 404 (서비스 측 이슈) |
| Perso.ai TTS | 코드 완성 | 동일 |
| ElevenLabs TTS | 코드 완성 | API 키 미설정 |
| FCM 푸시 실전송 | mock 구현 | FCM 서비스 계정 미설정 |
| 결제 | 스텁 | PG 연동 미진행 |

### 알려진 이슈
- 쪽지 TTS 변환 미구현 (`notes.audio_url` 항상 null)
- compose 탭: 쪽지 상세 보기 미구현 (인라인 텍스트만)
- 가족/커플 멤버 음성을 알람 설정에서 직접 선택하는 UI 미완
- 프리셋 메시지 카테고리 선택 UI 미개선
- 최근 사용 메시지 캐싱 미구현

---

## 3. 향후 계획

### 단기 (1~2주)
| 우선순위 | 항목 | 설명 |
|----------|------|------|
| 높음 | Cloudflare Workers 배포 | `wrangler deploy` + 시크릿 설정 (JWT_SECRET, TURSO_*) |
| 높음 | R2 버킷 생성 | `wrangler r2 bucket create voice-alarm-voices` |
| 높음 | FCM 연동 | Firebase 프로젝트 생성 → 서비스 계정 키 → Workers 시크릿 |
| 중간 | EAS Build 설정 | `eas build --platform all` → 테스트 빌드 배포 |
| 중간 | 음성 API 연동 | Perso.ai 상태 확인 → 실 호출 테스트 → ElevenLabs 폴백 |

### 중기 (1~2개월)
| 항목 | 설명 |
|------|------|
| TestFlight/내부 테스트 | iOS TestFlight + Android Internal Testing 배포 |
| Sentry 에러 모니터링 | 프론트+백엔드 에러 추적 |
| 실 결제 연동 | 토스페이먼츠 or Stripe 연동 (한국 결제) |
| E2E 테스트 | Maestro 또는 Detox로 주요 시나리오 자동화 |
| 성능 최적화 | 앱 시작 속도, FlatList 렌더링, 번들 크기 |
| 앱 아이콘 + 스플래시 | 나무 테마 커스텀 디자인 |

### 장기 (3개월+)
| 항목 | 설명 |
|------|------|
| App Store / Google Play 등록 | 메타데이터, 스크린샷, 개인정보처리방침 |
| 일본어 지원 | i18n 일본어 번역 추가 |
| 음성 품질 개선 | 다중 TTS 프로바이더 비교 + 자동 선택 |
| 소셜 기능 확장 | 그룹 채팅, 음성 메시지 공유 |
| 웨어러블 연동 | Apple Watch / Galaxy Watch 알람 |
| 위젯 | iOS Widget / Android Widget (다음 알람 표시) |
| 수익화 | 프리미엄 음성팩, 기업 라이선스 |

---

## 4. 기술 부채

| 항목 | 심각도 | 설명 |
|------|--------|------|
| gift/received.tsx 잔존 | 낮음 | 코드 등록으로 대체됨, friend/[id]에서 아직 사용 |
| 음성 캐싱 미구현 | 중간 | 동일 텍스트+음성 재사용 로직 없음 |
| 최근 사용 메시지 | 낮음 | AsyncStorage 캐싱으로 UX 개선 가능 |
| Cron 5분 간격 | 중간 | 알람 정확도 ±5분 — 1분 간격으로 줄여야 함 (Workers 무료 티어 제한 확인 필요) |
| mock FCM | 높음 | 실제 푸시 전송 미구현 — 배포 전 반드시 연동 |
| TTS audio_url | 높음 | notes 테이블의 audio_url 항상 null — API 연동 시 구현 |
