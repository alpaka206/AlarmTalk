# P41 — 화면 인터랙션 로직 테스트

## BACKLOG 항목
자가 생성 풀: "모바일 화면 컴포넌트 인터랙션 테스트 (voices add menu, alarm create form 등)"

## 접근
기존 테스트 인프라는 컴포넌트 렌더링 없이 순수 로직 테스트 패턴을 사용.
@testing-library/react-native를 추가하지 않고, 3개 핵심 화면(voices, compose, alarm/create)의
비즈니스 로직을 추출하여 순수 함수로 테스트.

### 테스트 범위
1. **Voice profile management** (20 tests)
   - 2개 프로필 제한 로직 (isLimitReached)
   - 서버/캐시 프로필 폴백 (getDisplayProfiles)
   - 상태 뱃지 매핑 (getStatusBadge)
   - 플랜 판별 (isFamilyPlan)
   - ready 음성 필터링 (filterReadyVoices)

2. **Alarm create interaction** (18 tests)
   - 반복요일 토글 (toggleDay)
   - 빠른 요일 설정 (quickSetDays: daily/weekday/weekend)
   - sound-only 모드 유효성 (isSoundOnlyInvalid)
   - 깨우기 방식 표시 조건 (shouldShowWakeMode)
   - AM/PM 판별 (getAmPm)
   - 캐시된 메시지 탐색 (findCachedMessage)

3. **Compose screen gating** (16 tests)
   - 인증/플랜 기반 화면 상태 (getComposeScreenState)
   - 미읽음 카운트 (computeUnreadCount)
   - 읽음 표시 판단 (shouldMarkRead)

## 변경 파일
- `apps/mobile/test/screenInteraction.test.ts` (신규, 54 tests)

## 검증 결과
- typecheck: backend + mobile 0 errors
- 테스트: backend 653/653, mobile 449/449 (이전 395 + P41 54)

## 다음 루프 주의사항
- 자가 생성 풀 잔여: 백엔드 API 벤치마크, 모바일 번들 사이즈 모니터링
- 이 두 항목은 외부 의존성(expo export, 실 API 호출)이 필요하여 무인 모드에서 제한적
