# P154 — 홈 화면 최근 활동 피드 통합

## 선택한 항목
BACKLOG 잔여 미완료 항목 모두 manual/blocked. Section 4에 따라 신규 기능 작업.
R0 명세에 "최근 활동"이 홈 화면 필수 섹션으로 정의되어 있으나 미구현 상태 발견.
P153에서 backend activity endpoint를 detail 구조체로 리팩토링했으므로, 모바일에서 소비하는 작업이 자연스러운 다음 단계.

## 작업 내역

### 1. API 서비스 함수 추가
- `src/services/api/user.ts`: `ActivityItem` 타입 (discriminated union) + `getActivity()` 함수 추가
  - 4가지 타입별 detail 구조체 정의 (alarm/message/gift/voice)
  - `GET /stats/activity` 호출 → activities 배열 반환
- `src/services/api/index.ts`: `getActivity` + `ActivityItem` export 추가

### 2. 비즈니스 로직 헬퍼 추출
- `src/lib/activityHelpers.ts` 신규:
  - `activityEmoji(type)` — 타입별 이모지 매핑
  - `activityTypeLabel(type, t)` — i18n 타입 라벨
  - `activityDescription(item, t)` — 타입별 설명 문자열 포맷팅
  - gift의 note 유무에 따라 다른 i18n 키 사용

### 3. i18n 키 추가 (ko/en)
- `home.recentActivity` / `home.noActivity`
- `home.activityAlarm` / `home.activityMessage` / `home.activityGift` / `home.activityGiftNote` / `home.activityVoice`
- `home.activityTypeAlarm` / `home.activityTypeMessage` / `home.activityTypeGift` / `home.activityTypeVoice`
- 총 12개 키 (ko + en 각각)

### 4. 홈 화면 UI 통합
- `app/(tabs)/index.tsx`:
  - `getActivity` import + `useQuery(['activity'])` 추가
  - "최근 메시지" 섹션과 "빠른 액션" 사이에 "최근 활동" 섹션 삽입
  - 최대 5개 활동 표시 (이모지 + 타입 라벨 + 설명 + 상대 시간)
  - `formatLastSeen` 재활용으로 상대 시간 표시
  - 빈 상태 UI 처리
  - pull-to-refresh에 `refetchStats` 추가

### 5. 스타일 추가
- `src/styles/homeStyles.ts`: activitySection, activityItem, activityEmoji, activityContent, activityTypeLabel, activityDesc, activityTime, activityEmpty, activityEmptyText 9개 스타일 추가

### 6. 테스트
- `test/apiUser.test.ts`: `getActivity` 테스트 1개 추가
- `test/activityHelpers.test.ts`: 신규 9개 테스트
  - activityEmoji: 4개 타입
  - activityTypeLabel: 4개 타입
  - activityDescription: alarm/message/gift(null)/gift(note)/voice 5개

## 변경 파일 (9개)
1. `apps/mobile/src/services/api/user.ts` — ActivityItem 타입 + getActivity 함수
2. `apps/mobile/src/services/api/index.ts` — export 추가
3. `apps/mobile/src/lib/activityHelpers.ts` — 신규, 순수 헬퍼 3개
4. `apps/mobile/src/i18n/ko.json` — activity 관련 12개 키
5. `apps/mobile/src/i18n/en.json` — activity 관련 12개 키
6. `apps/mobile/app/(tabs)/index.tsx` — 최근 활동 섹션 + useQuery
7. `apps/mobile/src/styles/homeStyles.ts` — activity 스타일 9개
8. `apps/mobile/test/apiUser.test.ts` — getActivity 테스트 1개
9. `apps/mobile/test/activityHelpers.test.ts` — 신규, 9개 테스트

## 검증
- Backend typecheck: 0 errors ✅
- Mobile typecheck: 0 errors ✅
- apiUser tests: 22/22 passed ✅
- activityHelpers tests: 9/9 passed ✅
- i18n tests: 14/14 passed ✅

## 다음 루프 참고
- 활동 피드에 터치 네비게이션 미구현 (각 아이템 탭 시 해당 상세 화면으로 이동 — 추후 개선 가능)
- 활동 데이터 오프라인 캐싱 미구현 (pull-to-refresh 시 온라인에서만 갱신)
- 전체 활동 히스토리 화면 미구현 (현재는 홈에서 5개만 표시)
