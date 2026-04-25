# P146 — Character/CodeRegister 스크린 단위 테스트 + typecheck 수정

## 선택한 항목
BACKLOG 잔여 미완료 항목 모두 manual/blocked. Section 4에 따라 "모바일 테스트 커버리지 확장" 선택.
P145 저널 추천에 따라 character/index.tsx와 code-register/index.tsx의 비즈니스 로직 테스트 작성.

## 작업 내역

### 1. characterScreen.test.ts (47 tests)
- `statBarPct`: normal/cap/zero/divByZero/fractional/large 값
- `milestoneEmoji`: 7→🌱, 30→🌳, 90→🌸, fallback
- `statBarMax`: min floor 10, single dominant, equal values
- `buildAchievedSet`: empty/dedup/full/partial
- `DEV_EVENTS`: 구조 검증 (3개, event/labelKey 필드)
- `MILESTONES`: [7,30,90] 정렬 검증
- StatBar+statBarMax 통합: proportion 비율 정합성
- MilestoneBadge+achievedSet 통합: 렌더 상태 검증

### 2. codeRegisterScreen.test.ts (42 tests)
- `VOUCHER_RE`: valid/invalid 12 케이스 (prefix, segment length, special chars)
- `INVITE_RE`: valid/invalid 9 케이스 (길이, alpha, 공백)
- `detectCodeType`: voucher(4) + invite(3) + null(7) + priority(1)
- Error extraction: ApiError 9 케이스 (responseData 유무, null, non-ApiError, string)
- Button disabled: 5 케이스 (empty, whitespace, pending)
- Success message branching: voucher/invite 분기

### 3. 기존 typecheck 오류 수정 (2 files)
- `homeScreen.test.ts:423`: TS2367 — string literal 비교를 `string` 타입 변수로 변경
- `settingsScreen.test.ts:158,163`: TS2871/TS2869 — `undefined ?? '1.0.0'`에서 `string | undefined` 타입 변수 사용

## 변경 파일 (4개)
1. `apps/mobile/test/characterScreen.test.ts` — 신규 (47 tests)
2. `apps/mobile/test/codeRegisterScreen.test.ts` — 신규 (42 tests)
3. `apps/mobile/test/homeScreen.test.ts` — typecheck 수정 (1줄)
4. `apps/mobile/test/settingsScreen.test.ts` — typecheck 수정 (4줄)

## 검증
- 신규 테스트: 89/89 통과
- 전체 Mobile 테스트: 1339/1339 통과 (1250 → 1339, +89)
- typecheck: backend 0 errors, mobile 0 errors

## 다음 루프 참고
- 스크린 테스트 커버리지: 8/28 → 10/28 (36%)
- 나머지 미테스트 스크린 후보 (비즈니스 로직 밀도 높은 순):
  - people/index.tsx (세그먼트 컨트롤, 플랜별 분기, avatar initial)
  - voice/* (녹음/업로드/화자분리/선택)
  - alarm/create.tsx + alarm/edit.tsx (폼 로직)
  - note/create.tsx (메시지 작성)
