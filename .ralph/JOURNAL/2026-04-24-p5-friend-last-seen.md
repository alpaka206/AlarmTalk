# P5: 친구 마지막 접속 시간 표시

## BACKLOG 항목
- 친구 프로필에 마지막 접속 시간 표시 ("방금 전", "1시간 전" 등)

## 접근
풀스택 구현: DB 마이그레이션 → 백엔드 API → 프론트엔드 유틸리티 → UI 표시 → i18n.

### 백엔드
- **마이그레이션 16** (`user-last-active`): users 테이블에 `last_active_at TEXT DEFAULT (datetime('now'))` 컬럼 추가
- **user.ts GET /user/me**: 기존 profileCount/alarmCount Promise.all에 `UPDATE users SET last_active_at = datetime('now')` 추가 — 앱이 열릴 때마다 자동 갱신
- **friend.ts GET /friend/list**: SELECT에 `u.last_active_at as friend_last_active_at` 필드 추가

### 프론트엔드
- **types.ts**: `Friend` 인터페이스에 `friend_last_active_at?: string` 필드 추가
- **formatLastSeen.ts** (신규): ISO 날짜를 상대 시간으로 변환하는 유틸리티 (방금 전/N분 전/N시간 전/N일 전/오래 전)
- **people.tsx**: renderFriend에서 이메일 아래에 lastSeen 텍스트 표시, `lastSeen` 스타일 추가 (FontSize.xs, textTertiary)

### i18n
- ko: lastSeen.justNow("방금 전"), minutesAgo("N분 전"), hoursAgo("N시간 전"), daysAgo("N일 전"), longAgo("오래 전"), unknown("접속 기록 없음")
- en: "Just now", "Nm ago", "Nh ago", "Nd ago", "Long ago", "Never seen"

## 변경 파일
1. `packages/backend/src/lib/migrations.ts` — 마이그레이션 16 추가
2. `packages/backend/src/routes/user.ts` — last_active_at 갱신 쿼리
3. `packages/backend/src/routes/friend.ts` — friend_last_active_at SELECT 추가
4. `apps/mobile/src/types.ts` — Friend.friend_last_active_at 필드
5. `apps/mobile/src/lib/formatLastSeen.ts` — 상대 시간 포매터 (신규)
6. `apps/mobile/app/(tabs)/people.tsx` — import + renderFriend UI + lastSeen 스타일
7. `apps/mobile/src/i18n/ko.json` — lastSeen 키 6개
8. `apps/mobile/src/i18n/en.json` — lastSeen 키 6개

## 검증
- Backend: `npx tsc --noEmit` 통과
- Mobile: `npx tsc --noEmit` 통과

## 설계 판단
- `last_active_at` 갱신 위치를 auth middleware가 아닌 `GET /user/me`로 선택한 이유: 모든 API 호출마다 UPDATE를 날리면 DB 부하가 불필요하게 증가. `/user/me`는 앱 시작 시 1회 호출되므로 적절한 빈도.
- 서버 시간(UTC) 기반으로 `datetime('now')` 사용. 클라이언트에서 `Date.now()`와 비교하여 상대 시간 계산.
- `friend_last_active_at`가 null인 경우(마이그레이션 전 가입 사용자) "접속 기록 없음" 표시.

## 다음 루프 주의사항
- 새로 가입한 사용자는 `last_active_at`이 마이그레이션 기본값으로 설정됨 (현재 시간)
- 기존 사용자는 다음 `/user/me` 호출 시 갱신됨
- friend/[id] 상세 페이지에도 last seen 표시를 추가할 수 있음 (별도 항목)
