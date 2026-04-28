# R5: 데드 코드 분석 + 홈 화면 정리

**날짜**: 2026-04-24
**BACKLOG 항목**: R5 — settings/people 데드 코드 정리 + gift/received.tsx 정리 여부

## 분석 결과

### settings/people 스택 화면
- **결론: 데드 코드 아님 — 유지**
- `app/settings/index.tsx`: `ProfileDropdown.tsx` (line 162)에서 `router.push('/settings')` 참조
- `app/people/index.tsx`: 3곳에서 참조
  - `ProfileDropdown.tsx` (line 128): `router.push('/people')`
  - `NotificationBell.tsx` (line 29): `router.push('/people')`
  - `app/(tabs)/index.tsx` (line 436): `router.push('/people')`
- `_layout.tsx`에 Stack.Screen 정상 등록

### gift/received.tsx
- **결론: 파일 유지, 홈 화면 링크만 변경**
- `gift/received.tsx`는 `acceptGift`, `rejectGift` 로직 보유 — 삭제하면 선물 수락/거부 UI 소멸
- `friend/[id].tsx`에서 `getReceivedGifts`, `getSentGifts` 사용 — API 함수도 유효
- `message/create.tsx`에서 `sendGift` 사용 — 선물 시스템은 활성 상태
- 홈 화면 **액션카드**만 `/gift/received` → `/code-register`로 변경 (R3 스펙 정렬)
- 홈 화면 **통계카드** (pendingGifts)는 `/gift/received`로 유지 (대기 선물 수락 UX)

## 변경 사항

| 파일 | 변경 |
|------|------|
| `app/(tabs)/index.tsx` | 액션카드: `/gift/received` → `/code-register`, 이모지 🎁→🔑, i18n키 변경 |
| `src/i18n/ko.json` | `home.codeRegister: "코드 등록"` 추가 |
| `src/i18n/en.json` | `home.codeRegister: "Enter Code"` 추가 |

## 검증

- mobile `npx tsc --noEmit` — 0 errors
- backend `npx tsc --noEmit` — 0 errors

## 다음 루프

R5 완료. R6 (Notion 문서화) 진행 시작. Notion MCP 도구 사용 가능 여부 확인 필요.
