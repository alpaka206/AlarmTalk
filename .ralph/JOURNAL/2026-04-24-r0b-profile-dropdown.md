# R0-B: 프로필 드롭다운 + 알림 아이콘

**날짜**: 2026-04-24
**BACKLOG 항목**: R0-B (프로필 드롭다운 + 알림 아이콘)

## 접근

settings 탭을 삭제한 후, 그 기능을 우측 상단 프로필 드롭다운으로 이전.

### ProfileDropdown 컴포넌트
- 아바타 버튼 (이름/이메일 첫 글자) → 탭하면 Modal 드롭다운
- 프로필 정보 (이름, 이메일, 플랜 뱃지)
- 메뉴 항목: 내 사람들, 코드 등록, 다크모드 토글, 언어 전환, 설정(상세), 로그아웃, 계정 삭제
- 파괴적 작업은 Alert 확인 대화상자 사용

### NotificationBell 컴포넌트
- 알림 아이콘 (🔔) + 미확인 수신 뱃지
- pending-requests 쿼리로 뱃지 카운트 표시
- 탭하면 /people 화면으로 이동

### 헤더 통합
- tabs _layout.tsx의 screenOptions에 headerShown: true 설정
- headerRight에 NotificationBell + ProfileDropdown 배치
- headerTitle 빈 문자열 (각 탭 화면이 자체 제목 표시)

## 변경 파일

| 파일 | 변경 |
|------|------|
| `src/components/ProfileDropdown.tsx` | 신규 (프로필 드롭다운 컴포넌트) |
| `src/components/NotificationBell.tsx` | 신규 (알림 벨 컴포넌트) |
| `app/(tabs)/_layout.tsx` | 헤더에 ProfileDropdown + NotificationBell 배치 |
| `src/i18n/ko.json` | profile.* 6키 추가 |
| `src/i18n/en.json` | 동일 |

## 검증

- `npx tsc --noEmit` — 0 errors

## 다음 루프 주의사항

- settings 스택 화면은 아직 남아 있음 (ProfileDropdown에서 "설정" 메뉴로 접근 가능)
- R5 정비 단계에서 settings 스택 화면의 중복 기능 정리 필요
- NotificationBell 뱃지는 현재 pending-requests만 카운트 — 추후 수신 메시지/쪽지도 포함 가능
