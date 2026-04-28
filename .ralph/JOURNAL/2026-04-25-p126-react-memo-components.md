# P126 — 성능 프로파일링 Phase 2: React.memo 컴포넌트 추출

## 선택한 항목
BACKLOG "성능 프로파일링 Phase 2: React.memo 컴포넌트 추출 (AlarmListItem, LibraryListItem 등)"

## 접근 방식
FlatList renderItem 내부의 대형 인라인 JSX를 별도 React.memo 컴포넌트로 추출하여, 부모 상태 변경 시 변경되지 않은 아이템의 재렌더를 방지.

3개 컴포넌트 추출:
1. **AlarmListItem** — alarms.tsx의 renderAlarm (~80줄 JSX → memo 컴포넌트)
2. **LibraryListItem** — library/index.tsx의 renderItem (~60줄 JSX → memo 컴포넌트)
3. **VoiceProfileItem** — voices.tsx의 renderProfile (~40줄 JSX → memo 컴포넌트)

### 설계 결정
- 각 컴포넌트의 props를 최대한 primitive/stable 값으로 설계하여 memo 효과 극대화
- `t` 함수는 `TFunction` 타입으로 정확히 매핑 (i18next 호환)
- `renderDeleteAction`은 이미 useCallback으로 감싸져 있으므로 콜백 참조 그대로 전달
- 스타일 객체도 이미 useMemo로 메모이제이션됨 — memo 컴포넌트와 함께 최적 성능
- getCategoryEmoji를 LibraryListItem 내부 상수로 이동 (모듈 스코프)
- 기존 inline IIFE (familyLabel 계산) 제거 → 컴포넌트 내부 지역 변수로 간결화

## 변경 파일 (6개)

### 신규 생성
1. `src/components/AlarmListItem.tsx` — React.memo 래핑 알람 아이템
2. `src/components/LibraryListItem.tsx` — React.memo 래핑 라이브러리 아이템
3. `src/components/VoiceProfileItem.tsx` — React.memo 래핑 음성 프로필 아이템

### 수정
4. `app/(tabs)/alarms.tsx` — renderAlarm을 AlarmListItem으로 교체, 미사용 import 제거 (Swipeable, Switch, getAlarmModeBadge, buildFamilyAlarmLabel)
5. `app/library/index.tsx` — renderItem을 LibraryListItem으로 교체, getCategoryEmoji 삭제, Swipeable/MiniWaveformPlayer/getDateLocale import 제거
6. `app/(tabs)/voices.tsx` — renderProfile을 VoiceProfileItem으로 교체, Swipeable/getDateLocale import 제거

## 검증
- typecheck: mobile 0 errors, backend 0 errors
- 동작 변경 없음 — 렌더링 결과는 동일, props 동일 시 재렌더 스킵

## 다음 루프 참고
- Phase 3 (alarms.tsx countdown 분리) — tick 상태로 인한 전체 리스트 재렌더를 CountdownText 컴포넌트로 격리 가능
- Phase 4 (people/index.tsx useCallback) — 남은 최적화 대상
