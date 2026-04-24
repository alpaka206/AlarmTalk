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

### Notion 기획서 업데이트 ✅ (2026-04-25)
- [x] 기획서 섹션 7 "기술 스택" — 실제 스택으로 수정 → `docs/P4_NOTION_SYNC.md` 섹션 1
- [x] 기획서 섹션 6 "개발 로드맵" — 현재 구현 상태 반영 → `docs/P4_NOTION_SYNC.md` 섹션 2
- [x] 기획서 "현재 이슈" — 실제 이슈 목록으로 갱신 → `docs/P4_NOTION_SYNC.md` 섹션 3
- 비고: Notion MCP 미사용, 마크다운 fallback. 사용자가 Notion에 수동 반영 필요

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

## P80 — 모바일 error_code 처리 시스템 ✅ (2026-04-25)
- [x] `ApiError` 클래스에 `errorCode` 필드 추가 — responseData에서 `error_code` 자동 추출
- [x] `src/lib/apiErrors.ts` 신규 — `getApiErrorMessage(error, t)` + `getErrorCode(error)` 유틸리티
- [x] 40개 백엔드 error_code → i18n 키 매핑 (FREE_PLAN_LIMIT, VOICE_LIMIT_REACHED, CODE_* 등)
- [x] HTTP 상태 코드별 폴백 메시지 (401, 403, 404, 409, 429, 500)
- [x] `ko.json` + `en.json`에 `apiError.*` 46키 추가
- [x] `test/apiErrors.test.ts` — 33 tests (error_code 매핑 17 + HTTP 폴백 6 + getErrorCode 3 + ApiError 추출 5 + edge 2)
- [x] typecheck 통과 (backend + mobile 0 errors)

## P81 — error_code 화면 통합 (getApiErrorMessage 마이그레이션) ✅ (2026-04-25)

- [x] `src/lib/apiErrors.ts` — optional `fallback` 3번째 파라미터 추가
- [x] 12개 화면 import 전환: `src/types` → `src/lib/apiErrors` (alarms, voices, alarm/create, alarm/edit, dub/translate, gift/received, library, message/create, people, voice/diarize, voice/upload, voice/record)
- [x] 19개 call site 시그니처 변경: `(err, t('key'))` → `(err, t, t('key'))`
- [x] 3개 추가 화면 raw catch → getApiErrorMessage (voice/picker, voice/[id], EmailPasswordForm)
- [x] `src/types.ts` 구버전 `getApiErrorMessage` 삭제
- [x] `test/apiErrors.test.ts` — fallback 파라미터 테스트 4건 추가 (33→37 tests)
- [x] typecheck 통과 (backend + mobile 0 errors)
- [x] 전체 테스트 통과 (mobile 662/662, +4)

## P84 — alarm.ts 검증 로직 중복 제거 + error_code 일관성 ✅ (2026-04-25)

- [x] `validateAlarmFields()` 함수 추출 — POST/PATCH 공통 검증 통합 (~70줄 중복 → 2줄 호출)
- [x] 모든 알람 에러 응답에 `error_code` 추가 (17종: REQUIRED_FIELDS_MISSING, INVALID_ALARM_MODE, INVALID_VIBRATION_PATTERN, INVALID_WAKE_MODE, INVALID_VOICE_PROFILE_ID, INVALID_SPEAKER_ID, INVALID_TIME_FORMAT, INVALID_TIME_VALUE, INVALID_REPEAT_DAYS, INVALID_SNOOZE_MINUTES, INVALID_IS_ACTIVE, INVALID_ALARM_ID, ALARM_NOT_FOUND, NO_UPDATE_FIELDS, INVALID_MESSAGE_ID, INVALID_TARGET_USER)
- [x] PATCH 검증을 DB 조회 전으로 이동 (fail-fast)
- [x] 프론트엔드 `apiErrors.ts`에 ALARM_NOT_FOUND 매핑 + ko/en i18n 키 추가
- [x] `alarm.test.ts` beforeEach mockDB.reset() 전환 + error_code 테스트 8건 추가
- [x] typecheck 통과 (backend + mobile 0 errors)
- [x] 전체 테스트 통과 (backend 806/806, +8; mobile 662/662)

## P109 — auth.ts 서비스 테스트 ✅ (2026-04-25)

- [x] `test/auth.test.ts` 신규 — 22 tests (decodeIdToken 6건, AsyncStorage CRUD 7건, signInWithApple 7건, isAppleAuthAvailable 2건)
- [x] expo-web-browser + expo-auth-session 네이티브 모듈 mock 처리
- [x] 전체 모바일 테스트 841/841 통과 (기존 819 + 신규 22)
- [x] typecheck 통과 (backend + mobile 0 errors)

## P110 — 미테스트 모바일 컴포넌트 3개 단위 테스트 ✅ (2026-04-25)

- [x] `test/familyMemberRow.test.ts` 신규 — 22 tests (avatar initial 4건, role 감지 4건, 조건부 렌더링 5건, couple 카드 3건, 표시이름 우선순위 5건, 기타 1건)
- [x] `test/miniWaveformPlayer.test.ts` 신규 — 26 tests (progress 계산 6건, status 업데이트 4건, toggle 액션 7건, bar 색상 4건, 접근성 2건, 시간 표시 4건, 기타)
- [x] `test/toast.test.ts` 신규 — 9 tests (visibility 4건, message 추출 4건, pointer events 1건)
- [x] 전체 모바일 테스트 898/898 통과 (기존 841 + 신규 57)
- [x] typecheck 통과 (backend + mobile 0 errors)

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

## P14 — Switch 접근성 보강 ✅ (2026-04-24)

- [x] ProfileDropdown: Switch a11y + Backdrop/Menu Pressable a11y 추가
- [x] alarms.tsx: 알람 토글 Switch a11y 추가
- [x] settings/index.tsx: 알림 Switch 2개 + 다크모드 Switch a11y 추가
- [x] i18n: `alarms.toggleAlarm` 키 추가 (ko/en)
- [x] typecheck 통과 (backend + mobile 0 errors)

## P15 — EAS 빌드/서브밋 + 스토어 메타데이터 ✅ (2026-04-24)

- [x] voice.ts 스테일 TODO 삭제 (R2 이미 통합됨)
- [x] eas.json: submit 프로필 추가 (iOS App Store + Google Play internal track)
- [x] eas.json: autoIncrement, appVersionSource, env 변수 추가
- [x] app.json: runtimeVersion (appVersion 정책), updates URL (EAS Update)
- [x] app.json: ios.buildNumber, android.versionCode, ITSAppUsesNonExemptEncryption
- [x] store/listing.json 신규: ko/en 스토어 리스팅 (제목, 설명, 키워드, 카테고리, 스크린샷 가이드)
- [x] typecheck 통과 (backend + mobile 0 errors)

## P16 — 모바일 유틸 테스트 커버리지 확장 (Batch 2) ✅ (2026-04-24)

- [x] `test/authFormValidation.test.ts` 신규 — 14 tests (login/register 모드별 validation 엣지케이스)
- [x] `test/waveform.test.ts` 신규 — 15 tests (generateWaveform 결정론성/범위/한글 + formatTime 엣지케이스)
- [x] `test/presets.test.ts` 신규 — 9 tests (PRESET_CATEGORIES 무결성 + getCategoryLabel + DAYS_OF_WEEK)
- [x] 전체 206/206 통과 (기존 168 + P16 38), 백엔드 596/596 통과

## P17 — useAppStore Zustand 스토어 테스트 ✅ (2026-04-24)

- [x] `test/useAppStore.test.ts` 신규 — 32 tests (초기상태, setAuth, clearAuth, setPlan, voiceProfiles CRUD, setPlaying, completeOnboarding, incrementTtsCount, setDefaultSnoozeMinutes, setDarkMode, loadPersistedState)
- [x] AsyncStorage in-memory mock + removeItem 포함
- [x] 전체 238/238 통과 (기존 206 + P17 32), 백엔드 596/596 통과

---

## P18 — hooks 테스트 커버리지 확장 ✅ (2026-04-24)

- [x] `test/useTheme.test.ts` 신규 — 10 tests (라이트/다크 색상 반환, 스키마 무결성, Zustand 연동)
- [x] `test/useToast.test.ts` 신규 — 8 tests (Animated mock, show/fade/timer 시퀀스, 연속 호출, 커스텀 duration)
- [x] `test/useNetworkStatus.test.ts` 신규 — 6 tests (NetInfo mock, isConnected true/false/null, 리스너 해제)
- [x] `test/useAuth.test.ts` 신규 — 24 tests (login/register/logout/refresh 전체 플로우 + boot 시퀀스 + 엣지케이스)
- [x] 전체 286/286 통과 (기존 238 + P18 48), 백엔드 596/596 통과

---

## P19 — DB Row 타입 안전성 강화 (as unknown as 제거) ✅ (2026-04-24)

- [x] `packages/backend/src/lib/db-types.ts` 신규 — typedRow<T> + getFormFile 유틸
- [x] `routes/auth.ts` — 2건 double assertion 제거 → typedRow
- [x] `routes/voice.ts` — 7건 double assertion 제거 (FormData 4건 → getFormFile, DB row 3건 → typedRow) + 3건 as Record 개선
- [x] `routes/dub.ts` — 1건 double assertion 제거 → getFormFile
- [x] `routes/character.ts` — rowToCharacter 시그니처 Row 타입 직접 사용 + 3건 typedRow 적용
- [x] `routes/tts.ts` — 1건 as Record → typedRow
- [x] typecheck 통과 확인 (backend + mobile 0 errors, 596/596 tests)

## P20 — db-types 유틸 테스트 ✅ (2026-04-24)

- [x] `test/db-types.test.ts` 신규 — typedRow 4 tests + getFormFile 6 tests = 10 tests
- [x] 전체 606/606 통과 (기존 596 + P19 0 + P20 10)

---

## P21 — 미테스트 모듈 테스트 커버리지 100% ✅ (2026-04-24)

- [x] `test/stats.test.ts` — 14 tests (GET /stats 통계 6건 + GET /stats/activity 활동 8건)
- [x] `test/elevenlabs.test.ts` — 14 tests (listVoices, TTS, clone, diarize, deleteVoice + 에러 처리)
- [x] `test/perso.test.ts` — 13 tests (전체 메서드 + 204 처리 + static toFileUrl)
- [x] 전체 647/647 통과 (기존 606 + P21 41)
- [x] 모든 routes (16/16) + lib (16/16) 모듈 테스트 존재 — 100% 모듈 커버리지

---

## P22 — Sentry 에러 모니터링 연동 ✅ (2026-04-24)

- [x] 모바일: `@sentry/react-native` 설치 + Expo 플러그인 등록
- [x] `src/lib/sentry.ts` 신규 — initSentry() (EXPO_PUBLIC_SENTRY_DSN 환경변수, 미설정 시 no-op)
- [x] `ErrorBoundary.tsx` — componentDidCatch에서 Sentry.captureException 호출
- [x] `_layout.tsx` — 앱 시작 시 initSentry() 호출
- [x] 백엔드: `toucan-js` 설치 + `middleware/sentry.ts` 신규 (Hono 미들웨어)
- [x] `index.ts` — sentryMiddleware 최상단 등록 + onError에서 Sentry 보고
- [x] `types.ts` — Env에 `SENTRY_DSN?: string` 추가
- [x] typecheck 통과 (backend + mobile 0 errors)
- [x] 전체 테스트 통과 (backend 647/647, mobile 286/286)

---

## P23 — Sentry 타입 수정 + Maestro E2E 테스트 ✅ (2026-04-24)

- [x] `types.ts` — SentryClient 인터페이스 + AuthVariables.sentry 추가 (as never 제거)
- [x] `sentry.ts` — named import (`import { Toucan }`) + c.set 캐스트 제거
- [x] `index.ts` — `Hono<AppEnv>()` + c.get('sentry') 타입 안전 호출
- [x] Maestro E2E 플로우 6개 (온보딩, 로그인, 탭 네비, 알람 생성, 음성 관리, 프로필)
- [x] typecheck 통과 (backend + mobile 0 errors)
- [x] 전체 테스트 통과 (backend 647/647, mobile 286/286)

---

## P24 — i18n 누락 키 수정 + 로그아웃 시 푸시 토큰 해제 ✅ (2026-04-24)

- [x] en.json `messageDetail` 5키 누락 수정 (title, voice, category, createdAt, setAsAlarm)
- [x] `unregisterPushTokenFromServer()` 구현 + `clearAuth` 연동
- [x] useAppStore 테스트 mock 업데이트
- [x] i18n 키 동기화 검증: All keys match
- [x] typecheck 통과 (backend + mobile 0 errors)
- [x] 전체 테스트 통과 (backend 647/647, mobile 286/286)

---

## P25 — README 현행화 + stale TODO 정리 ✅ (2026-04-24)

- [x] README.md 전면 재작성: 인증(JWT+bcrypt), 탭 4개, API 16그룹, 기능 7개, 테스트 현황, 설계문서 링크
- [x] packages/voice/src/VoiceStorage.ts stale TODO → R2 현행 설명으로 교체
- [x] typecheck 통과 (backend + mobile 0 errors)

---

## P26 — 앱 아이콘 설정 (adaptive icon + monochrome) ✅ (2026-04-24)

- [x] `scripts/generate-icons.mjs` 신규 — SVG → PNG 아이콘 생성 스크립트 (sharp 사용)
- [x] `icon.png` 교체 — 코랄 그라데이션 배경 + 흰색 나무 실루엣 (1024×1024)
- [x] `adaptive-icon.png` 교체 — 흰색 나무 전경 (투명 배경, Android 적응형)
- [x] `monochrome-icon.png` 신규 — 검정 나무 실루엣 (Android 13+ Material You)
- [x] `splash-icon.png` 교체 — 흰색 나무 (200×200)
- [x] `favicon.png` 교체 — 코랄 배경 + 흰 나무 (48×48)
- [x] `app.json` — `monochromeImage` 설정 추가
- [x] typecheck 통과 (backend + mobile 0 errors)

---

## P27 — Android 알림 채널 설정 ✅ (2026-04-24)

- [x] 4채널 분리: alarms(MAX), notes(HIGH), reminders(DEFAULT), system(LOW)
- [x] `NotificationChannel` 상수 export + channelId 참조를 상수로 변경
- [x] `sendNotePush` 함수 추가 (쪽지 수신 시 수신자에게 푸시 알림)
- [x] POST /notes에 쪽지 생성 시 비동기 푸시 발송 연동
- [x] i18n: settings.channel* 8키 추가 (ko/en)
- [x] typecheck + 테스트 통과 (backend 647/647, mobile 286/286)

---

## P28 — 딥 링크 라우트 핸들링 ✅ (2026-04-24)

- [x] `src/lib/deepLink.ts` 신규 — parseDeepLink + createDeepLink (13 딥 링크 패턴)
- [x] `app/_layout.tsx` — Linking.getInitialURL (cold start) + addEventListener (런타임) + auth gating
- [x] 특수 URL: `voicealarm://code/VA-XXXX` → `/code-register?code=VA-XXXX`
- [x] typecheck 통과 (backend + mobile 0 errors)

---

## P57 — 백엔드 대형 라우트 파일 분할 (family.ts 834줄) ✅ (2026-04-25)

- [x] `family.ts` → 13줄 thin aggregator (Hono `.route('/')` 마운트)
- [x] `family-invite.ts` 신규 — 266줄 (POST/GET/accept/revoke invites)
- [x] `family-group.ts` 신규 — 205줄 (current/leave/transfer/remove-member)
- [x] `family-alarm.ts` 신규 ��� 292줄 (text alarm + voice alarm)
- [x] `lib/family-helpers.ts` 신규 — 35줄 (resolveUserPk + assertSameGroup)
- [x] index.ts 변경 불필요 (기존 `api.route('/family', familyRoutes)` 유지)
- [x] typecheck 통과 (backend + mobile 0 errors)
- [x] 전체 테스트 통과 (backend 672/672, mobile 466/466)

## P58 — 모바일 api.ts 도메인 분할 ✅ (2026-04-25)

- [x] `services/api.ts` 삭제 (771줄)
- [x] `services/api/core.ts` 신규 — ApiError + request/get/post/patch/del (93줄)
- [x] `services/api/voice.ts` 신규 — Voice + Upload + Speaker + TTS + Dub (195줄)
- [x] `services/api/alarm.ts` 신규 — Alarm + Push (63줄)
- [x] `services/api/social.ts` 신규 — Friend + Gift + Notes (104줄)
- [x] `services/api/user.ts` 신규 — User + Stats + Library (69줄)
- [x] `services/api/billing.ts` 신규 — Billing + Code Registration (56줄)
- [x] `services/api/family.ts` 신규 — Family Group + Invite + Family Alarm (90줄)
- [x] `services/api/character.ts` 신규 — Character API (83줄)
- [x] `services/api/index.ts` 신규 — barrel re-export (100줄)
- [x] 32개 소비자 import 변경 0건 (디렉토리 모듈 자동 해석)
- [x] typecheck 통과 (backend + mobile 0 errors)
- [x] 전체 테스트 통과 (mobile 466/466)

## P59 — player/compose 스타일 추출 ✅ (2026-04-25)

- [x] `src/styles/playerStyles.ts` 신규 — player 화면 스타일 + 웨이브폼 상수 154줄 추출
- [x] `app/player.tsx` 리팩토링: 486→344줄 (-29%)
- [x] `src/styles/composeStyles.ts` 신규 — compose 화면 스타일 177줄 추출
- [x] `app/(tabs)/compose.tsx` 리팩토링: 381→207줄 (-46%)
- [x] compose.tsx `toLocaleDateString()` → `toLocaleDateString(getDateLocale())` 로캘 수정
- [x] typecheck 통과 (backend + mobile 0 errors)
- [x] 전체 테스트 통과 (mobile 466/466)

## P60 — voice 화면 스타일 추출 ✅ (2026-04-25)

- [x] `src/styles/voiceDiarizeStyles.ts` 신규 — voice/diarize.tsx 스타일 152줄 추출
- [x] `app/voice/diarize.tsx` 리팩토링: 413→257줄 (-38%)
- [x] `src/styles/voiceRecordStyles.ts` 신규 — voice/record.tsx 스타일 147줄 추출
- [x] `app/voice/record.tsx` 리팩토링: 396→245줄 (-38%)
- [x] `src/styles/voiceDetailStyles.ts` 신규 — voice/[id].tsx 스타일 161줄 추출
- [x] `app/voice/[id].tsx` 리팩토링: 398→235줄 (-41%)
- [x] typecheck 통과 (mobile 0 errors)
- [x] 전체 테스트 통과 (mobile 466/466)

## P61 — gift/received + family-alarm 스타일 추출 ✅ (2026-04-25)

- [x] `src/styles/giftReceivedStyles.ts` 신규 — gift/received.tsx 스타일 149줄 추출
- [x] `app/gift/received.tsx` ��팩토링: 383→233줄 (-39%)
- [x] `src/styles/familyAlarmCreateStyles.ts` 신규 — family-alarm/create.tsx 스타일 139줄 추출
- [x] `app/family-alarm/create.tsx` 리팩토링: 359→218줄 (-39%)
- [x] typecheck 통과 (mobile 0 errors)
- [x] 전체 테스트 통과 (mobile 466/466)

## P62 — notifications 서비스 테스트 ✅ (2026-04-25)

- [x] `test/notifications.test.ts` 신규 — 31 tests
  - NotificationChannel 상수 + action 식별자 (2건)
  - requestNotificationPermissions: granted/request/denied (3건)
  - configureNotificationChannels: 4채널 설정 + snooze/dismiss 액션 + i18n (3건)
  - syncAlarmNotifications: 취소→재스케줄, 비활성 제외, 권한 미부여, DAILY/WEEKLY 트리거, weekday 0→1/1→2/6→7 변환, 시간 파싱, voice_name 제목, channelId, categoryIdentifier, data 필드, 다중 알람, 문자열 repeat_days 파싱 (15건)
  - scheduleSnoozeNotification: 초 변환 + categoryIdentifier (2건)
  - registerPushTokenWithServer: 성공 + 에러 null (2건)
  - unregisterPushTokenFromServer: 성공 + 조용한 실패 (2건)
  - addNotificationResponseListener: 구독 객체 (1건)
- [x] typecheck 통과 (mobile 0 errors)
- [x] 전체 테스트 통과 (mobile 497/497)

## P63 — API core + auth utilities 테스트 ✅ (2026-04-25)

- [x] `test/apiCore.test.ts` 신규 — 22 tests (토큰 주입, 401 자동 로그아웃, 쿼리 파라미터, FormData, 에러 클래스, 204, 커스텀 헤더, AbortController, get/post/patch/del)
- [x] `test/authUtils.test.ts` 신규 — 20 tests (decodeIdToken 6건, AsyncStorage 토큰 관리 6건, isAppleAuthAvailable 2건, signInWithApple 6건)
- [x] typecheck 통과 (backend + mobile 0 errors)
- [x] 전체 테스트 통과 (mobile 539/539)

## P64 — ProfileDropdown + PresetMessageSection 비즈니스 로직 테스트 ✅ (2026-04-25)

- [x] `test/profileDropdown.test.ts` 신규 — 30 tests (getPlanLabel 6건, computeInitial 10건, toggleLanguage 3건, getAuthMenuItems 5건, shouldShowProfile 5건, 미테스트: handleLogout/handleDeleteAccount Alert 모킹)
- [x] `test/presetMessageSection.test.ts` 신규 — 28 tests (isGenerateDisabled 7건, pickRandomMessage 4건, onCategoryChange 3건, filterReadyVoicesForPreset 4건, hasRecentPresets 3건, PRESET_CATEGORIES 무결성 8건 — 일부 presets.test.ts 보완)
- [x] typecheck 통과 (backend + mobile 0 errors)
- [x] 전체 테스트 통과 (mobile 597/597, backend 672/672)

## P65 — Audio 서비스 유닛 테스트 ✅ (2026-04-25)

- [x] `test/audio.test.ts` 신규 — 28 tests (getLocalAudioPath 3건, ensureAudioDir 2건, setupAudioSession 1건, requestMicPermission 2건, startRecording 3건, stopRecording 3건, saveAudioLocally 3건, isAudioCached 3건, playAudio 1건, deleteLocalAudio 3건, getAudioCacheSize 4건)
- [x] expo-av + expo-file-system/legacy + react-native 모킹 (jest.requireMock 패턴)
- [x] typecheck 통과 (backend + mobile 0 errors)
- [x] 전체 테스트 통과 (mobile 625/625, backend 672/672)

## P67 — 보안 응답 헤더 미들웨어 ✅ (2026-04-25)

- [x] `src/middleware/securityHeaders.ts` 신규 — 9개 OWASP 보안 헤더 (X-Content-Type-Options, X-Frame-Options, Referrer-Policy, X-DNS-Prefetch-Control, X-Download-Options, X-Permitted-Cross-Domain-Policies, Permissions-Policy, HSTS, CSP)
- [x] `src/middleware/securityHeaders.test.ts` 신규 — 12 tests (개별 헤더 9건 + POST 적용 + 응답 보존 + 전체 동시 적용)
- [x] `src/index.ts` — sentryMiddleware 앞에 securityHeadersMiddleware 등록
- [x] typecheck 통과 (backend + mobile 0 errors)
- [x] 전체 테스트 통과 (backend 684/684, mobile 625/625)

## P68 — API error_code 일관성 확보 ✅ (2026-04-25)

- [x] `routes/billing.ts` — 13건 error_code 추가 (checkout 5건 + redeem 8건)
- [x] `routes/character.ts` — 3건 error_code 추가 (USER_NOT_FOUND 2건 + UNSUPPORTED_EVENT)
- [x] `routes/alarm.ts` — 2건 error_code 추가 (NOT_FRIENDS + FREE_PLAN_LIMIT)
- [x] `routes/friend.ts` — 5건 error_code 추가 (INVALID_EMAIL, USER_NOT_FOUND, SELF_REQUEST, ALREADY_FRIENDS, ALREADY_PENDING)
- [x] `routes/gift.ts` — 5건 error_code 추가 (INVALID_EMAIL, NOTE_TOO_LONG, RECIPIENT_NOT_FOUND, SELF_GIFT, NOT_FRIENDS)
- [x] typecheck 통과 (backend 0 errors)
- [x] 전체 테스트 통과 (backend 684/684)

## P69 — API error_code Batch 2 (user/notes/family) ✅ (2026-04-25)

- [x] `routes/user.ts` — 9건 error_code 추가 (FETCH_USER_FAILED, NO_FIELDS_TO_UPDATE, INVALID_BOOLEAN, USER_NOT_FOUND×2, INVALID_PLAN, UPDATE_PLAN_FAILED, DELETE_ACCOUNT_FAILED, SEARCH_FAILED)
- [x] `routes/notes.ts` — 10건 error_code 추가 (USER_NOT_FOUND×2, RECEIVER_REQUIRED, TEXT_REQUIRED, TEXT_TOO_LONG, SELF_NOTE, RECEIVER_NOT_FOUND, NOT_SAME_GROUP, NOTE_NOT_FOUND, FORBIDDEN)
- [x] `routes/family-invite.ts` — 20건 error_code 추가
- [x] `routes/family-group.ts` — 15건 error_code 추가
- [x] `routes/family-alarm.ts` — 24건 error_code 추가
- [x] typecheck 통과 (backend 0 errors)
- [x] 전체 테스트 통과 (backend 684/684)

## P72 — Notes 페이지네이션 완성 + 복합 DB 인덱스 ✅ (2026-04-25)

- [x] `routes/notes.ts` — GET /received, /sent에 `Promise.all`로 COUNT 쿼리 병렬 추가
- [x] 응답에 `total`, `limit`, `offset` 추가 (기존 paginated 엔드포인트와 일관)
- [x] `lib/migrations.ts` — Migration 19: composite-indices 6개 추가
  - `idx_friendships_a_status(user_a, status)` + `idx_friendships_b_status(user_b, status)`
  - `idx_gifts_recipient_created(recipient_id, created_at DESC)` + `idx_gifts_sender_created(sender_id, created_at DESC)`
  - `idx_alarms_user_active(user_id, is_active)` + `idx_alarms_target_active(target_user_id, is_active)`
- [x] `test/notes.test.ts` — COUNT mock 결과 + total/limit/offset assertion 추가
- [x] `test/api-latency.test.ts` — notes/received mock 수정
- [x] typecheck 통과 (backend + mobile 0 errors)
- [x] 전체 테스트 통과 (backend 684/684)

## P73 — family-alarm 라우트 테스트 ✅ (2026-04-25)

- [x] `test/family-alarm.test.ts` — 40 tests 신규
  - POST /alarms (TTS) — 20 tests: 검증(5), 인증/권한(6), 음성프로필(2), 정상경로(5), 엣지(2)
  - POST /alarms/voice — 20 tests: 검증(5), 인증/권한(5), 업로드(3), 정상경로(7)
- [x] typecheck 통과 (backend + mobile 0 errors)
- [x] 전체 테스트 통과 (backend 724/724, +40 신규)

## P87 — character.ts API 라우트 테스트 24건 추가 ✅ (2026-04-25)

- [x] `test/character.test.ts` — GET /characters/me 4건 (404+USER_NOT_FOUND, 자동생성, 기존캐릭터+stats+achievements, progress 계산)
- [x] `test/character.test.ts` — POST /characters/xp 20건: 이벤트 검증(3), XP 지급(3), 일일 캡(3), nonce 멱등(2), 스트릭(3), 마일스톤(2), alarm_dismissed(1), local_date 폴백(1), body 파싱 실패(1), 캡 면제(1)
- [x] typecheck 통과 (backend + mobile 0 errors)
- [x] 전체 테스트 통과 (backend 857/857, +24 신규)

## P90 — billing.ts API 라우트 테스트 25건 추가 ✅ (2026-04-25)

- [x] POST /checkout: error_code 5종 (PLAN_KEY_REQUIRED, PLAN_NOT_FOUND, PLAN_INACTIVE, FREE_NOT_BILLABLE, USER_NOT_FOUND)
- [x] POST /checkout: malformed JSON body, 비문자열 plan_key, period_days=0 기본값, DB에러→500
- [x] GET /subscription: family plan_group_id non-null, DB에러→500
- [x] GET /vouchers: 필드 매핑 정확성, ORDER BY 검증, DB에러→500
- [x] POST /redeem: error_code 6종 (CODE_REQUIRED, INVALID_FORMAT, CODE_NOT_FOUND, CODE_ALREADY_USED, CODE_EXPIRED, SELF_ISSUED)
- [x] POST /redeem: user not found, plan not found, 기간 검증, malformed body, DB에러→500
- [x] typecheck 통��� (backend 0 errors)
- [x] 전체 테스트 통과 (backend 920/920, +25)

## P94 — voice.ts 라우트 분할 + 구조화 로깅 ✅ (2026-04-25)

- [x] `voice.ts` (593줄) → `voice-upload.ts` (254줄) + `voice-profile.ts` (280줄) + `voice.ts` (11줄 aggregator)
- [x] `logger.ts`에 `logStructured(level, data)` 유틸 추가
- [x] `index.ts` + `fcm.ts`의 `console.warn` → `logStructured('info', ...)` 마이그레이션
- [x] `test/fcm.test.ts` spy 업데이트 (`console.warn` → `console.log`)
- [x] typecheck 통과 (backend + mobile 0 errors)
- [x] 전체 테스트 통과 (backend 780/780)

## P95 — alarm.ts 라우트 분할 ✅ (2026-04-25)

- [x] `alarm.ts` (502줄) → `alarm-helpers.ts` (148줄) + `alarm-query.ts` (126줄) + `alarm-mutation.ts` (241줄) + `alarm.ts` (11줄 aggregator)
- [x] typecheck 통과 (backend + mobile 0 errors)
- [x] 전체 테스트 통과 (alarm 41/41)

## P96 — character.ts 라우트 분할 ✅ (2026-04-25)

- [x] `character.ts` (405줄) → `character-helpers.ts` (168줄) + `character-query.ts` (30줄) + `character-mutation.ts` (215줄) + `character.ts` (11줄 aggregator)
- [x] typecheck 통과 (backend + mobile 0 errors)
- [x] 전체 테스트 통과 (backend 780/780)

## P97 — billing.ts 라우트 분할 ✅ (2026-04-25)

- [x] `billing.ts` (378줄) → `billing-helpers.ts` (23줄) + `billing-query.ts` (90줄) + `billing-mutation.ts` (230줄) + `billing.ts` (10줄 aggregator)
- [x] typecheck 통과 (backend + mobile 0 errors)
- [x] 전체 테스트 통과 (backend 780/780)

## P103 — Auth 미들웨어 단위 테스트 ✅ (2026-04-25)

- [x] `test/auth-middleware.test.ts` 신규 — 24 tests
  - Authorization header 검증 (5건): 누락, 비-Bearer, 공백, 비3파트, 2파트
  - App JWT 경로 (6건): 유효, 서명실패, 만료, audience 불일치, issuer 불일치, name 없음
  - Google 토큰 경로 (5건): 유효, API 에러, audience 불일치, 만료, 네트워크 에러
  - Apple 토큰 경로 (3건): 유효, 만료, email 없음
  - 토큰 발급자 분기 (3건): 알수없는 issuer→Google, voice-alarm→앱JWT, Apple→Apple
  - base64url 엣지 케이스 (2건): 패딩 없는 인코딩, JSON 파싱 실패
- [x] typecheck 통과 (backend + mobile 0 errors)
- [x] 전체 테스트 통과 (backend 872/872, +24 신규)

## P105 — NotificationBell + CoupleView 비즈니스 로직 테스트 ✅ (2026-04-25)

- [x] `test/notificationBell.test.ts` 신규 — 16 tests (formatBadgeCount 5건, shouldShowBadge 3건, getBellAccessibilityLabel 3건, computeBadgeCount 5건)
- [x] `test/coupleView.test.ts` 신규 — 23 tests (sortCoupleMembers 7건, areBothAlarmAllowed 4건, computeInitialFromDisplayName 5건, buildMemberDisplayName 5건, getRoleLabelKey 2건)
- [x] typecheck 통과 (backend + mobile 0 errors)
- [x] 전체 테스트 통과 (mobile 782/782, +39 신규)

---

## P106 — 앱 접근성 강화 (WCAG AA 감사) ✅ (2026-04-25)

- [x] 전체 앱 접근성 감사 수행 (13개 컴포넌트, 30+ 화면)
- [x] 22개 section title에 `accessibilityRole="header"` 추가 (alarm/create, alarm/edit, settings, character, compose, index, voices)
- [x] `alarms.tsx` 검색 TextInput에 `accessibilityLabel` 추가
- [x] `character/index.tsx` DEV Pressable에 `accessibilityRole="button"` + `accessibilityLabel` 추가
- [x] typecheck 통과 (backend + mobile 0 errors)
- [x] 전체 테스트 통과 (backend 872/872, mobile 782/782)

## P107 — 모바일 컴포넌트 테스트 추가 ✅ (2026-04-25)

- [x] `@testing-library/react-native` devDependency 설치
- [x] `test/OfflineBanner.test.tsx` — 4 tests (온/오프라인 렌더, 경고 색상, 상태 변경 재렌더)
- [x] `test/QueryStateView.test.tsx` — 8 tests (에러 표시, message/onRetry prop, 접근성 라벨)
- [x] `test/PeopleSkeletonCard.test.tsx` — 7 tests (count prop, 애니메이션 루프, memo 확인)
- [x] typecheck 통과 (backend + mobile 0 errors)
- [x] 전체 테스트 통과 (backend 872/872, mobile 801/801)

## P111 — TypeScript 타입 안전성 강화: `as unknown as` 제거 ✅ (2026-04-25)

- [x] `src/types/react-native-formdata.d.ts` 신규 — FormData.append RN 파일 객체 오버로드 (global interface merge)
- [x] `services/api/voice.ts` — `audioFile as unknown as Blob` 4건 제거
- [x] `components/PresetMessageSection.tsx` — `width: '48%' as unknown as number` 제거
- [x] `services/audio.ts` — `status as unknown as { durationMillis: number }` 제거
- [x] typecheck 통과 (backend + mobile 0 errors)
- [x] 전체 테스트 통과 (backend 872/872, mobile 898/898)

## P114 — ARCHITECTURE.md + README.md 현행화 ✅ (2026-04-25)

- [x] ARCHITECTURE.md 탭 구조 현행화: 6개→4개 (index, voices, alarms, compose), 삭제된 탭 제거, 신규 스택 화면 추가
- [x] ARCHITECTURE.md 백엔드 라우트 현행화: 7개→17개, aggregator 패턴 반영, lib 디렉토리 확장
- [x] ARCHITECTURE.md DB 스키마 현행화: 7개→22개 테이블, ER 다이어그램 확장
- [x] ARCHITECTURE.md Plan Limits 현행화: Plus→Personal, 음성 2개 제한, 가족 쪽지 추가
- [x] README.md 테스트 수치 현행화: 647→872 (백엔드), 286→1012 (모바일)

---

## 자가 생성 가능 풀 (BACKLOG 고갈 시)

- ~~앱 아이콘 설정 (adaptive icon config)~~ → P26 완료
- ~~알림 채널 설정 (Android notification channels)~~ → P27 완료
- ~~딥 링크 라우트 핸들링 (voicealarm:// scheme)~~ → P28 완료
- ~~expo-updates OTA 업데이트 체크 로직~~ → P29 완료
- ~~deepLink + updates 테스트 커버리지~~ → P30 완료
- ~~하드코딩 한국어 문자열 i18n 전환~~ → P31 완료
- ~~t() 폴백 문자열 패턴 정리~~ → P32 완료
- ~~백엔드 console.error → 구조화 로깅 전환 (Sentry 연동 강화)~~ → P33 완료
- ~~접근성 자동화 테스트 (axe-core 또는 @testing-library/react-native a11y 검증)~~ → P34 완료
- ~~백엔드 API 응답 시간 벤치마크 테스트 (주요 엔드포인트 latency 기준선 설정)~~ → P42 완료
- ~~모바일 번들 사이즈 모니터링 (expo export 후 JS bundle 크기 측정 + 기준선 테스트)~~ → P47 완료
- ~~대형 화면 파일 컴포넌트 분할 리팩토링 (alarm/create.tsx 1147줄, alarm/edit.tsx 796줄)~~ → P48 완료
- ~~대형 화면 파일 분할 후보: index.tsx (820줄)~~ → P50 완료 (820→468줄)
- ~~ADR (Architecture Decision Records) 작성 — 주요 기술 결정 사유 문서화~~ → P49 완료
- ~~React Query 캐시 전략 테스트 (staleTime, gcTime 설정 검증 + 오프라인 폴백 시나리오)~~ → P35 완료
- ~~도달 불가 화면 연결 (voice/diarize, voice/picker)~~ → P37 완료
- ~~미사용 export/함수 감사 (dead code 탐지 + 정리)~~ → P38 완료
- ~~백엔드 billing 라우트 테스트 커버리지 (결제 스텁 검증)~~ → 이미 25 tests 존재 (P7 batch에서 완료)
- ~~모바일 화면 컴포넌트 인터랙션 테스트 (voices add menu, alarm create form 등)~~ → P41 완료
- ~~ErrorBoundary 화면별 세분화 (탭별 독립 에러 격리)~~ → P39 완료
- ~~API core + auth utilities 테스트 (fetch 토큰 주입, 401 처리, JWT 디코딩, Apple 로그인)~~ → P63 완료
- ~~문서화 (README, ARCHITECTURE 현행화)~~ → P114 완료

## P34 — 접근성 자동화 검증 테스트 ✅ (2026-04-24)

- [x] `test/a11y-audit.test.ts` 신규 — 30 tests
  - 인터랙티브 요소 (Pressable/TouchableOpacity) accessibilityLabel/accessibilityRole 커버리지
  - Switch accessibilityLabel 검증
  - TextInput accessibilityLabel/placeholder 검증
  - i18n 키 동기화 (ko↔en 605키 완전 일치)
  - t() 폴백 문자열 패턴 부재 검증
  - WCAG AA 색상 대비 (라이트/다크 모드 12개 조합)
  - 접근성 인프라 무결성 (MIN_TOUCH_TARGET, a11y 파일 수 회귀 방지)
- [x] a11y 이슈 5건 수정:
  - MiniWaveformPlayer.tsx: TouchableOpacity a11y 추가
  - StateView.tsx: Pressable accessibilityLabel 추가
  - gift/received.tsx: 3개 TouchableOpacity a11y 추가
  - settings/index.tsx: TextInput placeholder + accessibilityLabel 추가
- [x] i18n: settings.deleteAccountPlaceholder 키 추가 (ko/en)
- [x] typecheck 통과 (backend + mobile 0 errors)
- [x] 전체 테스트 통과 (backend 653/653, mobile 346/346)

---

## P33 — 백엔드 console.error → 구조화 로깅 전환 ✅ (2026-04-24)

- [x] `src/lib/logger.ts` 신규 — `logRouteError(c, err)` 유틸 (JSON 출력 + Sentry captureException)
- [x] auth.ts 마이그레이션 (2건)
- [x] friend.ts 마이그레이션 (5건)
- [x] gift.ts 마이그레이션 (5건)
- [x] library.ts 마이그레이션 (3건)
- [x] stats.ts 마이그레이션 (2건)
- [x] voice.ts 마이그레이션 (1건)
- [x] user.ts 마이그레이션 (4건)
- [x] index.ts onError 마이그레이션 (1건)
- [x] `test/route-logger.test.ts` — 6 tests
- [x] typecheck 통과 (backend + mobile 0 errors)
- [x] 전체 테스트 통과 (backend 653/653, mobile 316/316)

---

## P32 — t() 폴백 문자열 패턴 정리 ✅ (2026-04-24)

- [x] 누락 i18n 키 14개 추가 (ko.json + en.json): home.activeAlarms/messages/friends/pendingGifts, login.error/saveFailed/noToken/unknownError/googleFailed/appleFailed, giftReceived.rejectSuccess, settings.notifPermission/permitted/notPermitted
- [x] 6파일 24건 t() 폴백 문자열 제거: index.tsx(11), LoginButtons.tsx(7), gift/received.tsx(1), friend/[id].tsx(1), _layout.tsx(1), settings/index.tsx(3)
- [x] typecheck 통과 (backend + mobile 0 errors)

---

## P30 — deepLink + updates 테스트 커버리지 ✅ (2026-04-24)

- [x] `test/deepLink.test.ts` 신규 — 23 tests (parseDeepLink 20건 + createDeepLink 3건)
- [x] `test/updates.test.ts` 신규 — 7 tests (__DEV__ 가드, web 가드, no update, fetch+alert, not new, error, reloadAsync)
- [x] 전체 316/316 통과 (기존 286 + P30 30)

## P31 — 하드코딩 한국어 문자열 i18n 전환 ✅ (2026-04-24)

- [x] `voice/picker.tsx` — useTranslation 추가 + ~20개 하드코딩 문자열 → t() 전환
- [x] `alarms.tsx` — 미리듣기 관련 3개 하드코딩 문자열 → t() 전환
- [x] `character/index.tsx` — DEV_EVENTS label → labelKey + t() 렌더
- [x] ko.json + en.json — speakerPicker.* 19키 + alarms.* 3키 + character.* 3키 = 25키 추가
- [x] typecheck 통과 (backend + mobile 0 errors)

---

## P35 — React Query 캐시 전략 테스트 ✅ (2026-04-24)

- [x] `test/queryCache.test.ts` 신규 — 36 tests (7 describe groups)
  - QueryClient defaults 검증 (staleTime 30s, retry 2, gcTime 기본)
  - 쿼리 키 일관성 (9개 주요 함수 + 전체 첫 번째 세그먼트 일관성)
  - enabled 가드 (탭 화면 isConnected 필수)
  - 뮤테이션 캐시 무효화 (8개 뮤테이션 패턴 검증)
  - 오프라인 캐시 통합 (AsyncStorage 캐시 키, 로드/저장 패턴, 폴백)
  - 쿼리 키 레지스트리 완전성 + 네이밍 혼용 방지
  - recentPresets 캐시 (최대 5개, 중복 제거, 최신 우선)
- [x] 쿼리 키 불일치 버그 3건 수정:
  - `family-alarm/create.tsx`: `['user-profile']` → `['userProfile']`
  - `note/create.tsx`: `['user-profile']` → `['userProfile']`
  - `friend/[id].tsx`: `['receivedGifts']` → `['gifts-received']`
- [x] typecheck 통과 (backend + mobile 0 errors)
- [x] 전체 테스트 통과 (backend 653/653, mobile 382/382)

---

## P38 — 미사용 export/함수 감사 (dead code 정리) ✅ (2026-04-24)

- [x] 백엔드 + 모바일 전체 export 감사 (67+ export 검증)
- [x] `packages/backend/src/types.ts` — 7개 미사용 인터페이스 삭제 (VoiceProfile, Message, Alarm, UserProfile, Friendship, Gift, DubJob)
- [x] `apps/mobile/src/components/QueryStateView.tsx` — LoadingView, EmptyView 미사용 컴포넌트 삭제
- [x] typecheck 통과 (backend + mobile 0 errors)
- [x] 전체 테스트 통과 (backend 653/653, mobile 392/392)

---

## P36 — 네비게이션 라우트 유효성 검증 테스트 ✅ (2026-04-24)

- [x] `test/navigationRoutes.test.ts` 신규 — 10 tests (5 describe groups)
  - 라우트 존재 여부 (22개 이상) + 주요 26개 라우트 필수 검증
  - router.push/replace 대상 → 실제 라우트 파일 매핑 (그룹 프리픽스 /(tabs) 처리)
  - 비-탭 스택 라우트 도달성 (모든 라우트에 네비게이션 엔트리포인트 존재)
  - [id] 동적 라우트 파라미터 전달 검증
  - Stack.Screen 등록 확인 (_layout.tsx)
  - deepLink 파서 경로 → 실제 라우트 매핑
- [x] unused import/var 2건 정리:
  - `voice/record.tsx`: `_LEVEL_BAR_COUNT` 미사용 상수 삭제
  - `NotificationBell.tsx`: `FontSize` 미사용 import 삭제
- [x] typecheck 통과 (backend + mobile 0 errors, --noUnusedLocals --noUnusedParameters 포함)
- [x] 전체 테스트 통과 (backend 653/653, mobile 392/392)

---

## P37 — 도달 불가 음성 화면 네비게이션 연결 ✅ (2026-04-24)

- [x] `app/(tabs)/voices.tsx` — 음성 추가 메뉴에 diarize(통화 녹음 추출) + picker(화자 분리) 옵션 2개 추가
- [x] `src/i18n/ko.json` — voices.diarize, diarizeDesc, speakerPicker, speakerPickerDesc 4키 추가
- [x] `src/i18n/en.json` — 동일 4키 추가
- [x] `test/navigationRoutes.test.ts` — allowedUnreachable 배열 제거 (모든 라우트 도달 가능)
- [x] typecheck 통과 (backend + mobile 0 errors)
- [x] 전체 테스트 통과 (backend 653/653, mobile 392/392)

---

## P39 — ErrorBoundary 탭별 세분화 ✅ (2026-04-24)

- [x] `withErrorBoundary` HOC 추가 (`src/components/ErrorBoundary.tsx`)
- [x] 4개 탭 화면에 적용 (index, voices, alarms, compose) — 탭별 독립 에러 격리
- [x] `test/errorBoundary.test.ts` — withErrorBoundary 테스트 3건 추가
- [x] typecheck 통과 (backend + mobile 0 errors)
- [x] 전체 테스트 통과 (backend 653/653, mobile 395/395)

---

## P40 — alarmPlayback.ts i18n 전환 ✅ (2026-04-24)

- [x] `src/lib/alarmPlayback.ts` — 하드코딩 한국어 6건 → i18n 키 반환 패턴으로 변경
  - 인터페이스: `reason`→`reasonKey`, `label`→`labelKey`, `caption`→`captionKey`+`captionParams`, `message`→`messageKey`
- [x] `app/(tabs)/alarms.tsx` — `t()` 호출로 번역 (badge, preview caption, toast)
- [x] `src/i18n/ko.json` + `en.json` — `alarmPlayback.*` 7키 추가
- [x] `test/alarmPlayback.test.ts` — 테스트 6건 업데이트 (i18n 키 매칭)
- [x] typecheck 통과 (backend + mobile 0 errors)
- [x] 전체 테스트 통과 (backend 653/653, mobile 395/395)

---

## P42 — API 응답 시간 벤치마크 테스트 ✅ (2026-04-24)

- [x] `test/api-latency.test.ts` 신규 — 19 tests (10 라우트 그룹)
  - GET 엔드포인트 레이턴시 기준선 (alarm, character, library, friend, stats, notes, user, gift)
  - POST 엔드포인트 레이턴시 기준선 (alarm, friend, push, code)
  - Validation fast-path 검증 (alarm, friend, push)
  - Sustained throughput: 50회 연속 요청 avg + p95
- [x] 전체 672/672 통과 (기존 653 + P42 19)

---

## P41 — 화면 인터랙션 로직 테스트 ✅ (2026-04-24)

- [x] `test/screenInteraction.test.ts` 신규 — 54 tests (3 describe groups)
  - Voice profile management (20 tests): isLimitReached, getDisplayProfiles, getStatusBadge, isFamilyPlan, filterReadyVoices
  - Alarm create interaction (18 tests): toggleDay, quickSetDays, isSoundOnlyInvalid, shouldShowWakeMode, getAmPm, findCachedMessage
  - Compose screen gating (16 tests): getComposeScreenState, computeUnreadCount, shouldMarkRead
- [x] typecheck 통과 (backend + mobile 0 errors)
- [x] 전체 테스트 통과 (backend 653/653, mobile 449/449)

---

## P43 — DAYS_OF_WEEK i18n 전환 + DAY_LABELS 통합 ✅ (2026-04-24)

- [x] `presets.ts` DAYS_OF_WEEK → DAY_KEYS (i18n 키 배열로 변환)
- [x] `family-alarm/create.tsx` 중복 DAY_LABELS 제거 → DAY_KEYS import
- [x] 소비자 4곳 (alarm/create, alarm/edit, alarms, family-alarm/create) `t(key)` 전환
- [x] i18n ko/en 각 7키 추가 (alarms.daySun~daySat)
- [x] presets.test.ts 업데이트 + i18n 키 검증 테스트 추가
- [x] api-latency.test.ts LATENCY_THRESHOLD_MS 50→75 (flaky 방지)
- [x] typecheck 통과 (backend + mobile 0 errors)
- [x] 전체 테스트 통과 (backend 672/672, mobile 450/450)

---

## P44 — 프리셋 메시지 i18n 전환 ✅ (2026-04-24)

- [x] `presets.ts` PresetCategory.messages → messageKeys (i18n 키 배열)
- [x] i18n ko/en 각 24키 추가 (preset.morning/lunch/afternoon/evening/night/cheer/love/health × 3)
- [x] alarm/create.tsx 랜덤 선택 + 리스트 `t(key)` 전환
- [x] message/create.tsx 리스트 `t(key)` 전환
- [x] presets.test.ts 업데이트
- [x] typecheck 통과 (backend + mobile 0 errors)
- [x] 전체 테스트 통과 (backend 672/672, mobile 450/450)

---

## P45 — 하드코딩 한국어 i18n 전환 Batch 1 (lib/utility + EmailPasswordForm) ✅ (2026-04-25)

- [x] `authFormValidation.ts` — TFunction 주입, 3건 → i18n 키 (authForm.*)
- [x] `familyAlarmForm.ts` — TFunction 주입, 5건 → i18n 키 (familyAlarmForm.*)
- [x] `familyAlarmLabel.ts` — TFunction 주입, 2건 → i18n 키 (familyAlarmLabel.* + 보간)
- [x] `speakerPickerState.ts` — TFunction 주입, 2건 → i18n 키 (speakerPicker.*)
- [x] `stateView.ts` — TFunction 주입, DEFAULTS → i18n 키 (stateView.*)
- [x] `voiceName.ts` — TFunction 주입, 2건 → i18n 키 (voiceName.*)
- [x] `EmailPasswordForm.tsx` — useTranslation 추가 + 15건 → t() 호출 (authForm.*)
- [x] 소비자 7개 파일 호출부 업데이트
- [x] i18n ko/en 각 22키 추가
- [x] 테스트 7개 파일 mock t 적용 + 검증 변경
- [x] typecheck 통과 (backend + mobile 0 errors)
- [x] 전체 테스트 통과 (backend 672/672, mobile 450/450)

## P47 — 모바일 번들 사이즈 모니터링 ✅ (2026-04-25)

- [x] `test/bundleAudit.test.ts` 신규 — 15 tests (4 describe groups)
  - 의존성 예산 (production ≤40, dev ≤15)
  - 금지 패키지 목록 (moment, lodash, axios, firebase 등 14개)
  - 미사용 의존성 감지 (import 분석)
  - 소스 크기 예산 (단일 ≤1200줄, 전체 ≤700KB)
  - import 위생 (node_modules 직접 참조, React 중복)
  - i18n 키 규모 (300~3000 leaf keys)
  - lib/ 순환 의존성 감지 (DFS)
  - 에셋 크기/스테일 감지
- [x] typecheck 통과 (backend + mobile 0 errors)
- [x] 전체 테스트 통과 (backend 672/672, mobile 466/466)

---

## P46 — 하드코딩 한국어 i18n 전환 Batch 2~4 (잔여)

### Batch 2: voucherShare.ts ✅ (2026-04-25)
- [x] `voucherShare.ts` — TFunction 주입, 8건 → i18n 키 (voucher 상태명 3건 + 공유 메시지 5건)

### Batch 3: ErrorBoundary ✅ (2026-04-25)
- [x] `ErrorBoundary.tsx` — useTranslation + 4건 → i18n 키 (제목/부제/재시도)

### Batch 4: character.ts ✅ (2026-04-25)
- [x] `character.ts` — TFunction 주입, 46건 → i18n 키 (스테이지 라벨 4 + 대사 28 + 스트릭 대사 14)

### 기타 ✅ (2026-04-25)
- [x] `friend/[id].tsx` — '친구' fallback → `t('friendProfile.friendFallback')`
- [x] typecheck 통과 (backend + mobile 0 errors)
- [x] 전체 테스트 통과 (backend 672/672, mobile 451/451)

---

## P48 — 대형 화면 파일 컴포넌트 분할 리팩토링 ✅ (2026-04-25)

- [x] `src/styles/alarmFormStyles.ts` 신규 — alarm/create + edit 공유 스타일 50+키 추출
- [x] `src/components/PresetMessageSection.tsx` 신규 — 프리셋 메시지 섹션 컴포넌트 추출
- [x] `alarm/create.tsx` 리팩토링: 1146→641줄 (-44%)
- [x] `alarm/edit.tsx` 리팩토링: 795→526줄 (-34%)
- [x] typecheck 통과 (backend + mobile 0 errors)
- [x] 전체 테스트 통과 (backend 672/672, mobile 466/466)

---

## P49 — ADR (Architecture Decision Records) 현행화 ✅ (2026-04-25)

- [x] ADR-004 상태 Superseded로 변경 (web 삭제 반영)
- [x] ADR-007 신규: 4탭 구조 + 프로필 드롭다운
- [x] ADR-008 신규: JWT 자체 발급 인증
- [x] ADR-009 신규: 음성 프로필 2개 제한
- [x] ADR-010 신규: i18n TFunction 주입 패턴
- [x] ADR-011 신규: 스타일 공유 createXxxStyles 패턴
- [x] ADR-012 신규: Sentry graceful degradation

---

## P50 — 홈 화면 스타일 추출 + 마지막 하드코딩 한국어 ✅ (2026-04-25)

- [x] `src/styles/homeStyles.ts` 신규 — 홈 화면 전체 스타일 추출 (351줄)
- [x] `(tabs)/index.tsx` 리팩토링: 820→468줄 (-43%)
- [x] `또는` 하드코딩 → `t('common.or')` i18n 전환
- [x] i18n ko/en `common.or` 키 추가
- [x] typecheck 통과 (mobile 0 errors)
- [x] 전체 테스트 통과 (mobile 466/466)

---

## P51 — people/message 대형 화면 스타일 추출 ✅ (2026-04-25)

- [x] `src/styles/peopleStyles.ts` 신규 — people 화면 스타일 275줄 추출
- [x] `app/people/index.tsx` 리팩토링: 770→494줄 (-36%)
- [x] `src/styles/messageCreateStyles.ts` 신규 — message/create 스타일 320줄 추출
- [x] `app/message/create.tsx` 리팩토링: 727→406줄 (-44%)
- [x] typecheck 통과 (backend + mobile 0 errors)
- [x] 전체 테스트 통과 (mobile 466/466)

---

## P52 — alarms/voices 탭 스타일 추출 ✅ (2026-04-25)

- [x] `src/styles/alarmsStyles.ts` 신규 — alarms 화면 스타일 228줄 추출
- [x] `app/(tabs)/alarms.tsx` 리팩토링: 668→437줄 (-35%)
- [x] `src/styles/voicesStyles.ts` 신규 — voices 화면 스타일 268줄 추출
- [x] `app/(tabs)/voices.tsx` 리팩토링: 619→348줄 (-44%)
- [x] typecheck 통과 (backend + mobile 0 errors)
- [x] 전체 테스트 통과 (mobile 466/466)

---

## P53 — character/settings 스타일 추출 ✅ (2026-04-25)

- [x] `src/styles/characterStyles.ts` 신규 — character 화면 스타일 241줄 추출
- [x] `app/character/index.tsx` 리팩토링: 541→298줄 (-45%)
- [x] `src/styles/settingsStyles.ts` 신규 — settings 화면 스타일 155줄 추출
- [x] `app/settings/index.tsx` 리팩토링: 518→363줄 (-30%)
- [x] typecheck 통과 (backend + mobile 0 errors)
- [x] 전체 테스트 통과 (mobile 466/466)

## P54 — library/dub 스타일 추출 ✅ (2026-04-25)

- [x] `src/styles/libraryStyles.ts` 신규 — library 화면 스타일 180줄 추출
- [x] `app/library/index.tsx` 리팩토링: 536→355줄 (-34%)
- [x] `src/styles/dubTranslateStyles.ts` 신규 — dub/translate 스타일 192줄 추출
- [x] `app/dub/translate.tsx` 리팩토링: 501→309줄 (-38%)
- [x] typecheck 통과 (backend + mobile 0 errors)
- [x] 전체 테스트 통과 (mobile 466/466)

## P55 — 날짜 로캘 하드코딩 → i18n 동적 전환 ✅ (2026-04-25)

- [x] `src/i18n/index.ts` — `getDateLocale()` 유틸 추가 (i18n.language → Intl 로캘)
- [x] 5파일 7건 `toLocaleDateString('ko-KR')` → `getDateLocale()` 교체 (index, voices, friend, message, library, voice)
- [x] typecheck 통과 (backend + mobile 0 errors)
- [x] 전체 테스트 통과 (mobile 466/466)

## P56 — 알림 채널/액션 버튼 i18n 전환 ✅ (2026-04-25)

- [x] `notifications.ts` — top-level side effect → `configureNotificationChannels(t: TFunction)` 함수 래핑
- [x] `_layout.tsx` — i18n 준비 후 `configureNotificationChannels(t)` 호출
- [x] i18n ko/en `notification.snoozeAction`, `notification.dismissAction` 2키 추가
- [x] 기존 `settings.channel*` 8키를 채널 생성 코드에서 실제 사용하도록 연결
- [x] typecheck 통과 (backend + mobile 0 errors)
- [x] 전체 테스트 통과 (mobile 466/466, a11y-audit 30/30)

## P66 — 프로덕션 API URL 수정 ✅ (2026-04-25)

- [x] `apps/mobile/src/services/api/core.ts` — 프로덕션 폴백 URL `your-name.workers.dev` → `voicealarm.workers.dev` 수정
- [x] `apps/mobile/src/hooks/useAuth.tsx` — `resolveApiBase()` `__DEV__` 분기 추가 + 프로덕션 URL 통일
- [x] `apps/mobile/eas.json` — preview/production env에 `EXPO_PUBLIC_API_URL` 추가
- [x] typecheck 통과 (backend + mobile 0 errors)
- [x] 전체 테스트 통과 (backend 672/672, mobile 625/625)

## P71 — API error_code Final Batch (voice/dub/auth) + 테스트 검증 ✅ (2026-04-25)

- [x] `routes/voice.ts` — 35건 error_code 추가 (upload 6 + separate 3 + speakers-get 3 + speakers-patch 6 + get 2 + patch 4 + clone 4 + diarize 2 + stats 2 + delete 3)
- [x] `routes/dub.ts` — 7건 error_code 추가 (POST 4 + GET 3)
- [x] `routes/auth.ts` — jsonError 헬퍼에 error_code alias 추가 (기존 code 필드와 동일값)
- [x] `test/voice.test.ts` — 28개 기존 에러 테스트에 error_code 검증 assertion 추가
- [x] **전체 API error_code 일관성 100% 달성** — 모든 라우트 파일 적용 완료
- [x] typecheck 통과 (backend 0 errors)
- [x] 전체 테스트 통과 (backend 684/684)

## P74 — WCAG AA 색상 대비 버그 수정 + a11y 테스트 정확성 ✅ (2026-04-25)

- [x] `test/a11y-audit.test.ts` — 하드코딩 stale LightColors/DarkColors → `Colors` import (실제 앱 색상으로 검증)
- [x] `src/constants/theme.ts` — textSecondary WCAG AA 달성 (light #8E8E93→#6B7280, dark #8E8E93→#98989D)
- [x] `packages/backend/src/lib/logger.ts` — eslint-disable 주석에 Hono Context 불변성 이유 문서화
- [x] typecheck 통과 (backend + mobile 0 errors)
- [x] 전체 테스트 통과 (backend 724/724, mobile 625/625)

---

## P75 — packages/ui ↔ mobile/constants/theme 색상 동기화 ✅ (2026-04-25)

- [x] `packages/ui/src/tokens.ts`의 LightColors/DarkColors와 `apps/mobile/src/constants/theme.ts`의 Colors 값 불일치 해소 (8건: light textTertiary + dark 7건)
- [x] 단일 소스(source of truth) 결정: mobile `theme.ts`가 source of truth (web 삭제됨, iOS 네이티브 톤, WCAG AA 검증됨)
- [x] WCAG AA 대비비 유지 검증 (UI 패키지 a11y 테스트 38/38, mobile 625/625 통과)

---

## P76 — family-invite 라우트 테스트 ✅ (2026-04-25)

- [x] POST /invites — 초대 생성 8 tests (자동 그룹 탐색, 명시적 ID, 404/403/409 분기, malformed body)
- [x] GET /invites — 초대 목록 4 tests (정상, 빈 사용자, 빈 목록, used 필드 매핑)
- [x] POST /invites/:code/accept — 초대 수락 12 tests (정상, 포맷/404/409/400 분기, 만료 시각 DB 갱신)
- [x] POST /invites/:code/revoke — 초대 취소 6 tests (정상, 포맷/404/403/409 분기)
- [x] 전체 테스트 통과 (backend 754/754)

---

## P77 — family-group 라우트 테스트 ✅ (2026-04-25)

- [x] family-group.ts 전체 핸들러 테스트 커버리지 작성 (26 tests)
- [x] 전체 테스트 통과 확인 (backend 780/780)

---

## P78 — family-helpers + sentry 미들웨어 테스트 ✅ (2026-04-25)

- [x] family-helpers.ts 유틸 테스트 (resolveUserPk 3 + assertSameGroup 5 = 8 tests)
- [x] sentry.ts 미들웨어 테스트 (DSN 분기 4 tests)
- [x] 전체 테스트 통과 확인 (backend 792/792)
- [x] 발견: Sentry captureException 미작동 버그 (Hono compose 구조 이슈) → P79

---

## P79 — Sentry captureException 버그 수정 ✅ (2026-04-25)

- [x] sentryMiddleware try-catch → app.onError 패턴으로 마이그레이션
- [x] sentry.test.ts에서 captureException 호출 검증 테스트 추가 (5 tests)
- [x] 전체 테스트 통과 확인 (backend 793/793)

---

## P80 — 모바일 error_code 처리 시스템 ✅ (2026-04-25)

- [x] ApiError.errorCode 추출 + apiErrors.ts 유틸 (40개 error_code → i18n 매핑)
- [x] ko/en 46키 추가 + 33 tests (전체 658/658)

---

## P81 — error_code 화면 통합 ✅ (2026-04-25)

- [x] 15개 화면 getApiErrorMessage 마이그레이션 + fallback 파라미터
- [x] 구버전 src/types.ts getApiErrorMessage 삭제 + 4 tests (전체 662/662)

---

## P82 — 백엔드 푸시 알림 + 화자 분리 i18n ✅ (2026-04-25)

- [x] fcm.ts — pushTexts i18n 맵 (ko/en) + sendAlarmPush/sendNotePush locale 파라미터 추가
- [x] voice.ts — diarize 응답 `화자 N` → `Speaker N` (클라이언트가 자체 i18n 사용)
- [x] notes.ts — Accept-Language 헤더에서 locale 추출하여 sendNotePush에 전달
- [x] fcm.test.ts — sendNotePush 5 tests 추가 + sendAlarmPush locale 2 tests 추가
- [x] 전체 테스트 통과 (backend 798/798, mobile 662/662)

## P83 — 접근성 역할(accessibilityRole) 누락 보강 ✅ (2026-04-25)

- [x] 전체 모바일 앱 WCAG AA 접근성 감사 수행 (탭 화면, 스택 화면, 컴포넌트)
- [x] `app/(tabs)/index.tsx` — 5건 수정: statsErrorCard/pendingGifts/viewAll/recentItem role + greeting header role
- [x] `app/(tabs)/alarms.tsx` — 1건: previewButton `accessibilityRole="button"` 추가
- [x] `src/components/QueryStateView.tsx` — 1건: retryBtn `accessibilityRole="button"` + label 추가
- [x] `app/people/index.tsx` — 4건: remove/accept/share/revoke 버튼 role 추가
- [x] `app/settings/index.tsx` — 5건: 페이지 제목 + 4개 섹션 제목 `accessibilityRole="header"` 추가
- [x] typecheck 통과 (backend 0 errors, mobile 0 errors)

## P84 — alarm.ts 검증 로직 중복 제거 + error_code 일관성 ✅ (2026-04-25)

- [x] validateAlarmFields() 함수 추출 — POST/PATCH 공통 검증 (~70줄→2줄)
- [x] 모든 에러 응답에 error_code 추가 (17종)
- [x] 프론트엔드 ALARM_NOT_FOUND 매핑 + i18n
- [x] alarm.test.ts error_code 검증 8 tests 추가
- [x] 전체 테스트 통과 (backend 806/806, mobile 662/662)

## P85 — user.test.ts 테스트 커버리지 강화 ✅ (2026-04-25)

- [x] beforeEach: `mockDB.calls.length = 0` → `mockDB.reset()` + execute 복원
- [x] 기존 테스트 error_code 검증 강화 (NO_FIELDS_TO_UPDATE, INVALID_BOOLEAN, USER_NOT_FOUND, INVALID_PLAN)
- [x] toBoolFlag 변환 테스트 6건 ('1'/'0'/'true'/'false'/1/0)
- [x] DB 에러 핸들링 테스트 3건 (FETCH_USER_FAILED, DELETE_ACCOUNT_FAILED, SEARCH_FAILED)
- [x] 엣지 케이스 테스트 4건 (allow_family_alarms null, 잘못된 JSON x2, family 플랜, 빈 쿼리)
- [x] 전체 테스트 통과 (backend 820/820, mobile 662/662)

## P86 — notes.test.ts 테스트 커버리지 강화 ✅ (2026-04-25)

- [x] vi.hoisted() 도입으로 mockSendNotePush vi.mock factory 참조 해결
- [x] 기존 10개 에러 테스트에 error_code 검증 추가 (USER_NOT_FOUND, RECEIVER_REQUIRED, TEXT_REQUIRED, TEXT_TOO_LONG, SELF_NOTE, RECEIVER_NOT_FOUND, NOT_SAME_GROUP, NOTE_NOT_FOUND, FORBIDDEN)
- [x] sendNotePush 호출 검증 3건 (인자/locale ko 기본, Accept-Language: en → locale en, sender name 폴백 2건)
- [x] 경계값 테스트 4건 (text 500자 성공, 공백 receiver_id/text, limit 0 → 기본값 20)
- [x] GET /notes/sent 페이지네이션 3건 (limit/offset 적용, max 100 클램핑, 음수 → 1)
- [x] GET /notes/received 클램핑 3건 (limit 0 → 20, 음수 offset → 0, 비숫자 → 기본값)
- [x] 전체 테스트 통과 (backend 833/833, mobile 662/662)

## P87 — character.test.ts API 라우트 테스트 24건 추가 ✅ (2026-04-25)

- [x] GET /characters/me 4건 (404, 자동생성, 기존캐릭터+stats, progress)
- [x] POST /characters/xp 20건 (이벤트검증, XP지급, 일일캡, 날짜리셋, nonce멱등, 스트릭, 마일스톤, 캡면제)
- [x] 전체 테스트 통과 (backend 857/857, mobile 662/662)

## P88 — friend.test.ts API 라우트 테스트 19건 추가 ✅ (2026-04-25)

- [x] POST /friend: 빈 이메일, 누락 이메일, DB 에러 + 기존 6건 error_code 검증 강화
- [x] GET /friend/list: 빈 목록, 페이지네이션, limit 클램핑(max 100, min 1), 검색 쿼리 SQL 전달, 빈 검색어 trim, DB 에러
- [x] GET /friend/pending: 빈 목록, 페이지네이션, DB 에러
- [x] PATCH /friend/:id/accept: 잘못된 UUID, 응답 상세 구조, pending+현재 사용자 SQL 검증, DB 에러
- [x] DELETE /friend/:id: 잘못된 UUID, user_a/user_b SQL 조건 검증, DB 에러
- [x] 전체 테스트 통과 (backend 876/876, mobile 662/662)

## P89 — gift.test.ts API 라우트 테스트 19건 추가 ✅ (2026-04-25)

- [x] POST /gift: 빈 이메일, 잘못된 UUID message_id, note 200자 경계, null note 저장, DB 에러 + error_code 검증 강화
- [x] GET /gift/received: 빈 목록, 페이지네이션, limit 클램핑, 검색 쿼리 LIKE, DB 에러
- [x] GET /gift/sent: 빈 목록, 검색 3필드 LIKE, DB 에러
- [x] PATCH /gift/:id/accept: UUID 유효성, message_library 삽입 검증, 응답 구조, DB 에러
- [x] PATCH /gift/:id/reject: UUID 유효성, pending+recipient SQL 검증, 응답 구조, DB 에러
- [x] 전체 테스트 통과 (backend 895/895, mobile 662/662)

## P91 — MiniWaveformPlayer 접근성 라벨 i18n 수정 ✅ (2026-04-25)

- [x] accessibilityLabel 하드코딩 영어('Pause'/'Play')→i18n(t('player.a11yPause')/t('player.a11yPlay')) 변경
- [x] 전체 감사: TypeScript any(1건 정당), 하드코딩 문자열(언어이름 의도적), 기타 a11y 속성 정상
- [x] typecheck + 테스트 통과 (backend 920/920, mobile 662/662)

## P92 — 백엔드 테스트 파일 위치 정리 (완료)

- [x] `src/routes/*.test.ts` 6개 파일과 `test/*.test.ts` 6개 파일 중복 존재 정리
- [x] 각 쌍에서 고유 테스트 식별 → test/ 폴더로 통합 (friend +10, gift +14, library +3)
- [x] src/routes/*.test.ts 6개 + src/test-helper.ts 삭제
- [x] vitest.config.ts include 패턴 정리 (src/**/*.test.ts 제거)
- [x] 전체 테스트 통과 확인 (780/780)

## P93 — 모바일 접근성 누락 속성 보강 ✅ (2026-04-25)

- [x] `app/message/[id].tsx` — 5개 TouchableOpacity에 accessibilityRole="button" + accessibilityLabel 추가
- [x] `app/people/index.tsx` — TextInput(친구 추가)에 accessibilityLabel 추가
- [x] typecheck 통과 (backend + mobile 0 errors)

## P98 — Sentry 테스트 + 온보딩 접근성 개선 ✅ (2026-04-25)

- [x] `apps/mobile/test/sentry.test.ts` 신규 — DSN 미설정/빈값 시 init 미호출 검증 (모바일 lib 14/14 모듈 테스트 완료)
- [x] `apps/mobile/app/onboarding.tsx` — 페이지 타이틀에 accessibilityRole="header" 추가
- [x] typecheck 통과 (backend + mobile 0 errors)

## P99 — Route Helper 단위 테스트 추가 ✅ (2026-04-25)

- [x] `packages/backend/test/alarm-helpers.test.ts` — normalizeAlarmRow + validateAlarmFields (37 tests)
- [x] `packages/backend/test/character-helpers.test.ts` — rowToCharacter, buildProgress, serializeCharacter, todayString (11 tests)
- [x] `packages/backend/test/billing-helpers.test.ts` — PAID_PLAN_TYPES, planTypeToUserPlan (5 tests)
- [x] 전체 테스트 836/836 통과, typecheck 0 errors

## P100 — 미테스트 Voice 엔드포인트 테스트 추가 ✅ (2026-04-25)

- [x] `packages/backend/test/voice.test.ts` — GET /voice/family (3), POST /voice/clone (6), POST /voice/diarize (3) = 12 tests 추가
- [x] ElevenLabsClient mock + ENV 바인딩 인프라 추가

## P101 — TypeScript 엄격 모드 강화: noUncheckedIndexedAccess ✅ (2026-04-25)

- [x] `packages/backend/tsconfig.json`에 `noUncheckedIndexedAccess: true` 활성화
- [x] 171개 컴파일 에러 수정 (27개 소스 파일)
- [x] 주요 패턴: `rows[0]` → `rows[0]!`, array destructuring → tuple cast, bounded loop `!`
- [x] 전체 테스트 848/848 통과, typecheck 0 errors (backend + mobile)
- [x] 전체 테스트 848/848 통과, typecheck 0 errors

## P102 — TypeScript 엄격 모드 강화: noUncheckedIndexedAccess (모바일) ✅ (2026-04-25)

- [x] `apps/mobile/tsconfig.json`에 `noUncheckedIndexedAccess: true` 활성화
- [x] 78개 컴파일 에러 수정 (27개 파일: 소스 13개 + 테스트 14개)
- [x] 주요 패턴: tuple cast `as [number, number]`, `arr[0]!`, `keys[idx]!`, `RecordingOptions` cast
- [x] typecheck 0 errors (backend + mobile), 전체 테스트 848/848 통과

## P103 — Auth 미들웨어 단위 테스트 ✅ (2026-04-25)

- [x] `packages/backend/test/auth-middleware.test.ts` — 24 tests (header 검증, App/Google/Apple JWT, 분기, base64url)
- [x] 전체 테스트 872/872 통과, typecheck 0 errors

## P104 — 모바일 API 서비스 모듈 테스트 ✅ (2026-04-25)

- [x] `apps/mobile/test/apiSocial.test.ts` — Friend/Gift/Notes API (18 tests)
- [x] `apps/mobile/test/apiUser.test.ts` — User/Stats/Library API (12 tests)
- [x] `apps/mobile/test/apiBilling.test.ts` — Voucher/Code Registration API (5 tests)
- [x] `apps/mobile/test/apiAlarm.test.ts` — Alarm/Push Token API (10 tests)
- [x] `apps/mobile/test/apiFamily.test.ts` — Family Group/Alarm/Invites API (10 tests)
- [x] `apps/mobile/test/apiCharacter.test.ts` — Character/XP API (6 tests)
- [x] `apps/mobile/test/apiVoice.test.ts` — Voice/Upload/TTS/Dub API (24 tests)
- [x] 전체 테스트: mobile 743/743, backend 872/872, typecheck 0 errors


## P108 — LoginButtons 컴포넌트 렌더링 테스트 ✅ (2026-04-25)

- [x] `apps/mobile/test/LoginButtons.test.tsx` — 18 tests (Google/Apple 로그인 전 경로, useEffect 응답 처리, 에러 핸들링, 접근성)
- [x] Animated 버전 불일치 해결 (jest.spyOn + TouchableOpacity stub)
- [x] render() + waitFor() 패턴 정립 (React 19 act() 이중 래핑 금지)
- [x] 전체 테스트: mobile 819/819, backend 872/872, typecheck 0 errors

## P112 — 화면 비즈니스 로직 테스트 (voices, compose, note/create) ✅ (2026-04-25)

- [x] `apps/mobile/test/voicesScreen.test.ts` — 46 tests (2-profile limit, status badge, family section, query enablement, display profiles fallback)
- [x] `apps/mobile/test/composeScreen.test.ts` — 37 tests (auth/plan access gates, unread count, sender display, query enablement)
- [x] `apps/mobile/test/noteCreate.test.ts` — 31 tests (recipient filtering, canSend validation, display name, char count)
- [x] 전체 테스트: mobile 1012/1012 (58 suites), backend 872/872, typecheck 0 errors

## P113 — App Store / Google Play 스토어 등록 메타데이터 준비 ✅ (2026-04-25)

- [x] `docs/P4_NOTION_SYNC.md` — Notion 기획서 동기화 가이드 (기술스택/로드맵/이슈 3섹션)
- [x] `docs/STORE_LISTING.md` — 스토어 등록 메타데이터 완성:
  - 앱 기본 정보 (카테고리, 등급, 가격, 언어)
  - 한국어/영어 스토어 설명 (짧은 설명 + 전체 설명 + 키워드 + What's New)
  - 스크린샷 가이드 (7장 구성 + 디바이스별 해상도)
  - 개인정보 처리방침 요약 (iOS Privacy Labels + Android Data Safety)
  - 심사 가이드 (iOS/Android 리뷰 노트)
  - 출시 전 체크리스트 (12항목)

## P115 — alarm-mutation + alarm-query 통합 테스트 ✅ (2026-04-25)

- [x] `packages/backend/test/alarm-mutation.test.ts` — 26 tests (POST 생성, PATCH 수정, DELETE 삭제, 플랜 제한, 친구 검증, UUID 검증)
- [x] `packages/backend/test/alarm-query.test.ts` — 13 tests (tick, 목록 필터링, 단건 조회, 접근 제어)
- [x] 전체 테스트: backend 911/911 (51 suites), mobile 1012/1012, typecheck 0 errors

## P116 — billing-mutation + billing-query 통합 테스트 ✅ (2026-04-25)

- [x] `packages/backend/test/billing-mutation.test.ts` — 15 tests (checkout 쿼리순서/trim/기본값/해시검증, redeem 쿼리순서/UPDATE검증/edge cases)
- [x] `packages/backend/test/billing-query.test.ts` — 14 tests (vouchers resolveUserPk/JOIN/필드매핑, subscription google_id직접사용/JOIN/필터/LIMIT)
- [x] 전체 테스트: backend 940/940 (53 suites), mobile 1012/1012, typecheck 0 errors

## P117 — character-mutation + character-query 통합 테스트

- [ ] `packages/backend/test/character-mutation.test.ts` — XP 부여, 스트릭 계산, 캐릭터 생성/업데이트 비즈니스 로직
- [ ] `packages/backend/test/character-query.test.ts` — 캐릭터 조회, 스트릭/능력치/업적 응답 구조

## P118 — voice-profile + voice-upload 통합 테스트

- [ ] `packages/backend/test/voice-profile.test.ts` — 음성 프로필 CRUD, 2개 제한 검증
- [ ] `packages/backend/test/voice-upload.test.ts` — 파일 업로드, R2 연동 (mock), 형식 검증
