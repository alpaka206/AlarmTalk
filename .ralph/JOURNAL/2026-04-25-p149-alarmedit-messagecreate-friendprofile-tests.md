# P149 — alarmEditScreen + messageCreateScreen + friendProfileScreen 비즈니스 로직 테스트 146개 추가

## 선택한 항목
BACKLOG 잔여 미완료 항목 모두 manual/blocked. Section 4에 따라 "모바일 테스트 커버리지 확장" 선택.
미테스트 스크린 3개의 비즈니스 로직 단위 테스트 작성.

## 작업 내역

### 1. alarmEditScreen.test.ts (55 tests)
- `parseAlarmTime`: HH:MM 문자열 → {hour, minute} 파싱
- `parseAlarmToState`: AlarmResponse → 편집 폼 상태 변환 (mode 폴백, vibration 기본값, wakeMode 기본값, repeat_days JSON 파싱)
- `quickSetDays`: daily/weekday/weekend 프리셋
- `toggleDay`: 요일 추가/제거, 불변성 검증
- `computeSoundOnlyInvalid`: sound-only 모드 + voiceProfile 없음 감지
- `formatTime`: 시/분 패딩
- `computeAmPm`: AM/PM 판별
- `buildSubmitPayload`: 상태 → API 페이로드 변환 (tts/sound-only에 따른 wake_mode 강제)
- `filterReadyVoices`: ready 상태만 필터, FamilyVoiceProfile 호환
- `isSubmitDisabled`: 제출 버튼 비활성 조건 조합
- 전체 라운드트립: alarm → state → submit 의미 보존 검증

### 2. messageCreateScreen.test.ts (56 tests)
- `filterReadyProfiles`: ready 상태만 필터
- `deriveMessageText`: preset/custom 탭별 메시지 도출
- `validateGenerate`: voiceId/messageText 유효성 (우선순위 검증)
- `buildTTSPayload`: 카테고리 기본값, 텍스트 trim
- `isGenerateDisabled`: 생성 버튼 비활성 조건
- `enforceCustomTextLimit`: 200자 제한 강제
- `getAvatarInitial`: 프로필 이니셜 추출 (한국어 포함)
- `findCategoryByKey`: 카테고리 검색 (null/undefined 대응)
- 선물 수신자 헬퍼: label/initial 도출, 이름→이메일→? 폴백
- `enforceGiftNoteLimit`: 200자 제한
- `buildGiftPayload`: 빈 노트 → undefined 변환
- 탭 전환/재생 토글/voice_id 파라미터/친구 목록 가드 로직

### 3. friendProfileScreen.test.ts (35 tests)
- `findFriendById`: 검색/미검색/빈 리스트
- `computeFriendName`: name→email→빈문자열 폴백
- `computeInitial`: 영문/한국어/이메일/빈문자열 대문자 변환
- `filterGiftsToFriend`: user_a/user_b 양방향 매칭
- `filterGiftsFromFriend`: sender_email 매칭 (대소문자 민감)
- `filterAlarmsForFriend`: target_user_id ≠ user_id 필터 (null 제외)
- `statusText`: pending/accepted/rejected/unknown 분기
- `sliceRecent`: 최근 N개 슬라이싱
- `formatSinceDate`: ISO/단순 날짜 문자열 파싱
- 통합 흐름: 프로필 데이터 전체 도출 (이름, 이니셜, 선물 통계)
- 선물 statusText 매핑 검증

## 변경 파일 (3개, 모두 신규)
1. `apps/mobile/test/alarmEditScreen.test.ts`
2. `apps/mobile/test/messageCreateScreen.test.ts`
3. `apps/mobile/test/friendProfileScreen.test.ts`

## 검증
- 신규 테스트: 146/146 통과
- 전체 mobile 테스트: 1760/1760 통과 (1614 → 1760, +146)
- typecheck: backend 0 errors, mobile 0 errors

## 다음 루프 참고
- 미테스트 스크린 10개 남음: dub/translate, gift/received, message/[id], note/[id], onboarding, voice/[id], voice/upload, voice/picker, voice/diarize, family-alarm/create
- gift/received는 optimistic mutation 패턴 포함 — 추출 가능
- message/[id]는 playback toggle + cache check 로직 있음
- voice 관련 (diarize, upload) 은 외부 API 의존도 높아 mock 필요
