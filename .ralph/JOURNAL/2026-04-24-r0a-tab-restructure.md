# R0-A: 탭 구조 5→4 변경

**날짜**: 2026-04-24
**BACKLOG 항목**: R0-A (탭 축소 5→4)

## 접근

탭을 5개(홈/음성/알람/내사람들/설정)에서 4개(홈/음성/알람/메시지)로 변경.
- people, settings 탭을 탭바에서 제거하고 스택 화면으로 이동 (코드 보존)
- compose 탭 신규 생성 (스캐폴드)
- 설정 기능은 R0-B에서 프로필 드롭다운으로 이전 예정

## 대안 검토

- people.tsx 완전 삭제 vs 스택 이동 → 스택 이동 선택.
  이유: 친구/가족 관리 기능은 여전히 필요 (compose 탭, 홈에서 접근). 완전 삭제 시 코드 재작성 필요.
- settings.tsx 완전 삭제 vs 스택 이동 → 스택 이동 선택.
  이유: R0-B에서 ProfileDropdown 구현 전까지 설정 접근 경로가 필요. 로그아웃, 계정 삭제 등 필수 기능.

## 변경 파일

| 파일 | 변경 |
|------|------|
| `app/(tabs)/people.tsx` | 삭제 (→ `app/people/index.tsx`로 이동) |
| `app/(tabs)/settings.tsx` | 삭제 (→ `app/settings/index.tsx`로 이동) |
| `app/people/index.tsx` | 신규 (people 스택 화면) |
| `app/settings/index.tsx` | 신규 (settings 스택 화면) |
| `app/(tabs)/compose.tsx` | 신규 (메시지 작성 탭 스캐폴드) |
| `app/(tabs)/_layout.tsx` | 탭 5→4 변경 (people/settings 제거, compose 추가) |
| `app/_layout.tsx` | people/index, settings/index 스택 화면 추가 |
| `app/(tabs)/index.tsx` | 홈의 people 링크 경로 업데이트 |
| `src/i18n/ko.json` | tab.people/settings 삭제, tab.compose 추가, people.title 추가, compose.* 8키 추가 |
| `src/i18n/en.json` | 동일 |

## 검증

- `npx tsc --noEmit` — 0 errors
- 모든 `tab.people`, `tab.settings` 참조 제거 확인 (grep 0 matches)
- `(tabs)/people`, `(tabs)/settings` 경로 참조 제거 확인

## 다음 루프 주의사항

- R0-B에서 ProfileDropdown + NotificationBell 구현 시, settings 스택 화면의 기능을 드롭다운으로 이전해야 함
- people 스택 화면은 compose 탭 또는 홈에서 접근 가능하도록 네비게이션 연결 필요
- compose.tsx는 현재 스캐폴드만 — R4에서 실제 기능 구현
