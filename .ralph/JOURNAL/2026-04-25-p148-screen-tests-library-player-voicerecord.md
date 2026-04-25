# P148 — libraryScreen + playerScreen + voiceRecordScreen 비즈니스 로직 테스트 165개 추가

## 선택한 항목
BACKLOG 잔여 미완료 항목 모두 manual/blocked. Section 4에 따라 "모바일 테스트 커버리지 확장" 선택.
미테스트 스크린 3개의 비즈니스 로직 단위 테스트 작성.

## 작업 내역

### 1. libraryScreen.test.ts (55 tests)
- `CATEGORIES` 상수 검증 (길이, 유일성, emoji 존재)
- `getCategoryLabel`: 알려진/미알려진 카테고리 i18n 키 매핑
- `filterByCategory`: all/specific/no-match/null/empty 입력 처리
- `sortItems`: favorites 우선 → received_at 내림차순, 불변성, 빈 배열/단일 항목
- `computeDisplayItems`: 온라인/오프라인/캐시/카테고리 필터 조합 7케이스
- `isShowingCached`: 온라인/오프라인/캐시 유무/필터 타입 조합 7케이스
- 빈 상태 로직: all vs favorite 메시지 키, CTA 표시 분기
- 쿼리 설정: filter→param 매핑, enabled 조건 (authenticated × connected)

### 2. playerScreen.test.ts (72 tests)
- `generateWaveform`: 결정론성, seed별 차이, 범위 [0.15, 1.0], 빈/단일 바
- `formatTime`: 0ms, 초, 분:초, 패딩, 큰 값, 절삭
- `getBackgroundColor`: 카테고리별 색상, 폴백
- `getEmoji`: 카테고리별 이모지, 폴백
- `seekClamp/seekProgress/seekPositionMs`: 경계값 클램핑, 진행률 계산
- `processPlaybackStatus`: 로드/비로드, seeking 중 위치 업데이트 스킵, 재생 완료 감지, 0/undefined 지속시간
- `computeActiveBarIndex`: 진행률→바 인덱스 매핑
- `isNearPlayhead`: 펄스 범위 내/외 판별
- 상태 전이: play/pause, 끝에서 재시작, 반응 토글, 닫기 정리
- params 파싱: messageId/voiceName 기본값 처리

### 3. voiceRecordScreen.test.ts (38 tests)
- `dbToNormalized`: -60→0, 0→1, 중간값, 클램핑, 소수점
- `formatRecordTime`: 0~600초 범위 포맷
- `validateSubmit`: null URI, 빈 이름, 공백 이름, 짧은 녹음, 최소 통과, 우선순위 검증
- `updateLevelHistory`: 시프트+추가, maxSize 유지, 빈/단일 히스토리
- `initLevelHistory`: 크기별 0 초기화
- `computeBarHeight`: 최소 3px, 비례 높이
- `computeBarColor`: 레벨 임계값별 색상 (primary/light/border), 경계값 테스트
- 녹음 상태 머신: 초기→녹음→정지→결과
- 권한 상태: null/false/true 분기
- 제출 버튼 비활성 상태

## 변경 파일 (3개, 모두 신규)
1. `apps/mobile/test/libraryScreen.test.ts`
2. `apps/mobile/test/playerScreen.test.ts`
3. `apps/mobile/test/voiceRecordScreen.test.ts`

## 검증
- 신규 테스트: 165/165 통과
- 전체 mobile 테스트: 1614/1614 통과 (1449 → 1614, +165)
- typecheck: backend 0 errors, mobile 0 errors

## 다음 루프 참고
- 미테스트 스크린 15개 남음: alarm/edit, dub/translate, family-alarm/create, friend/[id], gift/received, message/create, message/[id], note/[id], onboarding, voice/diarize, voice/picker, voice/record, voice/upload, voice/[id], _layout
- onboarding은 비즈니스 로직이 적어 우선순위 낮음
- alarm/edit는 alarm/create와 로직 공유 (alarmForm.ts) — validateAlarmForm 이미 테스트됨
- voice 관련 스크린 (diarize, upload)은 외부 API 의존도 높아 mock 필요
