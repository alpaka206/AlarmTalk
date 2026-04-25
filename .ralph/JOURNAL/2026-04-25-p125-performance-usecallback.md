# P125 — 성능 프로파일링: useCallback 최적화 (4개 화면)

## 선택한 항목
BACKLOG "성능 프로파일링 (불필요한 re-render 감지)" — FlatList 렌더러 및 이벤트 핸들러 미메모이제이션 수정

## 접근 방식
Explore 에이전트로 전체 모바일 앱 성능 분석 후, 가장 영향도 높은 문제를 수정:
- FlatList `renderItem` 함수가 useCallback으로 감싸지 않아 매 렌더에 새 참조 생성 → FlatList 전체 재렌더
- 이벤트 핸들러(handleDelete, handlePlayMessage 등)가 자식 컴포넌트에 전달될 때 불필요한 재렌더 유발

### 대안 검토
- React.memo 컴포넌트 추출: 더 효과적이지만 코드 변경량이 크고, useCallback으로도 주요 이점 확보 가능
- useMemo로 FlatList data 캐싱: 이미 적용됨 (filteredAlarms, displayItems)

## 변경 파일 (4개)

### 1. `app/(tabs)/index.tsx`
- `handlePlayMessage` → useCallback 래핑 (MiniWaveformPlayer 등 자식 컴포넌트 재렌더 방지)
- import에 useCallback 추가

### 2. `app/(tabs)/alarms.tsx`
- `handleDelete` → useCallback 래핑
- `formatRepeatDays` → useCallback 래핑
- `renderDeleteAction` → useCallback 래핑 (Swipeable에 전달되는 콜백 안정화)
- `renderAlarm` → useCallback 래핑 (FlatList renderItem 안정화)

### 3. `app/(tabs)/voices.tsx`
- `renderDeleteAction` → useCallback 래핑
- `renderProfile` → useCallback 래핑 (FlatList renderItem 안정화)
- `renderFamilyProfile` → useCallback 래핑

### 4. `app/library/index.tsx`
- `handleDelete` → useCallback 래핑
- `renderDeleteAction` → useCallback 래핑
- `handleMiniPlay` → useCallback 래핑 (MiniWaveformPlayer 재렌더 방지 — 가장 임팩트 큰 변경)
- `handleMiniStop` → useCallback 래핑
- `renderItem` → useCallback 래핑

## 이미 잘 구현된 부분 (변경 불필요)
- FlatList에 `initialNumToRender`, `maxToRenderPerBatch`, `windowSize`, `removeClippedSubviews` 이미 적용
- `FamilyMemberRow`, `PeopleSkeletonCard`: 이미 React.memo 래핑됨
- 스타일 객체: 이미 useMemo로 메모이제이션됨

## 검증
- typecheck: mobile 0 errors
- 기존 테스트에 영향 없음 (useCallback은 동작 변경 없이 참조 안정성만 개선)

## 다음 루프 참고
- 추가 최적화 가능: React.memo 컴포넌트 추출 (AlarmListItem, VoiceProfileItem, LibraryItem)
- alarms.tsx의 tick 기반 카운트다운이 60초마다 전체 리스트 재렌더 유발 — 별도 CountdownText 컴포넌트로 분리하면 개선 가능
- people/index.tsx의 renderFriend/renderRequest/renderMember도 useCallback 래핑 대상
