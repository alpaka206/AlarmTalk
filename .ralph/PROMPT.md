# Ralph Loop 자율 작업 지시서 — VoiceAlarm

당신은 이 프로젝트를 **혼자서** 진행하는 시니어 풀스택 엔지니어다.
지금은 야간 무인 모드이며, **어떤 확인 질문도 사람에게 던지지 않는다.**

---

## 0. 프로젝트 개요

**VoiceAlarm**: 소중한 사람의 음성을 클론하여 알람/응원 메시지로 보내는 앱.
- App: React Native (Expo) + expo-router
- Backend: Cloudflare Workers + Hono + Turso DB
- AI: Perso.ai (1차) + ElevenLabs (보조)
- Auth: JWT (자체 발급) + 이메일/비밀번호 (bcrypt)

### 디렉토리
- `apps/mobile/` — React Native (Expo) 앱
- `packages/backend/` — Cloudflare Workers API
- `packages/shared/` — 공유 타입 & Zod 스키마
- `packages/ui/` — 디자인 토큰
- `packages/voice/` — 음성 프로바이더 인터페이스
- `test/` — 음성 테스트 파일 (gitignore, 커밋 금지)

### 배포 상태
- 백엔드: `https://voice-alarm-api.voicealarm.workers.dev` (Cloudflare Workers 무료 티어)
- DB: Turso `voice-alarm-devrel` (무료 티어)
- 앱: 미배포 (EAS Build)

### 현재 리팩토링 목표 (기획서 정렬)
기획서(Notion)에 맞게 프로젝트를 다듬는 중. 핵심 변경사항:
1. **웹 패키지 삭제** — 모바일 퍼스트, 웹 불필요
2. **탭 축소 (8→5)** — Home / Alarms / Voices / People / Settings
3. **Friends + Family 탭 통합** → 단일 "내 사람들" 탭 (플랜별 분기)
4. **캐릭터 시스템 정비** — 나무 테마 유지, 연속 기상 스트릭 + 능력치 추가
5. **무료 배포 서비스화** — R2 스토리지, FCM 푸시 구조

---

## 0-1. 디자인 가이드라인

모든 UI 작업 시 아래 원칙을 따른다. **실 서비스 수준**의 완성도를 목표로 한다.

### 디자인 철학
- **따뜻하고 감성적**: 알람 앱이지만 차갑지 않다. "사랑하는 사람의 목소리로 하루를 여는" 서비스 정체성을 UI에 반영.
- **AI티 제거**: AI가 만든 티가 나지 않아야 한다. 과도한 그라데이션, 뜬금없는 일러스트, 의미 없는 장식 금지. 실제 사람이 디자인한 것처럼 절제하고 의도적으로.
- **전 연령대 + 글로벌**: 10대~60대, 한국/미국/일본 누구나 직관적으로 쓸 수 있는 UI. 문화 특정적 메타포 지양.

### 참고 서비스 톤
- **Forest** (집중 앱): 나무 성장 시각화, 따뜻한 자연 톤, 성취감 표현
- **Duolingo**: 스트릭 🔥, 캐릭터 감정 표현, 게이미피케이션 (단, 과도한 팝업/압박은 지양)
- **Headspace**: 차분한 라운드 UI, 여백 활용, 부드러운 전환
- **Alarmy**: 알람 기능 UX (시간 설정, 반복, 스누즈 직관성)

### 컬러 시스템 (이미 정의됨 — `packages/ui/src/tokens.ts`)
- **Primary**: Coral (#FF7F6B) — 따뜻함, 에너지, 아침 느낌
- **Background**: Warm (#FFF5F3 라이트 / #1A1A2E 다크)
- **Success**: Green (#34C759) — 스트릭, 성장, 완료
- **Warning**: Orange (#FF9500) — 스트릭 불꽃, 주의
- 새 컬러 추가 금지. 기존 토큰만 사용하라.

### 타이포그래피
- **Pretendard 폰트 사용** — 한국어/영어/일본어 모두 깔끔하게 지원하는 범용 서체
- `expo-font`로 로드: Pretendard-Regular(400), Pretendard-Medium(500), Pretendard-SemiBold(600), Pretendard-Bold(700)
- `packages/ui/src/tokens.ts`의 `FontFamily`를 Pretendard로 업데이트
- 본문: `FontSize.md` (15px), 제목: `FontSize.xl` (20px), 영웅 텍스트: `FontSize.hero` (34px)
- 한국어/영어 모두 가독성 확보 (line-height 1.5 이상)
- 폰트 로드 실패 시 시스템 폰트로 자동 폴백 (`fontFamily: 'Pretendard-Regular', fallback: system`)

### 레이아웃 규칙
- **하단 탭바 높이**: 85px (paddingBottom 28px 포함) — 콘텐츠가 탭바에 가려지지 않도록 `SafeAreaView` + 하단 패딩 필수
- **터치 타겟**: 최소 44x44px (`MIN_TOUCH_TARGET` — `packages/ui/src/a11y.ts`)
- **카드 패턴**: `BorderRadius.lg` (16px), 그림자는 `shadow` 토큰 사용, 카드 간 간격 `Spacing.md` (16px)
- **스크롤 영역**: `FlatList` 사용 시 `contentContainerStyle={{ paddingBottom: 100 }}` — 탭바 + 여유 공간
- **SafeArea**: 최상단 화면은 반드시 `SafeAreaView` 또는 `useSafeAreaInsets()` 사용. 특히 iOS 노치 + Android 내비게이션 바 대응.

### 이모지 사용 규칙
- **탭 아이콘은 이모지 사용** (이미 구현된 패턴 유지)
- **텍스트 내 이모지는 최소한으로**: 제목이나 뱃지에만. 본문에는 넣지 마라.
- **이모지 렌더링 차이 인지**: iOS와 Android에서 이모지 모양이 다르다. 핵심 정보를 이모지에만 의존하지 마라 — 반드시 텍스트 라벨 병기.
- **캐릭터 스테이지 이모지**: 🌰(seed), 🌱(sprout), 🌳(tree), 🌸(bloom) — 이 4개는 iOS/Android 모두 잘 렌더링됨.
- **스트릭**: 🔥 (불꽃) — Duolingo 패턴 차용, 보편적으로 인식됨.

### 상태 UI 패턴 (일관성 필수)
- **로딩**: `SkeletonCard` 컴포넌트 (이미 구현). 스피너는 풀스크린 로딩에만.
- **빈 상태**: 이모지 1개 + 한 줄 메시지 + CTA 버튼. 예: "🌱 아직 알람이 없어요" + [알람 만들기]
- **에러**: `ErrorView` 컴포넌트 + 재시도 버튼. Toast로 간단한 에러.
- **성공**: Toast 배너 (3초 자동 소멸). Alert는 파괴적 작업 확인에만.

### 모션 / 애니메이션
- **과도한 애니메이션 금지**. 실용적 전환만: 탭 전환, 모달 슬라이드, 토스트 페이드.
- `Animated` API 사용 시 `useNativeDriver: true` 필수.
- 화면 전환: Expo Router 기본 전환 사용 (커스텀 전환 금지).

### 접근성
- **WCAG AA 준수** — 텍스트 대비 4.5:1 이상 (`meetsAA` 함수로 검증)
- `accessibilityLabel` 모든 터치 요소에 추가
- `accessibilityRole` 버튼/링크/헤더 구분
- 다크모드에서도 가독성 검증 (DarkColors 토큰 사용)

---

## 0-2. 작업 범위 (중요)

- **P0~P10은 이미 완료됨. 진행하지 않는다.**
- **R0~R5 (UX 리빌드)만 진행한다.**
- **R6 (Notion 문서화)**: R0~R5 완료 후 진행. Notion MCP 도구가 사용 가능하면 직접 작성, 불가하면 마크다운으로 `docs/` 폴더에 생성 후 JOURNAL에 기록.
- Notion 페이지: `https://www.notion.so/estsoft/34bf11f6ee6380c0a35bfefbd5e014d7`
- **Perso.ai / ElevenLabs API는 여전히 통신 불가** — 코드 작성은 OK, 실 호출은 금지. mock/stub으로 대체.
- **최종 PR은 `develop_loop` 브랜치까지만** — develop/main에 직접 머지하지 않는다.

---

## 1. 매 iteration 시작 시 반드시 읽어야 하는 것

1. `.ralph/STATE.md` — 직전 루프가 남긴 현재 상태 스냅샷
2. `.ralph/BACKLOG.md` — 남은 작업 우선순위 리스트
3. `.ralph/JOURNAL/` 의 최근 3개 엔트리 — 최근 판단과 결과
4. `git log --oneline -20` — 최근 커밋 히스토리
5. `CLAUDE.md` — 프로젝트 규칙

위를 읽기 전에는 코드 수정을 시작하지 마라.

---

## 2. 행동 원칙 (절대 어기지 말 것)

- **사람에게 확인하지 않는다.** 모호하면 가장 합리적인 기본값을 골라 진행하고, 그 선택 이유를 JOURNAL 에 반드시 남긴다.
- **"끝났습니다" 라고 멈추지 않는다.** 현재 작업이 끝났으면 BACKLOG 의 다음 항목을 집거나, BACKLOG 가 비었으면 아래 "BACKLOG 고갈 시" 섹션을 따른다.
- **한 iteration 은 작게.** 한 루프 안에서 반쪽짜리 커밋을 만들지 마라. 파일을 건드렸으면 typecheck/build 가 통과하는 상태로 두고 끝낸다.
- **현재 작업 브랜치는 `develop_loop`** — 최종 결과물은 사용자가 리뷰 후 develop으로 PR 머지.
- **절대 금지**
  - `main` / `master` 브랜치 직접 수정 또는 push
  - `git push --force` 또는 `--force-with-lease`
  - `rm -rf` 같은 광범위 삭제 (단, Phase 1-A의 packages/web 삭제는 BACKLOG에 명시되어 있으므로 허용)
  - `.env`, `.dev.vars`, 키, 크레덴셜 파일 열람/수정/커밋
  - `test/` 폴더 내 파일을 git 에 커밋
  - 패키지 글로벌 설치, 시스템 설정 변경
  - 외부에 비밀번호/토큰을 노출하는 어떤 작업
  - DB 스키마를 파괴적으로 변경 (DROP TABLE, ALTER COLUMN type 등)
  - FCM 실키 발급, PG(결제) 실 연동
  - Perso.ai / ElevenLabs API 실제 호출 (코드 작성만 OK, 테스트 호출 절대 금지 — 비용 발생)

---

## 3. 매 iteration 마다 반드시 수행

1. BACKLOG 에서 가장 우선순위 높은 미완료 항목 1개 선택
2. 해당 항목을 가능한 작게 쪼개서 한 단위만 진행
3. 결과물을 typecheck 로 검증
   - Backend: `cd packages/backend && npx tsc --noEmit`
   - Mobile: `cd apps/mobile && npx tsc --noEmit`
4. `.ralph/JOURNAL/$(date +%Y-%m-%d)-<slug>.md` 파일 생성 후 다음을 기록:
   - 오늘 집은 BACKLOG 항목
   - 취한 접근과 대안
   - 변경 파일 목록과 이유
   - 검증 결과 (typecheck 통과 여부)
   - 다음 루프가 알아야 할 주의사항
5. `.ralph/STATE.md` 갱신 (지금 어느 지점에 있는지 한 문단 요약)
6. `.ralph/BACKLOG.md` 갱신 (완료 항목은 `[x]`, 새로 발견한 일은 추가)

> harness 가 git commit + push 는 자동으로 해 준다. 당신은 코드/문서만 남기면 된다.

---

## 4. BACKLOG 가 비었을 때

"할 일이 없다"는 답은 **금지**다. 다음 중 하나를 골라 BACKLOG 에 새 항목을 채운 뒤 그 항목부터 진행한다.

- 백엔드 테스트 커버리지 확장 (character, family, billing, dub 라우트)
- 모바일 E2E 테스트 (Detox 또는 Maestro)
- 앱 접근성 강화 (스크린 리더, 고대비)
- 성능 프로파일링 + 최적화
- Sentry 에러 모니터링 연동
- 앱 아이콘 + 스플래시 스크린 디자인
- App Store / Google Play 스토어 등록 준비 (메타데이터, 스크린샷)
- TypeScript 엄격 모드 강화 (any 제거, 타입 보강)
- 문서화 (README, ARCHITECTURE, ADR)

---

## 5. 현재 핵심 목표 — UX 리빌드 (R0~R5)

> P0~P10은 완료됨. 아래는 사용자 피드백 기반 신규 기획.

이 순서대로 진행하라:

### 5-0. 탭 구조 변경 (R0)
하단 탭을 **4개로 고정**한다:
1. **홈** — 캐릭터 위젯 + 다음 알람 카운트다운 + 최근 활동
2. **음성** — 음성 프로필 관리 (녹음/업로드, 최대 2개)
3. **알람** — 알람 목록 + 생성/편집
4. **메시지 작성** — 다른 사람에게 보내기 (커플/가족 전용)

기존 `people`, `settings` 탭 삭제:
- **설정**: 우측 상단 프로필 아이콘 → 드롭다운 메뉴로 이동
- **알람 아이콘**: 프로필 옆에 배치 (알림 뱃지 표시)

### 5-1. 음성 관리 리빌드 (R1)
- 음성 프로필 **최대 2개** 제한 (백엔드 + 프론트 양쪽 검증)
- 등록 방법: **음성 녹음** / **파일 업로드** 선택 UI
- 각 프로필에 **삭제 버튼**
- 2개 등록 시 "추가" 버튼 비활성화 + 안내 메시지
- 가족/커플 플랜: 가족 멤버의 음성 프로필도 목록에 표시 (읽기 전용)

### 5-2. 알람 설정 리빌드 (R2)
- **목소리 없는 알람**이 기본 (알람 소리만)
- **음성 토글**: 비활성 = 알람소리만, 활성 = 음성 프로필 선택 UI 표시
  - 내 음성 프로필 (최대 2개)
  - 가족/커플이면 가족 멤버 음성도 표시
  - "더보기" 누르면 **기본 제공 음성 (프리셋)** 목록 노출
- **깨우기 방식**: 알람 소리로 먼저 깨운 후 → 선택한 목소리 재생 (옵션: 목소리로 직접 깨우기도 가능하나 알람소리가 기본)
- **알림 메시지**: 텍스트 직접 입력 가능 + 최근 사용 내역 표시
- **프리셋 메시지**: 카테고리 선택 → DB에서 불러와서 매일 랜덤 재생
- **음성 캐싱**: 한번 생성된 TTS 음성은 로컬 캐싱하여 재사용

### 5-3. 코드 등록 시스템 (R3)
기존 "받은 선물" → **"코드 등록"**으로 변경:
- 코드 입력 UI (텍스트 필드 + 등록 버튼)
- **이용권 코드**: 등록 시 사용 가능 일수 증가
- **가족/커플 코드**: 등록 시 해당 그룹에 초대됨
- 코드 유효성 검증: 만료/사용완료/존재하지 않음 에러 처리

### 5-4. 메시지 작성 (R4)
커플/가족 전용 탭:
- **알람 보내기**: 상대방에게 알람 예약 (시간 + 메시지)
- **쪽지 보내기**: 텍스트 입력 → TTS 음성으로 변환 → 상대방이 원할 때 재생
- 비커플/비가족 사용자: "가족 또는 커플 플랜에 가입하면 사용할 수 있어요" 안내
- 수신한 쪽지 목록 + 재생 UI

### 5-5. 설정 + 프로필 드롭다운 (R5)
- 우측 상단 프로필 아바타 아이콘 (Google 프로필 사진 또는 기본 아바타)
- 탭하면 **드롭다운 메뉴** 표시:
  - 내 프로필 (이름, 이메일)
  - 플랜 정보 (free/personal/family)
  - 코드 등록 (R3 화면으로 이동)
  - 언어 설정 (한국어/영어)
  - 다크모드 토글
  - 로그아웃
  - 계정 삭제
- 프로필 옆에 **알람 아이콘** (수신 알림 뱃지)

---

## 6. UX 리빌드 핵심 주의사항

- **탭 4개 엄수**: 홈 / 음성 / 알람 / 메시지작성. 그 외는 스택 화면 또는 드롭다운.
- **음성 2개 제한**: `voice_profiles` 테이블에서 `user_id` 기준 COUNT 검증. 프론트+백엔드 모두 체크.
- **알람 = 소리 우선**: 알람 트리거 시 시스템 알람 소리 → 3초 후 음성 재생. 음성 전용 모드는 옵션.
- **쪽지 vs 알람**: 알람은 시간 지정 + 강제 알림, 쪽지는 비동기 메시지 (푸시만, 강제 소리 없음).
- **프리셋 메시지**: `messages` 테이블에서 `is_preset=true` + `category` 필터로 랜덤 1개 선택.
- **코드 등록**: 기존 `gifts` 테이블 + `billing` 로직 재활용. 코드 타입 판별 → 이용권 or 초대 분기.
- **settings 탭 삭제**: `app/(tabs)/settings.tsx` 삭제, `app/(tabs)/people.tsx` 삭제. 프로필 드롭다운은 `_layout.tsx`의 헤더에 구현.

---

## 7. 테스트 방법

- `test/` 폴더에 사용자가 음성 파일(MP3/WAV)을 미리 넣어두었다.
- 이 파일들로 음성 클론 → TTS → 재생까지 통합 테스트 시나리오를 작성하라.
- 테스트 스크립트는 `packages/backend/test/` 또는 `apps/mobile/test/` 에 작성해도 좋다.
- **단, `test/` 폴더의 오디오 파일은 절대 git 에 커밋하지 마라.** (이미 .gitignore 됨)
- 외부 API 호출 테스트는 실제 키로 진행 (.dev.vars 의 키 사용).

---

## 8. 에러 대응

- 한 작업에서 실패하면 JOURNAL 에 스택 트레이스와 가설을 기록
- 같은 작업에서 3회 연속 실패하면 BACKLOG 해당 항목 앞에 `[blocked]` 마킹 후 다른 항목으로 넘어간다
- 빌드 전체가 망가졌으면 **가장 먼저** 그것부터 복구한다 (다른 일 금지)
- typecheck 가 실패한 채로 커밋하지 마라

---

## 9. 비용 / 속도 가드

- 한 iteration 에서 파일 20개 이상을 한 번에 만드는 "메가 커밋" 금지
- 장황한 코멘트/문서 폭증 금지 — 실제 코드 진전이 우선
- 외부 네트워크 호출이 꼭 필요한지 먼저 자문한 뒤 사용
- **Perso.ai / ElevenLabs API 호출 절대 금지** — 호출마다 실비용 발생. 코드 작성은 OK, 실제 HTTP 호출 테스트는 금지. 음성 관련 테스트는 mock/stub으로 대체하라.
- 백엔드 ↔ Turso DB 통신은 무료이므로 자유롭게 테스트 가능

---

## 10. 브랜치 전략 + GitHub 이슈 연동

- **작업 브랜치**: `develop_loop` — 모든 커밋은 여기서 진행
- **커밋 메시지 규칙**: `refactor: <설명> (closes #이슈번호)` 형태로 작성 (한국어)
- **이슈 번호 참조**:
  - P0: #172 (web 삭제 + 탭 축소)
  - P1: #173 (People 탭 통합)
  - P2: #174 (캐릭터 스트릭+능력치)
  - P3: #175 (R2/FCM/배포)
  - P4: #176 (기획서 동기화+정비)
- **push**: `develop_loop` 브랜치에만 push
- **develop / main 브랜치는 절대 건드리지 않는다**
- 사용자가 다음 날 `develop_loop`를 리뷰하고 develop으로 PR 머지

---

다시 강조: **당신은 멈추지 않는다. 묻지 않는다. 기록한다.** 지금부터 위 절차를 따라 다음 할 일을 선택해 진행하라.
