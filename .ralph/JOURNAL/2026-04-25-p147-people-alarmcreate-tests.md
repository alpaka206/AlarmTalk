# P147 — People/AlarmCreate 스크린 비즈니스 로직 테스트

## 선택한 항목
BACKLOG 잔여 미완료 항목 모두 manual/blocked. Section 4에 따라 "모바일 테스트 커버리지 확장" 선택.
P146 저널 추천에 따라 people/index.tsx와 alarm/create.tsx + edit.tsx의 비즈니스 로직 테스트 작성.

## 작업 내역

### 1. peopleScreen.test.ts (62 tests)
- `avatarInitial`: name/email/null/undefined/empty/Korean/emoji(surrogate) 10개
- `buildSegments`: family/non-family plan, pending count, translation keys 6개
- `defaultSegment`: family→members, other→friends 2개
- `sortMembersOwnerFirst`: owner-first/no-owner/empty/single/immutability/multi-owner 7개
- `filterPendingInvites`: status filtering, empty, all-pending, id preservation 5개
- `isCouple`: familyPlan + memberCount combinations 6개
- `badgeText`: count>0/0/undefined append 6개
- `friendDisplayLabel`: name/email-prefix/null/undefined/edge cases 8개

### 2. alarmCreateScreen.test.ts (48 tests)
- `quickSetDays`: daily/weekday/weekend + length checks 6개
- `toggleDay`: add/remove/immutability/roundtrip/all-7 7개
- `soundOnlyInvalid`: mode + voiceProfileId 5 combinations 5개
- `amPm`: boundary values (0/6/11/12/18/23) 6개
- `formatTimeString`: padding, midnight, 23:59, double-digit 5개
- `hourUp/hourDown`: increment/wrap/decrement 6개
- `minuteUp/minuteDown`: 5-step increment/wrap 6개
- `filterReadyVoices`: ready/undefined/none/all/empty 5개
- `isSubmitDisabled`: messageId/soundOnlyInvalid/isPending combinations 5개
- `extractFriendId`: user_a/user_b match, neither-match fallback 3개
- `findCachedMessage`: exact/no-match/voice+text/empty/dupes/case-sensitive 6개

## 변경 파일 (2개)
1. `apps/mobile/test/peopleScreen.test.ts` — 신규 (62 tests)
2. `apps/mobile/test/alarmCreateScreen.test.ts` — 신규 (48 tests)

## 검증
- 신규 테스트: 110/110 통과
- 전체 Mobile 테스트: 1449/1449 통과 (1339 → 1449, +110)
- typecheck: backend 0 errors, mobile 0 errors

## 다음 루프 참고
- 스크린 테스트 커버리지: 10/28 → 12/28 (43%)
- 나머지 미테스트 스크린 후보 (비즈니스 로직 밀도 높은 순):
  - voice/record.tsx (녹음 상태머신, 타이머, 파일 처리)
  - voice/upload.tsx (파일 선택, 유효성 검증)
  - voice/diarize.tsx (화자 분리 상태)
  - note/create.tsx (메시지 작성 폼)
  - message/create.tsx (쪽지 작성)
  - family-alarm/create.tsx (가족 알람 예약 폼)
