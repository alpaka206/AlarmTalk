# P150 — 미테스트 스크린 5개 비즈니스 로직 테스트 130개 추가

## 선택한 항목
BACKLOG 잔여 미완료 항목은 모두 blocked/manual (Sentry DSN, wrangler deploy, 렌더링 확인).
Section 4에 따라 "모바일 테스트 커버리지 확장" 선택.
미테스트 스크린 11개 중 비즈니스 로직이 가장 풍부한 5개를 선택.

## 작업 내역

### 1. onboardingScreen.test.ts (38 tests)
- 페이지 네비게이션: isLastPage, getNextIndex, shouldFinishOnboarding
- 버튼 라벨 전환 (다음/시작하기)
- 페이지 콘텐츠: 이모지, 배경색 배정
- 스크롤 인덱스 해석: resolveIndexFromScroll (반올림)
- 인디케이터 애니메이션: dot width/opacity interpolation
- 상수 일관성: TOTAL_PAGES === PAGE_EMOJIS.length

### 2. noteCreateScreen.test.ts (30 tests)
- filterRecipients: 자신 제외, 빈 배열, 자신만 존재
- canSend 유효성: 수신자/텍스트/pending 조합 6케이스
- 텍스트 검증: 빈 문자열, 공백만, MAX_TEXT_LENGTH 경계
- getDisplayName: 이름/이메일/? 폴백 체인
- getInitial: 대문자 변환
- shouldEnableQuery: 인증+네트워크 조합
- getCharCount: 문자 수/500 포맷

### 3. noteDetailScreen.test.ts (22 tests)
- findNoteById: 정상/미존재/undefined 배열/undefined ID/빈 배열
- getSenderDisplay: 이름/이메일/빈 문자열 폴백
- getSenderInitial: 영문/한국어 대문자
- shouldMarkAsRead: 미읽음/읽음/undefined
- hasAudio: URL/null/빈 문자열
- formatDateParts: ISO/invalid/date-only

### 4. giftReceivedScreen.test.ts (24 tests)
- statusLabel: accepted/rejected/pending/unknown
- 상태 체크: isPending, isAccepted, isRejected
- UI 노출: shouldShowActions (pending만), shouldShowSetAlarm (accepted만)
- hasNote: 문자열/null/빈 문자열
- getSenderDisplay: 이름/null/빈 문자열 → '알 수 없음'
- 낙관적 업데이트: accept/reject 적용, 다른 항목 불변, 미존재 ID
- countByStatus: 상태별 집계, 빈 배열, 동일 상태

### 5. messageDetailScreen.test.ts (16 tests)
- findMessageById: 정상/미존재/undefined/빈 배열
- hasVoice: 이름/null/빈 문자열
- getVoiceInitial: 영문/null/한국어
- getCategoryDisplay: toUpperCase 변환
- 캐시 의존 버튼: play/translate (true/false/null)
- 라우트 빌더: alarm/translate/createAnother/voiceDetail + null ID
- getPlaybackLabel: 재생/정지 전환

## 변경 파일 (5개, 모두 신규)
1. `apps/mobile/test/onboardingScreen.test.ts`
2. `apps/mobile/test/noteCreateScreen.test.ts`
3. `apps/mobile/test/noteDetailScreen.test.ts`
4. `apps/mobile/test/giftReceivedScreen.test.ts`
5. `apps/mobile/test/messageDetailScreen.test.ts`

## 검증
- 신규 테스트: 130/130 통과
- 전체 테스트: 1890/1890 통과 (1760 → 1890, +130)
- typecheck: backend 0 errors, mobile 0 errors

## 미테스트 스크린 잔여 (6개)
- dub/translate.tsx — 소스/타겟 언어 검증, 폴링, 재생
- family-alarm/create.tsx — familyAlarmForm 라이브러리 이미 테스트됨, 화면 고유 로직 소량
- voice/upload.tsx — 파일 선택 + mutation, 로직 소량
- voice/[id].tsx — 음성 상세 조회
- voice/diarize.tsx — 화자 분리 결과 표시
- voice/picker.tsx — speakerPickerState 이미 별도 테스트됨, 화면 고유 로직 소량

## 다음 루프 참고
- 잔여 6개 스크린 중 dub/translate가 가장 비즈니스 로직 밀도 높음 (언어 선택, 폴링, 캐시 저장)
- voice/picker는 speakerPickerState.test.ts에서 reducer 이미 테스트됨 → 추가 가치 낮음
- family-alarm/create, voice/upload은 로직이 외부 라이브러리에 위임되어 있어 추가 가치 낮음
