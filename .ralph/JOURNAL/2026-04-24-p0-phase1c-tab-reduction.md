# P0 Phase 1-C: 탭 8→5 축소

## 집은 항목
BACKLOG P0 Phase 1-C: 모바일 탭 축소 (8개 → 5개)

## 접근
탭 구조를 8개(Home/Voices/Alarms/Friends/Family/Character/Library/Settings)에서 5개(Home/Voices/Alarms/People/Settings)로 축소.

### 대안 검토
- **character/library를 탭에 남기고 숨김 처리**: Expo Router에서 탭 숨김은 `href: null`로 가능하나, 사용자가 탭바에 표시되지 않는 화면에 접근하기 어려움. 스택 화면으로 이동이 더 자연스러움. 기각.
- **people.tsx에 friends+family 전체 로직 병합**: P1에서 세그먼트 컨트롤 + 플랜별 분기를 구현할 예정이므로, 이번 루프에서는 기본 친구 목록 + 요청 관리만 포함한 간결한 구현. 채택.
- **홈 위젯 없이 진행**: BACKLOG에 명시적으로 캐릭터 위젯 + 최근 메시지 포함되어 있으므로 이번 루프에서 함께 구현. 채택.

## 변경 파일 목록

### 신규
- `apps/mobile/app/character/index.tsx` — character 탭 → 스택 화면. 인라인 헤더 제거, Stack header 사용.
- `apps/mobile/app/library/index.tsx` — library 탭 → 스택 화면. 인라인 헤더 제거, Stack header 사용.
- `apps/mobile/app/(tabs)/people.tsx` — 새 "내 사람들" 탭. 친구 목록 + 요청 관리 + 이메일 친구 추가. P1에서 세그먼트/플랜별 분기로 확장 예정.

### 수정
- `apps/mobile/app/(tabs)/_layout.tsx` — friends/family/character/library 탭 제거, people 탭 추가. TabIcon 맵 정리.
- `apps/mobile/app/_layout.tsx` — `character/index`와 `library/index` Stack.Screen 추가.
- `apps/mobile/app/(tabs)/index.tsx` — 캐릭터 미니 위젯 (이모지+이름+레벨+프로그레스바, 탭→/character), 최근 메시지 섹션 (3개+전체보기→/library) 추가. 친구 관리 링크 `/(tabs)/friends` → `/(tabs)/people` 변경.
- `apps/mobile/src/i18n/ko.json` — `tab.friends/family/character/library` 삭제, `tab.people` 추가, `screen.character/library` 추가, `home.viewCharacter/recentMessages/viewAll` 추가.
- `apps/mobile/src/i18n/en.json` — 동일 키 변경.

### 삭제
- `apps/mobile/app/(tabs)/character.tsx` — 스택으로 이동 완료
- `apps/mobile/app/(tabs)/library.tsx` — 스택으로 이동 완료
- `apps/mobile/app/(tabs)/friends.tsx` — people.tsx로 대체
- `apps/mobile/app/(tabs)/family.tsx` — people.tsx로 대체

## 검증 결과
- `npx tsc --noEmit` (mobile) — 통과
- `npx tsc --noEmit` (backend) — 통과

## 다음 루프 주의사항
- **P1 (People 탭 상세 구현)** 이 다음 우선순위. people.tsx에 세그먼트 컨트롤(멤버/친구/요청), 플랜별 분기, 커플 뷰, 가족 알람 분리를 구현해야 함.
- character/library 스택 화면은 `headerShown: true` 설정으로 뒤로가기 버튼이 자동 표시됨. SafeAreaView edges를 `['bottom']`으로 변경하여 Stack header와 겹치지 않도록 함.
- 홈 화면의 캐릭터 위젯은 `getCharacterMe()` 쿼리를 재사용 (`queryKey: ['character-me']`). character 스택 화면과 동일한 캐시 공유.
- `friends.*` i18n 키는 people.tsx에서 재사용 중. P1에서 `people.*` 키로 분리 및 추가 예정.
- family 관련 기능 (가족 알람 등)은 현재 people.tsx에 미포함. P1에서 멤버 세그먼트로 추가 예정.
