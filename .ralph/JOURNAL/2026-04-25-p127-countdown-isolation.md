# P127 — 성능 프로파일링 Phase 3: countdown 분리

## 선택한 항목
BACKLOG P127: alarms.tsx countdown 분리 (tick 재렌더 범위 축소)

## 문제 분석
`alarms.tsx`에서 `tick` 상태가 60초마다 증가하면서:
1. `filteredAlarms` useMemo가 `tick` 의존 → 전체 목록 재정렬
2. `renderAlarm` useCallback이 `tick` 의존 → FlatList가 모든 항목 재렌더
3. `AlarmListItem`이 `tick` prop 수신 → `void tick`으로 countdown 재계산 강제

20개 알람이면 60초마다 20개 컴포넌트 + 정렬 + 배너 모두 재렌더됨.

## 해결 방법
tick 상태를 부모에서 완전히 제거하고, countdown 표시를 독립 컴포넌트로 분리:

### 1. `src/lib/alarmCountdown.ts` (신규)
- `getNextFireMs`, `formatCountdown`, `getNearestFireMs` — 순수 유틸리티 함수 추출
- `alarms.tsx`의 인라인 함수에서 분리 → 재사용 가능

### 2. `src/components/CountdownText.tsx` (신규)
- 각 알람 아이템 내에서 사용하는 개별 countdown 텍스트
- 자체 `setInterval(60s)` + `useState(tick)` 관리
- `React.memo`로 래핑 → 부모 재렌더와 무관

### 3. `src/components/BannerCountdown.tsx` (신규)
- 화면 상단 "다음 알람까지 X시간 Y분" 배너
- 자체 tick 관리, `getNearestFireMs`로 가장 가까운 알람 계산

### 4. `AlarmListItem.tsx` 수정
- `tick`, `formatCountdown`, `getNextFireMs` props 제거 (3개 prop 삭제)
- 내부에서 `<CountdownText alarm={item} />` 사용

### 5. `alarms.tsx` 수정
- `tick`, `countdownText` 상태 제거
- `computeCountdown` useCallback + useEffect 제거
- `filteredAlarms`에서 `tick` 의존성 제거 → 데이터 변경 시에만 재정렬
- 배너를 `<BannerCountdown>` 컴포넌트로 대체
- `renderAlarm`에서 `tick` 의존성 제거 → 안정적 참조

## 트레이드오프
- 정렬 순서가 60초마다 갱신되지 않음. 하지만 알람 간 상대 순서는 거의 변하지 않으며 (하루 단위 변경), 데이터 변경/pull-to-refresh 시 자동 재정렬됨.
- 각 AlarmListItem마다 독립 setInterval → 20개 알람이면 20개 타이머. 하지만 RN의 JavaScript 타이머는 lightweight이고, 60초 간격이라 실질적 부하 없음.

## 변경 파일 (5개)
1. `apps/mobile/src/lib/alarmCountdown.ts` (신규) — countdown 유틸리티
2. `apps/mobile/src/components/CountdownText.tsx` (신규) — 개별 alarm countdown
3. `apps/mobile/src/components/BannerCountdown.tsx` (신규) — 배너 countdown
4. `apps/mobile/src/components/AlarmListItem.tsx` (수정) — tick/formatCountdown/getNextFireMs 제거
5. `apps/mobile/app/(tabs)/alarms.tsx` (수정) — tick 상태 제거, BannerCountdown 사용

## 검증
- typecheck: backend 0 errors, mobile 0 errors

## 다음 루프 참고
- P128 (Phase 4): people/index.tsx renderFriend/renderRequest useCallback 남음
- 앱 아이콘, Sentry 연동 등 향후 작업 후보 존재
