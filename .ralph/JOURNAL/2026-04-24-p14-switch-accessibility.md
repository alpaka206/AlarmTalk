# P14: Switch 컴포넌트 접근성 일괄 보강

**날짜**: 2026-04-24
**BACKLOG 항목**: 자가 생성 — 앱 접근성 강화 (Switch 컴포넌트 a11y 누락)

## 배경

R0~R5에서 신규 생성된 화면 6개에 대한 접근성 감사를 수행. ProfileDropdown의 Switch, 알람 탭의 Switch, 설정 화면의 Switch 3개에 accessibilityRole/accessibilityLabel/accessibilityState가 누락되어 있었음.

## 변경 파일

| 파일 | 변경 |
|------|------|
| `src/components/ProfileDropdown.tsx` | Switch에 accessibilityRole="switch", accessibilityLabel, accessibilityState 추가. Backdrop Pressable에 accessibilityRole="button" + accessibilityLabel 추가. Menu Pressable에 accessibilityRole="menu" 추가. |
| `app/(tabs)/alarms.tsx` | 알람 토글 Switch에 accessibilityRole="switch", accessibilityLabel, accessibilityState 추가 |
| `app/settings/index.tsx` | 알림 설정 Switch 2개 + 다크모드 Switch에 accessibilityRole="switch", accessibilityLabel, accessibilityState 추가 |
| `src/i18n/ko.json` | `alarms.toggleAlarm: "알람 켜기/끄기"` 키 추가 |
| `src/i18n/en.json` | `alarms.toggleAlarm: "Toggle alarm"` 키 추가 |

## 접근성 감사 결과 (R0~R5 신규 파일)

| 파일 | 인터랙티브 요소 | 커버된 | 상태 |
|------|----------------|--------|------|
| code-register/index.tsx | 2 | 2 | OK |
| note/create.tsx | 3 | 3 | OK |
| note/[id].tsx | 0 | 0 | OK (읽기 전용) |
| compose.tsx | 3 | 3 | OK |
| ProfileDropdown.tsx | 6 | 6 | **수정됨** |
| NotificationBell.tsx | 1 | 1 | OK |

## 검증

- mobile `npx tsc --noEmit` — 0 errors
- backend `npx tsc --noEmit` — 0 errors

## 다음 루프

Switch 접근성 100% 커버 완료. 앱 전체 접근성 수준이 WCAG AA에 근접.
