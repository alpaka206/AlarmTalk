# BACKLOG

## P0 (지금 바로) — 프로젝트 정리 + 탭 구조 개편

### Phase 1-A: packages/web 삭제 ✅ (2026-04-24)
- [x] `packages/web/` 디렉토리 전체 삭제
- [x] `.github/workflows/deploy-web.yml` 삭제
- [x] 루트 `package.json`에서 `"web"` 스크립트 제거
- [x] `eslint.config.js`에서 `packages/web/src/**` 패턴 제거
- [x] `.github/workflows/ci.yml` — typecheck/test matrix에서 `packages/web` 제거
- [x] `.github/dependabot.yml`에서 `/packages/web` 섹션 삭제
- [x] `CLAUDE.md` — `Web: React + TypeScript + Vite + Tailwind CSS` 줄, `packages/web` 줄 삭제
- [x] `ARCHITECTURE.md` — web 관련 섹션 삭제
- [x] `README.md` — web 대시보드 관련 언급 삭제
- [x] `.ralph/PROMPT.md` — web 참조 삭제 (PROMPT.md는 빌드 지시서이므로 유지, 실제 참조만 정리)
- [x] `packages/backend/src/index.ts` — CORS ALLOWED_ORIGINS에서 web origin 4개 삭제 + localhost:5173(Vite) 삭제
- [x] `npm install` 실행하여 lock 파일 재생성
- [x] `npm run lint && npm run typecheck` 통과 확인
- [x] 추가: `.github/CONTRIBUTING.md` — web dev 명령어 삭제
- [x] 추가: `packages/backend/src/middleware/cors.test.ts` — web origin 제거 + 테스트 업데이트

### Phase 1-B: Pretendard 폰트 적용 ✅ (2026-04-24)
- [x] `expo-font` + `expo-splash-screen` 의존성 설치
- [x] Pretendard 폰트 파일(Regular/Medium/SemiBold/Bold) 다운로드 → `apps/mobile/assets/fonts/` 에 배치
- [x] `apps/mobile/app/_layout.tsx`에서 `useFonts()`로 Pretendard 로드 + 로딩 중 스플래시 유지
- [x] `packages/ui/src/tokens.ts`의 `FontFamily` 업데이트 + `fontForWeight()` 유틸리티 추가
- [x] `apps/mobile/src/constants/theme.ts`에 `FontFamily` + `fontForWeight()` 추가
- [x] 홈 화면 + 탭바 fontWeight → fontFamily Pretendard 적용
- [x] 폰트 로드 실패 시 시스템 폰트 폴백 처리
- [x] typecheck 통과 확인

### Phase 1-B-2: 전체 앱 fontWeight→fontFamily 마이그레이션 (진행 중)
- [x] Batch 1: 컴포넌트+소형 화면 10개 파일 변환 완료 (Toast, OfflineBanner, ErrorBoundary, FamilyMemberRow, EmailPasswordForm, LoginButtons, QueryStateView, StateView, onboarding, voice/upload)
- [x] Batch 2: 탭 화면+중형 화면 10개 파일 변환 완료 (index, people, voices, alarms, settings, family-alarm/create, library, player, friend/[id], message/[id])
- [x] Batch 3: 나머지 9개 파일 변환 (alarm/edit, alarm/create, voice/picker, voice/[id], voice/record, voice/diarize, dub/translate, message/create, gift/received)
- [ ] iOS/Android 모두 한국어+영어 렌더링 확인

### Phase 1-C: 모바일 탭 축소 (8개 → 5개) ✅ (2026-04-24)
- [x] `app/(tabs)/character.tsx` → `app/character/index.tsx` 스택 화면으로 이동
- [x] `app/(tabs)/library.tsx` → `app/library/index.tsx` 스택 화면으로 이동
- [x] `app/(tabs)/_layout.tsx` — friends/family/character/library Screen 제거, people Screen 추가 (아이콘: 👤, 라벨: `tab.people`)
- [x] `app/(tabs)/index.tsx` — 홈 화면에 캐릭터 미니 위젯 삽입 (이모지 + 레벨 + 프로그레스바, 탭 시 `/character`로 이동)
- [x] `app/(tabs)/index.tsx` — 홈 화면에 "최근 메시지" 섹션 추가 (2-3개 표시 + "전체 보기" → `/library` 이동)
- [x] `src/i18n/ko.json` — `tab.friends`, `tab.family`, `tab.character`, `tab.library` 삭제, `tab.people: "내 사람들"` 추가
- [x] `src/i18n/en.json` — 동일 키 변경
- [x] `app/(tabs)/friends.tsx` 삭제 (people.tsx로 대체)
- [x] `app/(tabs)/family.tsx` 삭제 (people.tsx로 대체)
- [x] typecheck 통과 확인

## P1 — Friends + Family 탭 통합 (People)

### People 탭 신규 생성 ✅ (2026-04-24)
- [x] `app/(tabs)/people.tsx` 신규 — 세그먼트 컨트롤 (멤버/친구/요청)
- [x] 플랜별 UI 분기: free/personal → "멤버" 세그먼트 숨김 (기본탭 "친구"), family → "멤버" 세그먼트 표시 (기본탭 "멤버")
- [x] 친구 세그먼트: 이메일 추가 + 친구 목록/삭제
- [x] 요청 세그먼트: 대기중 요청 수락
- [x] 멤버 세그먼트: 가족 멤버 표시 + 역할 뱃지 + 알람 허용 상태
- [x] 멤버 세그먼트: 초대코드 발급 UI (owner에게만 표시, 코드 생성/복사/공유/취소)

### 컴포넌트 추출 ✅ (2026-04-24)
- [x] `src/components/FamilyMemberRow.tsx` 신규 — people.tsx의 renderMember 컴포넌트 추출
- [x] `src/components/PeopleSkeletonCard.tsx` 신규 — pulse 애니메이션 skeleton 카드

### 가족 알람 분리 ✅ (2026-04-24)
- [x] `app/family-alarm/create.tsx` 신규 — 알람 예약 폼 (수신자 선택, 시간, 메시지, 반복요일)
- [x] People 탭 멤버 세그먼트에 "가족 알람 보내기" 버튼 → `/family-alarm/create` 이동
- [x] root _layout.tsx에 Stack.Screen 추가
- [x] familyAlarm.* i18n 키 추가 (ko/en)

### i18n 추가 ✅ (2026-04-24)
- [x] `src/i18n/ko.json`에 `people.*` 키 추가 (멤버, 친구, 요청 등)
- [x] `src/i18n/en.json` 동일
- [x] `familyAlarm.*` 키 추가 (ko/en)
- [x] 초대코드 관련 i18n 키 추가 (12개, ko/en)
- [x] typecheck 통과 확인

## P2 — 캐릭터 시스템 정비 (나무 테마 + 스트릭)

### 백엔드: DB 스키마 (마이그레이션 13) ✅ (2026-04-24)
- [x] `packages/backend/src/lib/migrations.ts` — 마이그레이션 13 추가:
  - characters 테이블에 `current_streak`, `longest_streak`, `last_wakeup_date` 컬럼 추가
  - `character_stats` 테이블 신규 (diligence, health, consistency)
  - `streak_achievements` 테이블 신규 (milestone: 7/30/90, achieved_at)

### 백엔드: 스트릭 로직 ✅ (2026-04-24)
- [x] `packages/backend/src/lib/streak.ts` 신규 — computeStreak + MILESTONE_BONUS_XP
- [x] `packages/backend/src/lib/xpRules.ts` — streak_bonus_7/30/90 이벤트 + isCapExempt (일일캡 면제)
- [x] `packages/backend/src/lib/character.ts` — CharacterStats 타입 + computeStats 함수

### 백엔드: API 확장 ✅ (2026-04-24)
- [x] `packages/backend/src/routes/character.ts` — GET /characters/me 응답에 streak, stats, achievements 필드 추가
- [x] `packages/backend/src/routes/character.ts` — POST /characters/xp에 스트릭 계산 + 능력치 업데이트 통합
- [x] 클라이언트에서 `local_date` (YYYY-MM-DD) 전송하도록 API 설계 (타임존 대응)
- [x] typecheck 통과 확인

### 프론트엔드: 캐릭터 화면 강화 ✅ (2026-04-24)
- [x] `apps/mobile/src/services/api.ts` — CharacterResponse 타입에 streak/stats/achievements 필드 추가
- [x] `apps/mobile/app/character/index.tsx` — 스트릭 뱃지 UI (🔥 N일 연속 기상)
- [x] `apps/mobile/app/character/index.tsx` — 능력치 바 표시 (뿌리깊이/줄기튼튼함/잎무성함)
- [x] `apps/mobile/app/character/index.tsx` — 마일스톤 달성 기록 섹션 (7일/30일/90일 배지)
- [x] `apps/mobile/app/(tabs)/index.tsx` — 홈 캐릭터 위젯에 스트릭 카운트 표시
- [x] `apps/mobile/src/i18n/ko.json` — 스트릭/능력치 관련 번역 키 추가 (17개, ko/en)
- [x] typecheck 통과 확인

### 나무 테마 강화 ✅ (2026-04-24)
- [x] `apps/mobile/src/lib/character.ts` — DIALOGUES 4→7개 확장 + STREAK_DIALOGUES 5계층 + pickStreakAwareDialogue
- [x] 능력치 이름 나무 테마 적용 확인 (i18n에서 이미 완료: 뿌리 깊이/줄기 튼튼함/잎 무성함)

## P3 — 배포 + 서비스화

### R2 스토리지 연동 (음성 파일) ✅ (2026-04-24)
- [x] `packages/backend/wrangler.toml` — R2 bucket 바인딩 추가 (`VOICE_BUCKET`, bucket: `voice-alarm-voices`)
- [x] `packages/backend/src/types.ts` — Env에 `VOICE_BUCKET?: R2Bucket` 추가
- [x] `packages/backend/src/lib/r2-storage.ts` (신규) — R2VoiceStorage implements VoiceStorage
- [x] `packages/backend/src/routes/voice.ts` — R2 우선, in-memory 폴백으로 변경
- [x] typecheck 통과 확인

### FCM 푸시 구조 세팅 ✅ (2026-04-24)
- [x] `packages/backend/src/lib/migrations.ts` — 마이그레이션 14: `push_tokens` 테이블
- [x] `packages/backend/src/lib/fcm.ts` 신규 — FCM mock 클라이언트 (console.warn 로그)
- [x] `packages/backend/src/routes/push.ts` 신규 — POST/DELETE /push/token
- [x] `packages/backend/src/index.ts` — scheduled() FCM 통합
- [x] `apps/mobile/src/services/notifications.ts` — registerPushTokenWithServer
- [x] `apps/mobile/src/services/api.ts` — registerPushToken, unregisterPushToken
- [x] `apps/mobile/app/_layout.tsx` — 앱 시작 시 push 토큰 자동 등록
- [x] typecheck 통과 확인

### 배포 설정 정비 ✅ (2026-04-24)
- [x] `packages/backend/wrangler.toml` — cron 트리거 `*/5 * * * *` 추가
- [x] Cloudflare Workers 무료 티어 제한 검증 (JOURNAL 기록)
- [x] Turso 무료 티어 제한 검증 (JOURNAL 기록)
- [ ] `wrangler deploy` 테스트 — 사용자가 직접 실행 (시크릿 설정 필요)

## P4 — 기획서(Notion) 동기화 + 추가 정비

### Notion 기획서 업데이트
- [ ] 기획서 섹션 7 "기술 스택" — 실제 스택으로 수정 (RN/Expo, Hono+CF Workers, Turso, JWT 자체인증)
- [ ] 기획서 섹션 6 "개발 로드맵" — 현재 구현 상태 반영 (Phase 1 MVP 대부분 완료)
- [ ] 기획서 "현재 이슈" — 실제 이슈 목록으로 갱신

### 온보딩 플로우 기획서 정렬 ✅ (2026-04-24)
- [x] `apps/mobile/app/onboarding.tsx` — 4페이지 추가 (나무 캐릭터), SafeAreaView, 접근성, 토큰 색상
- [x] 온보딩 완료 후 캐릭터 자동 생성 연동 확인 (prefetch + backend loadOrCreateCharacter)

### 알람 정확도 강화 ✅ (2026-04-24)
- [x] 반복 알람 categoryIdentifier 누락 버그 수정 (스누즈/끄기 버튼 미표시 문제)
- [x] Dismiss 액션 시 플레이어 화면 열리는 버그 수정
- [x] 알람 예약 전 알림 권한 체크 추가
- [x] alarmPlayback.ts 검증 — stub URL은 R2 배포 전 올바른 상태, weekday 매핑 정확

### 오프라인 캐싱 ✅ (2026-04-24)
- [x] 음성 프로필 오프라인 캐싱 추가 (Voices 탭에 cacheVoices/getCachedVoices 연동)
- [x] 알람/홈/라이브러리 오프라인 캐싱 검증 완료 (기존 구현 정상 동작)
- [x] 오디오 파일 로컬 캐싱 (expo-file-system) 검증 완료

---

## P5 — UI 폴리시 + 소규모 기능 (P0~P4 완료 후 자동 진행)

> 논의 불필요, 개발 소요 작고, 문제 발생 가능성 낮은 항목만 여기에 둔다.

### 디자인 폴리시
- [x] 커플 뷰(family 2인 그룹): CoupleView 컴포넌트 신규 — 전용 2인 카드 레이아웃 (아바타 나란히 + 연결 시각화 + 알람 상태 + CTA)
- [x] 모든 탭 화면에 `SafeAreaView` + 하단 패딩(100px) 일관 적용 검증 (alarms, voices 수정)
- [x] 빈 상태 UI 일관성 점검 — voices/library에 CTA 추가, 홈 최근메시지 빈 상태 추가
- [x] 다크모드 전체 화면 검증 — DarkColors 토큰만 사용하고 있는지, 하드코딩 컬러 제거
  - [x] 인프라: ThemeColorScheme 인터페이스, useTheme 훅, useAppStore darkMode persist, Settings 토글 연결
  - [x] root _layout.tsx + tabs _layout.tsx 테마 적용
  - [x] settings.tsx createStyles 패턴 전체 재작성
  - [x] Batch 1: 탭 화면 4개 (index, alarms, voices, people)
  - [x] Batch 2: 스택 화면 (character, library, alarm/create, alarm/edit)
  - [x] Batch 3: 컴포넌트 9개 (Toast, OfflineBanner, ErrorBoundary, FamilyMemberRow, EmailPasswordForm, PeopleSkeletonCard, StateView, QueryStateView, MiniWaveformPlayer) — LoginButtons는 브랜드 색상만 사용하여 스킵
  - [x] Batch 4-A: 큰 스택 화면 6개 (message/create, dub/translate, family-alarm/create, voice/diarize, voice/[id], gift/received)
  - [x] Batch 4-B: 나머지 스택 화면 6개 (voice/record, voice/picker, message/[id], onboarding, voice/upload, player)
- [x] 카드 컴포넌트 스타일 일관성 — shadow 토큰 6개 카드에 추가, marginBottom Spacing.sm→md 통일, settings.tsx 매직넘버→토큰 치환
- [x] 알람 시간 설정 UI 개선 — AM/PM 표시, 남은시간 헬퍼, i18n 17키, 터치타겟 44px, 접근성 라벨
- [x] 홈 화면 레이아웃 정리 — 위젯 간 간격, 섹션 구분선, 시각적 위계 정비 + 접근성 라벨 11개

### 소규모 기능 구현
- [x] 앱 스플래시 스크린 설정 — `app.json`의 splash 설정, 코랄 배경 + 앱 로고 텍스트
- [x] 알람 생성 시 진동 패턴 선택 (기본/강하게/없음) — `expo-haptics` 활용 (DB migration 15 + 백엔드 + 프론트 create/edit)
- [x] 친구 프로필에 마지막 접속 시간 표시 ("방금 전", "1시간 전" 등) — DB migration 16 + formatLastSeen + People 탭 UI
- [x] 알람 목록 정렬 — 가장 이른 시간순 (활성→비활성, 활성끼리 nextFireMs 오름차순 + formatCountdown i18n)
- [x] 메시지 라이브러리에서 즐겨찾기 상단 고정 (is_favorite 기준 정렬, 이후 received_at 내림차순)
- [x] 설정 화면에 "앱 정보" 섹션 (버전, 라이선스, 개인정보 처리방침 링크, 문의하기, 푸터)
- [x] 초대 코드 공유 시 클립보드 복사 + "복사됨" 토스트 (P1 초대코드 UI에서 완료)

### 접근성 + 국제화 보강
- [x] 탭 화면 접근성 일괄 추가 (alarms, voices, people, settings, LoginButtons — ~30개 라벨)
- [x] 스택 화면 접근성 Batch 1 (alarm/create ~25, alarm/edit ~15, library/index ~6 = ~46 라벨)
- [x] 스택 화면 접근성 Batch 2 (voice/record, message/create, dub/translate, family-alarm/create, voice/picker)
- [x] 스택 화면 접근성 Batch 3 (voice/upload, voice/diarize, character/index, player, voice/[id], friend/[id]) + friend/[id] 다크모드 수정
- [x] 이모지가 단독으로 정보를 전달하는 곳에 텍스트 라벨 병기 확인 (library 카테고리 뱃지/필터 i18n, player 장식 이모지 a11y)
- [x] 한국어/영어 전환 시 레이아웃 깨짐 점검 (segment numberOfLines, quickDays flexWrap, FamilyMemberRow flexShrink)

---

## 완료 항목 (이전 루프)

<details>
<summary>P0~P39 완료 항목 (39 phases, 모두 완료)</summary>

### P0 (이전) — 선물/친구/상호알람
- [x] 백엔드 Friends 시스템 (DB+API+라우트)
- [x] 백엔드 Gift 시스템 (DB+API+라우트)
- [x] 백엔드 상호 알람 (target_user_id)
- [x] 모바일 앱 UI (friends, gift, alarm 화면)
- [x] 웹 대시보드 UI (FriendsPage, GiftsPage)

### P1~P39 — 테스트/안정화/배포/품질/자가생성
- [x] 입력 validation 강화
- [x] i18n Phase 1-2
- [x] 백엔드 유닛 테스트 (friend/gift/alarm/user/library/voice/tts/stats/middleware)
- [x] ESLint + Prettier 설정 통일
- [x] 관측성 (구조화 로깅, 에러 핸들러)
- [x] 보안 (rate limiting, CORS, bodyLimit)
- [x] 모바일 UX 개선 (스와이프 삭제, 토스트, 검색, pull-to-refresh 등)
- [x] 웹 UX 개선 (스켈레톤, 낙관적 업데이트, 다크모드, 반응형 등)
- [x] 캐릭터 시스템 기본 구현 (seed→sprout→tree→bloom, XP)
- [x] 가족 플랜 (초대코드, 그룹, 가족알람)
- [x] 결제 스텁 (플랜, 구독, 이용권)
- [x] 음성 더빙 (perso.ai 연동)
- [x] 계정 삭제, auth 에러 코드

</details>

## P6 — TypeScript 엄격 모드 강화

- [x] 백엔드 `strict: false` → `strict: true` 전환 (zero errors, 즉시 적용)
- [x] `any` 타입 전수 조사: 백엔드 0건, 모바일 0건 — 이미 clean
- [x] `unknown` 타입 검토: 모두 입력 검증 경계면에서 올바르게 사용 중 — 변경 불필요
- [x] `@ts-expect-error` 검토: test 파일 2건 — 의도적 잘못된 입력 테스트, 정상

## P7 — 백엔드 테스트 커버리지 확장

### Batch 1: 미테스트 모듈 커버리지 ✅ (2026-04-24)
- [x] `test/push.test.ts` — push route 14 tests (POST/DELETE validation + 정상 케이스)
- [x] `test/streak.test.ts` — streak lib 17 tests (computeStreak 엣지케이스 + MILESTONE_BONUS_XP)
- [x] `test/fcm.test.ts` — fcm lib 11 tests (getTokensForUser + sendPushNotifications + sendAlarmPush)

### Batch 2: 기존 실패 테스트 수정 ✅ (2026-04-24)
- [x] `test/character.xp.test.ts` 4건 — baseCharacter에 streak 필드 추가 + mock 시퀀스 보강
- [x] `test/voice.e2e.test.ts` 2건 — `getStorage` 방어 코드 (env optional chaining)
- [x] `test/voice.test.ts` 1건 — 동일 수정으로 해결

### Batch 3: R2 스토리지 테스트 ✅ (2026-04-24)
- [x] `test/r2-storage.test.ts` — R2VoiceStorage 10 tests (store 4 + get 3 + delete 2 + name 1, R2Bucket mock)

## P8 — 코드 정리 (알려진 이슈 해결) ✅ (2026-04-24)

- [x] `alarmForm.ts` 검증 에러 메시지 i18n 전환 (TFunction 주입, 4키 ko/en 추가)
- [x] `fontForWeight` 미사용 함수 삭제 (tokens.ts, index.ts, theme.ts)
- [x] `alarmForm.test.ts` mock t 함수 + 검증 업데이트 (17/17 통과)

## P9 — dub 라우트 테스트 커버리지 확장 ✅ (2026-04-24)

- [x] GET /dub/languages 테스트 2건 (정상 + Perso API 에러)
- [x] POST /dub 테스트 8건 (validation 5건 + 성공 2건 + 에러 2건)
- [x] GET /dub/:id processing 분기 테스트 4건 (진행중 + 실패보고 + 폴링에러 + 다운로드불가)
- [x] PersoClient mock 재작성 (arrow→function, ENV 바인딩)

## P10 — 모바일 유틸 테스트 커버리지 확장 ✅ (2026-04-24)

- [x] `formatLastSeen.test.ts` 신규 — 15 tests (null/미래/justNow/minutes/hours/days/longAgo 경계)
- [x] `offlineCache.test.ts` 신규 — 15 tests (alarms/messages/library/voices 캐시 CRUD + 격리 + 덮어쓰기)
- [x] 모바일 전체 168/168 통과, 백엔드 553/553 통과

---

# UX 리빌드 (R0~R5) — 사용자 피드백 기반 신규 기획

## R0 — 탭 구조 변경 (4탭 + 프로필 드롭다운)

### R0-A: 탭 축소 5→4 ✅ (2026-04-24)
- [x] `app/(tabs)/people.tsx` 삭제 (→ `app/people/index.tsx` 스택 화면으로 이동)
- [x] `app/(tabs)/settings.tsx` 삭제 (→ `app/settings/index.tsx` 스택 화면으로 이동)
- [x] `app/(tabs)/voices.tsx` → 음성 관리 탭으로 리빌드 (R1에서 완료)
- [x] `app/(tabs)/_layout.tsx` — 탭 4개로 변경: index(홈), voices(음성), alarms(알람), compose(메시지작성)
- [x] `app/(tabs)/compose.tsx` 신규 — 메시지 작성 탭 (R4에서 상세 구현, 여기선 스캐폴드만)
- [x] `src/i18n/ko.json` — `tab.people`, `tab.settings` 삭제, `tab.compose: "메시지"` 추가, `people.title` 추가, `compose.*` 8키 추가
- [x] `src/i18n/en.json` — 동일
- [x] typecheck 통과 확인

### R0-B: 프로필 드롭다운 + 알림 아이콘 ✅ (2026-04-24)
- [x] `src/components/ProfileDropdown.tsx` 신규 — 우측 상단 프로필 아바타 + 드롭다운 메뉴
  - 내 프로필 (이름, 이메일, 플랜 뱃지)
  - 내 사람들 → `/people` 이동
  - 코드 등록 → `/gift/received` 이동
  - 다크모드 토글 (Switch)
  - 언어 전환 (한국어↔영어)
  - 설정(상세) → `/settings` 이동
  - 로그아웃 (Alert 확인)
  - 계정 삭제 (Alert 확인)
- [x] `src/components/NotificationBell.tsx` 신규 — 프로필 옆 알림 아이콘 (pending-requests 뱃지)
- [x] `app/(tabs)/_layout.tsx` — headerShown + headerRight에 NotificationBell + ProfileDropdown 배치
- [x] `src/i18n/ko.json`, `en.json` — profile.* 6키 추가
- [x] typecheck 통과 확인

## R1 — 음성 관리 리빌드 ✅ (2026-04-24)

### 백엔드: 음성 2개 제한 ✅
- [x] `packages/backend/src/routes/voice.ts` — POST /clone에 MAX_VOICE_PROFILES=2 제한 + VOICE_LIMIT_REACHED 에러 코드
- [x] GET /voice/family 신규 — 같은 그룹 멤버의 ready 음성 목록 (읽기 전용)
- [x] typecheck 통과

### 프론트엔드: 음성 탭 UI ✅
- [x] `app/(tabs)/voices.tsx` 전면 리빌드:
  - 내 음성 (N/2) 카운터 + "음성 추가" 버튼 (2개 시 비활성화)
  - 추가 클릭 → 녹음/업로드 선택 카드
  - 2개 시 limitReached 메시지 표시
  - 가족 음성 섹션 (family plan, 읽기 전용)
- [x] `api.ts`에 FamilyVoiceProfile 타입 + getFamilyVoiceProfiles 함수
- [x] i18n ko/en 각 6키 추가
- [x] typecheck 통과

## R2 — 알람 설정 리빌드 (부분 완료)

### 백엔드 변경 ✅ (2026-04-24)
- [x] 마이그레이션 17: `wake_mode` + `voice_profile_id` 컬럼 추가
- [x] `alarm.ts` POST/PATCH에 `wake_mode` 검증·저장·응답 추가
- [x] 프리셋 메시지 API: `/tts/presets` 이미 존재 (추가 작업 불필요)
- [x] typecheck 통과

### 프론트엔드: 깨우기 방식 ✅ (2026-04-24)
- [x] `alarmForm.ts`에 WakeMode 타입 + 폼·페이로드 추가
- [x] `types.ts`에 WakeMode + Alarm.wake_mode 추가
- [x] `api.ts` createAlarm/updateAlarm에 wake_mode 추가
- [x] `alarm/create.tsx`에 wakeMode 상태 + 깨우기 방식 선택 UI (TTS 모드 시)
- [x] i18n 3키 추가 (ko/en)

### 미완료 항목
- [x] alarm/edit.tsx에 wake_mode UI 동기화 (R5에서 완료)
- [x] 가족/커플 멤버 음성을 알람 설정에서 선택 가능하게 (create + edit 양쪽 구현)
- [x] 프리셋 메시지 카테고리 선택 UI 개선 (2열 그리드 + i18n + 랜덤 선택)
- [x] 최근 사용 메시지 목록 (AsyncStorage 캐싱, 최대 5개)
- [x] 음성 캐싱 — 동일 voice+text 조합 감지 시 기존 message_id 재사용

## R3 — 코드 등록 시스템 ✅ (2026-04-24)

### "받은 선물" → "코드 등록" 변환 ✅
- [x] `app/code-register/index.tsx` 신규 (gift/received는 별도 보존)
- [x] 코드 입력 UI: 텍스트 필드 + "등록" 버튼 + 자동 코드 타입 감지 뱃지
- [x] 통합 백엔드 엔드포인트 `POST /code/register`:
  - **이용권 코드 (VA-XXXX-XXXX-XXXX)**: subscription 생성 + user plan 업데이트
  - **가족 초대 코드 (6자리 숫자)**: plan_group_members 가입
- [x] 에러 처리: 만료 / 사용완료 / 존재하지 않음 / 본인 발급 / 정원 초과 / 잘못된 형식
- [x] 성공 시 토스트 메시지 + userProfile 쿼리 무효화
- [x] ProfileDropdown 라우트 `/gift/received` → `/code-register` 변경
- [x] i18n ko/en 각 18키 추가
- [x] typecheck 통과 (backend + mobile 0 errors)

## R4 — 메시지 작성 탭 ✅ (2026-04-24)

### 커플/가족 전용 기능 ✅
- [x] `app/(tabs)/compose.tsx` 리빌드:
  - 비로그인/비가족: 기존 안내 UI 유지
  - 가족 플랜: 알람 보내기 + 쪽지 보내기 카드 + 받은 쪽지 인라인 목록
- [x] **알람 보내기**: `/family-alarm/create` 로 네비게이션 연결
- [x] **쪽지 보내기**: `app/note/create.tsx` 신규 — 수신자 선택 + 텍스트 입력 + 전송
  - TTS 음성 변환은 Perso API blocked 상태이므로 텍스트만 저장 (audio_url=null)
- [x] **수신함**: compose 탭에 받은 쪽지 FlatList 인라인 표시 (미읽음 뱃지 + 읽음 표시)
- [x] 백엔드: 마이그레이션 18 (`notes` 테이블) + `routes/notes.ts` (POST, GET received/sent, PATCH read)
  - 가족 그룹 멤버 간에만 쪽지 전송 허용
- [x] API: sendNote, getReceivedNotes, getSentNotes, markNoteRead
- [x] i18n ko/en 추가 (note.* 9키, compose.inbox/noNotes 2키)
- [x] typecheck 통과 (backend + mobile 0 errors)

## R5 — 정비 + 테스트 ✅ (2026-04-24)

- [x] alarm/edit.tsx에 wake_mode UI 동기화 (create와 동일한 패턴)
- [x] 새 파일 lint 0 errors (code.ts, notes.ts, code-register, note/create, compose)
- [x] typecheck 통과 (backend + mobile 0 errors)
- [x] 기존 테스트 전체 통과 (backend 553/553, mobile 168/168)
- [x] settings/people 데드 코드 정리 — 결과: 데드 코드 아님 (ProfileDropdown, NotificationBell, friend/[id]에서 정상 참조)
- [x] gift/received.tsx 정리 — 결과: 파일 유지 (friend/[id].tsx에서 gift API 사용). 홈 액션카드만 /code-register로 변경
- [x] 홈 화면 액션카드 "받은 선물" → "코드 등록" 변경 (route + i18n + emoji)

---

## R6 — 문서화 ✅ (2026-04-24)

> Notion MCP 인증 불가 (야간 무인 모드) → `docs/` 폴더에 마크다운으로 생성.

### R6-A: 기획서 업데이트 → `docs/R6-A_PROJECT_OVERVIEW.md` ✅
- [x] 프로젝트 개요 (VoiceAlarm 소개, 핵심 가치, 타겟 유저)
- [x] 주요 기능 정의 (음성 관리, 알람, 메시지, 코드 등록, 캐릭터)
- [x] 화면 흐름도 (탭 4개 + 스택 화면 관계)
- [x] 사용자 시나리오 (5개: 신규가입, 커플알람, 쪽지교환, 스트릭, 오프라인)

### R6-B: 요구사항 정의서 → `docs/R6-B_REQUIREMENTS.md` ✅
- [x] 기능 요구사항 (FR): 7개 카테고리, 50+ 항목
- [x] 비기능 요구사항 (NFR): 성능, 보안, 접근성, 국제화, 오프라인
- [x] 제약사항: 외부 API 비용, 무료 티어 제한, 플랫폼 제한

### R6-C: 기술 스택 & 아키텍처 → `docs/R6-C_ARCHITECTURE.md` ✅
- [x] 기술 스택 다이어그램 (모바일/백엔드/DB/AI)
- [x] 시스템 아키텍처 (요청 흐름, 알람 스케줄링, 인증 플로우, 음성 흐름)
- [x] 모노레포 구조 설명 (전체 디렉토리 트리)
- [x] 데이터 흐름 (읽기/쓰기/오프라인 폴백)

### R6-D: API 문서 → `docs/R6-D_API_REFERENCE.md` ✅
- [x] 전체 API 엔드포인트 목록 (65+ endpoints)
- [x] 주요 API 상세 (요청/응답 스키마, 에러 코드)
- [x] 18개 API 그룹 문서화 (인증~스케줄러)

### R6-E: DB 스키마 문서 → `docs/R6-E_DATABASE_SCHEMA.md` ✅
- [x] 전체 테이블 목록 + 컬럼 정의 (22 테이블)
- [x] ER 다이어그램 (텍스트 기반 관계도)
- [x] 마이그레이션 히스토리 (18개)

### R6-F: 로드맵 → `docs/R6-F_ROADMAP.md` ✅
- [x] 완료된 작업 (P0~R6 요약)
- [x] 현재 상태 (미연동 항목, 알려진 이슈)
- [x] 향후 계획 (단기/중기/장기)
- [x] 기술 부채 목록

---

## P11 — 신규 라우트 테스트 커버리지

### Batch 1: notes + code 라우트 ✅ (2026-04-24)
- [x] `test/notes.test.ts` — 21 tests (POST 9건, GET received 4건, GET sent 2건, PATCH read 5건, 가족 그룹 검증 포함)
- [x] `test/code.test.ts` — 22 tests (공통 5건, 이용권 VA-코드 8건, 가족 초대 6자리 9건)
- [x] 전체 596/596 통과 (기존 553 + 신규 43)

## P12 — React Native 성능 최적화 ✅ (2026-04-24)

- [x] React.memo: FamilyMemberRow, Toast, PeopleSkeletonCard (FlatList 아이템 불필요 재렌더 방지)
- [x] FlatList perf props: alarms, compose, people(×3), library, gift/received, voice/[id] (initialNumToRender, maxToRenderPerBatch, windowSize, removeClippedSubviews)
- [x] useMemo: dub/translate targetLanguages 필터, voice/[id] listData + styles
- [x] useCallback: library renderCategoryItem/getCategoryLabel, gift/received renderGiftItem/statusLabel, voice/[id] renderListItem
- [x] typecheck 통과 (backend + mobile 0 errors)

## P13 — 쪽지 상세 화면 구현 ✅ (2026-04-24)

- [x] `app/note/[id].tsx` 신규 — 발신자 아바타/이름/이메일, 날짜/시간, 메시지 전문, 오디오 섹션 (future-ready)
- [x] `app/(tabs)/compose.tsx` — 쪽지 탭 시 `/note/${id}` 네비게이션 추가
- [x] `app/_layout.tsx` — `note/[id]` Stack.Screen 등록
- [x] i18n `noteDetail.*` 4키 추가 (ko/en)
- [x] typecheck 통과 (backend + mobile 0 errors)

---

## 자가 생성 가능 풀 (BACKLOG 고갈 시)

- 모바일 E2E 테스트 (Detox 또는 Maestro)
- 성능 프로파일링 + 최적화
- Sentry 에러 모니터링 연동
- 앱 아이콘 + 스플래시 스크린 디자인
- App Store / Google Play 스토어 등록 준비 (메타데이터, 스크린샷)
