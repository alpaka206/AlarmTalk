# P104 — 모바일 API 서비스 모듈 테스트 79건 추가

## 선택한 항목
BACKLOG 잔여 미완료 항목 모두 manual/blocked. Section 4에 따라 "모바일 테스트 커버리지 확장" 선택.
모바일 API 서비스 모듈 7개(`social.ts`, `user.ts`, `billing.ts`, `alarm.ts`, `family.ts`, `character.ts`, `voice.ts`)가 전용 테스트 없음을 발견 → 테스트 작성.

## 판단 기록
- `apiCore.test.ts`는 `core.ts`의 `request/get/post/patch/del` 함수만 테스트 — 각 도메인 API 모듈은 미테스트
- API 서비스 모듈은 올바른 엔드포인트, 파라미터, 응답 추출을 검증해야 함
- `core.ts`를 `jest.mock`하여 각 함수가 올바른 path/body/params로 호출되는지 검증
- `voice.ts`의 `normalizeSpeakerSegment`는 필드 매핑 로직이 있어 순수 함수 테스트도 포함

## 작업 내역

### 1. apiSocial.test.ts (18 tests)
- Friend API: sendFriendRequest, getFriendList, getPendingRequests, acceptFriendRequest, deleteFriend
- Gift API: sendGift (with/without note), getReceivedGifts, getSentGifts, acceptGift, rejectGift
- Notes API: sendNote, getReceivedNotes (기본값/커스텀), getSentNotes (기본값/커스텀), markNoteRead

### 2. apiUser.test.ts (12 tests)
- User API: getUserProfile, updatePlan (plus/family), deleteAccount
- Stats API: getStats, searchUsers
- Library API: getLibrary (필터 없음/있음), toggleFavorite (true/false), deleteLibraryItem

### 3. apiBilling.test.ts (5 tests)
- Voucher API: getVouchers (데이터/빈 배열)
- Code Registration: registerCode — voucher result, invite result

### 4. apiAlarm.test.ts (10 tests)
- Alarm API: getAlarms, getAlarm, createAlarm (최소/전체 파라미터), updateAlarm (시간/모드), deleteAlarm
- Push Token API: registerPushToken (android/ios), unregisterPushToken

### 5. apiFamily.test.ts (10 tests)
- Family Group: getFamilyGroupCurrent (가족 플랜/비가족)
- Family Alarm: createFamilyAlarmText (전체/최소 파라미터)
- Family Invites: createFamilyInvite, getFamilyInvites, revokeFamilyInvite

### 6. apiCharacter.test.ts (6 tests)
- getCharacterMe: 전체 응답 구조 검증
- grantCharacterXp: 이벤트만/전체 파라미터/중복 감지/마일스톤/일일 캡

### 7. apiVoice.test.ts (24 tests)
- Voice Profile: getVoiceProfiles, getVoiceProfile, createVoiceClone (FormData), diarizeAudio (FormData), deleteVoiceProfile, getFamilyVoiceProfiles, updateVoiceProfile
- Upload + Speaker: uploadVoiceAudio (with/without duration), separateUpload (정규화/기본값), listSpeakers, renameSpeaker
- TTS: generateTTS (기본/카테고리), getMessages (필터 없음/있음), getMessagesByVoice, getPresets
- Dub: getDubLanguages, startDub (기본/sourceMessageId), getDubStatus, getDubJobs

## 변경 파일 (7개, 모두 신규)
1. `apps/mobile/test/apiSocial.test.ts`
2. `apps/mobile/test/apiUser.test.ts`
3. `apps/mobile/test/apiBilling.test.ts`
4. `apps/mobile/test/apiAlarm.test.ts`
5. `apps/mobile/test/apiFamily.test.ts`
6. `apps/mobile/test/apiCharacter.test.ts`
7. `apps/mobile/test/apiVoice.test.ts`

## 검증
- 신규 테스트: 79/79 통과 (7 파일 × 7 suite)
- 전체 모바일 테스트: 743/743 통과 (664 → 743, +79)
- typecheck: mobile 0 errors, backend 0 errors

## 다음 루프 참고
- API 서비스 모듈 7개 전체 테스트 커버리지 확보 완료
- 남은 미테스트 영역: 컴포넌트 (NotificationBell, CoupleView, MiniWaveformPlayer 등), hooks
- 컴포넌트 테스트는 react-testing-library 셋업 필요 — 별도 iteration 추천
