# P128 — 성능 프로파일링 Phase 4: people/index.tsx useCallback

## 선택한 항목
BACKLOG P128: people/index.tsx renderFriend/renderRequest useCallback

## 문제 분석
`people/index.tsx`에서 `renderFriend`, `renderRequest`, `renderMember`가 인라인 함수로 선언되어 있어
부모 컴포넌트 재렌더 시 매번 새 참조가 생성 → FlatList가 모든 항목을 재렌더.
`handleRemove`, `handleSend`, `handleShareInvite`도 인라인이라 의존 함수 참조 불안정.

## 해결 방법

### useCallback 래핑 (6개 함수)
1. `handleSend` → `useCallback([email, sendMutation])`
2. `handleRemove` → `useCallback([t, removeMutation])`
3. `handleShareInvite` → `useCallback([t, toast])`
4. `renderFriend` → `useCallback([styles, router, t, handleRemove])`
5. `renderRequest` → `useCallback([styles, t, acceptMutation])`
6. `renderMember` → `useCallback([isCouple])`

### Hook 호출 순서 보장
`renderFriend`/`renderRequest`/`renderMember`를 `useCallback`으로 변환하면 hook이 되므로,
기존 early return (`if (!isAuthenticated)`) 위로 이동시킴.
early return은 hook 선언 이후로 재배치.

## 변경 파일 (1개)
1. `apps/mobile/app/people/index.tsx` — useCallback 6개 적용 + hook 순서 조정

## 검증
- typecheck: mobile 0 errors

## 다음 루프 참고
- 성능 프로파일링 Phase 1~4 전체 완료
- BACKLOG 남은 미완료: 앱 아이콘/스플래시, Sentry, App Store 메타데이터 (모두 사용자 입력 필요 또는 리소스 의존)
- Section 4에 따라 새 항목 생성 필요
