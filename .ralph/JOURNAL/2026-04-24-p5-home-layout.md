# P5: 홈 화면 레이아웃 정리 + 탭 화면 접근성 일괄 추가

## 선택한 항목
BACKLOG P5 디자인 폴리시 > 홈 화면 레이아웃 정리 + 접근성 점검 (탭 화면)

## 접근
위젯 간 간격, 섹션 구분선, 시각적 위계를 정비하고, 이어서 전체 탭 화면의 accessibilityLabel 누락을 일괄 보강했다.

### Part 1: 홈 화면 레이아웃 정리
**변경 전 문제**: 모든 섹션이 동일한 `marginBottom: Spacing.lg`(24px) 사용, 구분선 없음.

**변경 후**:
1. **섹션 구분선** 추가: "최근 메시지" 전, "빠른 액션" 전에 `border` 색상 1px 라인
2. **간격 위계**: header→xl, characterWidget→md, nextAlarmCard→md
3. **홈 화면 접근성**: 통계 3개, 빠른 액션 6개, 알람 카드, 응원 카드에 라벨 추가

### Part 2: 탭 화면 접근성 일괄 (alarms, voices, people, settings + LoginButtons)
접근성 감사 결과 탭 화면에서 27개 이상 라벨 누락 발견. 5개 파일에 걸쳐 총 ~30개 접근성 속성 추가:

- **alarms.tsx** — 알람 카드(accessibilityLabel: 시간+음성이름), 추가 버튼, 빈 상태 CTA
- **voices.tsx** — 4개 add 카드, 프로필 카드, 삭제 버튼
- **people.tsx** — 친구 카드, 세그먼트 탭(accessibilityRole="tab"), 추가 버튼, 초대 생성, 가족 알람 버튼
- **settings.tsx** — 스누즈 선택(accessibilityState), 로그아웃, 계정 삭제, 삭제 확인 다이얼로그, SettingRow 컴포넌트 전체
- **LoginButtons.tsx** — Google/Apple 로그인 버튼

## 변경 파일 (6개)
- `apps/mobile/app/(tabs)/index.tsx` — 레이아웃 정리 + 접근성 11개
- `apps/mobile/app/(tabs)/alarms.tsx` — 접근성 3개
- `apps/mobile/app/(tabs)/voices.tsx` — 접근성 6개
- `apps/mobile/app/(tabs)/people.tsx` — 접근성 6개
- `apps/mobile/app/(tabs)/settings.tsx` — 접근성 8개 (SettingRow 포함)
- `apps/mobile/src/components/LoginButtons.tsx` — 접근성 2개

## 검증
- `npx tsc --noEmit` 통과

## 다음 루프 참고
- 탭 화면의 접근성은 이 루프로 대부분 완료
- 스택 화면 (alarm/create, voice/record 등 ~15개)의 접근성은 별도 태스크로 진행 필요
- 이모지 단독 정보 전달 점검은 아직 미완 (접근성 BACKLOG에 남아 있음)
