# P1: 컴포넌트 추출 + 초대코드 발급 UI

## 집은 항목
BACKLOG P1 — 컴포넌트 추출 (FamilyMemberRow, PeopleSkeletonCard) + 초대코드 발급 UI + 초대코드 i18n 키 추가

## 접근
P1 마무리 항목 3개를 하나의 iteration에서 완료. 모두 people.tsx 관련이므로 한 번에 처리하는 것이 효율적.

### 주요 결정
- **FamilyMemberRow**: renderMember 인라인 함수를 독립 컴포넌트로 추출. 스타일도 함께 이동. Props로 `member: FamilyGroupMember`와 `isCouple?: boolean` 전달.
- **PeopleSkeletonCard**: 기존에는 ActivityIndicator만 사용 중이었으나, 디자인 가이드라인에서 SkeletonCard 사용을 명시하고 있으므로 pulse 애니메이션 기반 skeleton 컴포넌트를 새로 생성. `useNativeDriver: true` 사용.
- **초대코드 UI**: 백엔드 API (`POST /family/invites`, `GET /family/invites`, `POST /family/invites/:code/revoke`)가 이미 구현되어 있으므로 모바일 API 함수 3개 추가 후 멤버 세그먼트 footer에 UI 배치. owner만 초대코드 발급 가능.
- **expo-clipboard**: 초대코드 복사에 필요하므로 설치. Share API와 함께 사용하여 공유/복사 기능 제공.
- **커플 뷰**: P1의 마지막 남은 항목이나, 현재 border 강조로 최소한의 구분이 됨. P5 UI 폴리시로 이동이 합리적.

## 변경 파일 목록

### 신규
- `apps/mobile/src/components/FamilyMemberRow.tsx` — people.tsx의 renderMember를 독립 컴포넌트로 추출.
- `apps/mobile/src/components/PeopleSkeletonCard.tsx` — pulse 애니메이션 skeleton 카드 (personCard 레이아웃 미러링).

### 수정
- `apps/mobile/app/(tabs)/people.tsx` — FamilyMemberRow/PeopleSkeletonCard 사용, 초대코드 발급/공유/취소 UI 추가, 미사용 import/스타일 제거.
- `apps/mobile/src/services/api.ts` — `FamilyInvite` 타입 + `createFamilyInvite`, `getFamilyInvites`, `revokeFamilyInvite` 함수 추가.
- `apps/mobile/src/i18n/ko.json` — `people.inviteCode` 외 11개 초대 관련 키 추가.
- `apps/mobile/src/i18n/en.json` — 동일 11개 키 영어 추가.

### 의존성 추가
- `expo-clipboard` (SDK 54 호환)

## 검증 결과
- `npx tsc --noEmit` (mobile) — 통과

## 다음 루프 주의사항
- **커플 뷰 개선**은 P5 UI 폴리시로 이동 권장. 현재 border 강조로 충분한 수준.
- P1이 거의 완료. BACKLOG에서 커플 뷰 항목을 P5로 이동하고, P2 (캐릭터 스트릭+능력치)로 전환.
- **P2 첫 단계**: `packages/backend/src/lib/migrations.ts`에 마이그레이션 13 추가 (characters 테이블 스트릭 컬럼 + character_stats + streak_achievements 테이블).
