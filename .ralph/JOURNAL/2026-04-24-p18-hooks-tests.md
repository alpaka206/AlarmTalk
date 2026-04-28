# P18 — hooks 테스트 커버리지 확장

## 선택 근거
- BACKLOG R0~R5, P0~P17 전체 완료 상태
- 잔여 미완료 항목은 에뮬레이터/배포/Notion으로 야간 무인 모드에서 진행 불가
- "자가 생성 가능 풀"에서 hooks 테스트를 선택 (useAppStore는 P17에서 완료)

## 변경 파일
1. `apps/mobile/test/useTheme.test.ts` (신규) — 10 tests
   - 라이트/다크 모드 색상 반환 검증
   - 색상 스키마 무결성 (키 일치, 비어있지 않음, 객체 분리)
   - Zustand 스토어 연동 확인

2. `apps/mobile/test/useToast.test.ts` (신규) — 8 tests
   - Animated.Value/timing mock
   - show → fade-in → delay → fade-out 시퀀스
   - 연속 show 시 이전 타이머 취소
   - 커스텀 duration, 빈 문자열, 한국어, cleanup

3. `apps/mobile/test/useNetworkStatus.test.ts` (신규) — 6 tests
   - NetInfo addEventListener mock (mockListeners 패턴)
   - isConnected true/false/null 처리
   - 언마운트 시 리스너 제거
   - 연속 상태 변경

4. `apps/mobile/test/useAuth.test.ts` (신규) — 24 tests
   - login 성공/실패/토큰 persist
   - register 성공/중복/토큰 persist
   - logout storage 정리
   - refresh (fetchAuthMe) 정상/만료/서버에러/자동로그아웃
   - boot 시퀀스 (저장토큰 복원, 미저장, 만료)
   - 전체 사이클 통합 (register→refresh→logout, 재시도)
   - 엣지케이스 (export 검증, family/plus 플랜, 네트워크 에러, storage 에러)

## 검증 결과
- 모바일 전체: 286/286 통과 (기존 238 + P18 48)
- 백엔드 typecheck: 0 errors
- 모바일 typecheck: 0 errors

## 주의사항
- useNetworkStatus mock에서 jest.mock 내부 변수 참조 제한으로 `mockListeners` 접두사 필요
- useAuth는 React Context 기반이라 hook 직접 호출 불가 → authApi 함수 + storage 조합으로 로직 테스트
- dynamic import (`await import()`)는 jest 환경에서 `--experimental-vm-modules` 없이 불가 → static import 사용
