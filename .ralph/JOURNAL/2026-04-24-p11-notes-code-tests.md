# P11: notes + code 라우트 테스트 커버리지

**날짜**: 2026-04-24
**BACKLOG 항목**: 자가 생성 — 백엔드 테스트 커버리지 확장 (notes, code 라우트)

## 배경

R3 (코드 등록)과 R4 (쪽지) 기능 구현 시 라우트 테스트가 누락되었음. `packages/backend/src/routes/notes.ts`와 `code.ts`는 테스트 없이 배포된 상태.

## 생성 파일

| 파일 | 테스트 수 | 커버리지 |
|------|-----------|----------|
| `test/notes.test.ts` | 21 | POST 검증 9건 (JSON 파싱, 필수 필드, 길이 제한, 자기 전송, 수신자 미존재, 가족 그룹 체크, 정상 전송, trim), GET received 4건 (미존재, 정상, limit/offset, 클램핑), GET sent 2건, PATCH read 5건 (미존재, 쪽지 미존재, 권한, already_read, 정상) |
| `test/code.test.ts` | 22 | 공통 5건 (필수, 빈 문자열, 형식, 사용자 없음, JSON 파싱), 이용권 8건 (미존재, 사용완료, expired status, 날짜 만료, 본인, 플랜 없음, 정상, family 타입), 초대 9건 (미존재, used, revoked, 날짜 만료, 본인, 이미 멤버, 그룹 없음, 정원 초과, 정상) |

## 접근

- `push.test.ts` 패턴 차용 (mockDB + fakeAuthMiddleware + jsonReq)
- `code.ts`는 `hashVoucherCode`를 vi.mock으로 대체 (crypto.subtle 비동기 해시 회피)
- mock call 인덱스 정밀 매칭: 코드 라우트는 DB 쿼리가 6~7단계이므로 각 단계별 SQL 검증

## 검증

- `npx vitest run` — 596/596 passed (기존 553 + 신규 43)
- backend `npx tsc --noEmit` — 0 errors
- mobile `npx tsc --noEmit` — 0 errors

## 다음 루프

테스트 커버리지 확장 완료. 다음 후보:
- 성능 최적화 (React.memo/useMemo 감사)
- 쪽지 상세 화면 구현 (note/[id].tsx)
- Sentry 에러 모니터링 연동 준비
