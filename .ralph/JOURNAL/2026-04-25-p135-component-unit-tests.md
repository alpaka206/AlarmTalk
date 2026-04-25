# P135 — 미테스트 컴포넌트 단위 테스트 (BannerCountdown, CountdownText, LibraryListItem, VoiceProfileItem)

## 선택한 항목
BACKLOG 잔여 미완료 항목 모두 manual/blocked. Section 4에 따라 테스트 커버리지 확장 선택 — 탐색 결과 4개 React.memo 컴포넌트에 테스트 부재 확인.

## 작업 내역

### 1. BannerCountdown.test.tsx (7 tests)
- 알람 없음 / 가까운 알람 없음 → null 렌더 검증
- 카운트다운 텍스트 표시 (label + value)
- getNearestFireMs/formatCountdown 호출 인자 검증
- 스타일 prop 전달 확인
- React.memo 래핑 확인

### 2. CountdownText.test.tsx (8 tests)
- 비활성 알람 → null + getNextFireMs 미호출 검증
- getNextFireMs null → null 렌더 검증
- 카운트다운 텍스트 표시
- 호출 인자 검증 (alarm, ms, t)
- style prop 적용 + 미전달 시 정상 렌더
- React.memo 래핑 확인

### 3. VoiceProfileItem.test.tsx (9 tests)
- 이름 표시, 아바타 첫 글자, 상태 뱃지 라벨
- 삭제 버튼 텍스트
- onPress(id), onDelete(id, name) 콜백 검증
- 접근성 라벨 (이름 + 상태)
- 생성 날짜 표시
- React.memo 래핑 확인

### 4. LibraryListItem.test.tsx (12 tests)
- 음성 이름, 메시지 텍스트 표시
- 카테고리 이모지 매핑 (morning→🌅, unknown→💌)
- 즐겨찾기 하트 이모지 (false→🤍, true→❤️)
- onPress(message_id), onFavorite(id) 콜백 검증
- 즐겨찾기 접근성 라벨 (addFavorite/removeFavorite)
- voice_name 없을 때 '?' 표시
- MiniWaveformPlayer 렌더 확인
- React.memo 래핑 확인

### 주요 mock 패턴
- `react-native-gesture-handler`: Swipeable → 단순 View 래퍼로 대체
- `MiniWaveformPlayer`: 텍스트만 렌더하는 stub 컴포넌트
- `i18n.getDateLocale`: 'ko-KR' 고정
- `TFunction`: `as unknown as TFunction` 캐스팅 (branded type 호환)
- `alarmCountdown`: jest.fn() 모킹으로 순수 렌더 검증

## 변경 파일 (4개)
1. `apps/mobile/test/BannerCountdown.test.tsx` (신규 — 7 tests)
2. `apps/mobile/test/CountdownText.test.tsx` (신규 — 8 tests)
3. `apps/mobile/test/VoiceProfileItem.test.tsx` (신규 — 9 tests)
4. `apps/mobile/test/LibraryListItem.test.tsx` (신규 — 12 tests)

## 검증
- 신규 테스트: 36/36 통과
- 전체 모바일: 64 suites, 1096 tests 전체 통과
- typecheck: backend 0 errors, mobile 0 errors

## 다음 루프 참고
- 모바일 테스트 수: 1060 → 1096 (+36)
- 남은 미테스트 컴포넌트: 없음 (constants 3파일은 순수 데이터, styles 17파일은 스타일 정의)
- 다음 유용한 작업: constants 파일 테스트, 또는 Maestro E2E 추가 플로우
