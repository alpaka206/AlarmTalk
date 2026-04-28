# P42: 백엔드 API 응답 시간 벤치마크 테스트

**날짜**: 2026-04-24
**BACKLOG 항목**: 자가 생성 풀 — 백엔드 API 응답 시간 벤치마크 테스트

## 접근

주요 API 엔드포인트의 응답 시간 기준선을 설정하는 벤치마크 테스트 파일 생성. mock DB 환경에서 측정하므로 실제 DB 레이턴시는 제외되지만, 라우트 핸들러 로직의 성능 회귀를 탐지하는 데 유용.

## 설계 결정

- **임계값**: 읽기 50ms, 쓰기 80ms — mock DB 환경에서 여유 있는 기준선
- **p95 검증**: sustained throughput 테스트에서 50회 연속 요청의 p95가 임계값×1.5 미만인지 확인
- **validation fast-path**: 입력 검증 실패가 DB를 호출하지 않고 빠르게 반환되는지 별도 검증
- **커버리지**: alarm, character, library, friend, stats, push, notes, code, user, gift — 10개 라우트 그룹

## 생성 파일

| 파일 | 테스트 수 | 내용 |
|------|-----------|------|
| `test/api-latency.test.ts` | 19 | 12 엔드포인트 레이턴시 + 3 validation fast-path + 1 sustained throughput (50회) |

## 테스트 구성

- GET /alarm (empty + 20개): 목록 조회 레이턴시 (COUNT + data 병렬 쿼리 포함)
- POST /alarm: 생성 (plan 체크 + message 확인 + INSERT)
- GET /characters/me: 캐릭터 조회 (4 쿼리: userPk + character + stats + achievements)
- GET /library (empty + 50개): 라이브러리 조회
- GET /friend/list: 친구 목록
- POST /friend: 친구 요청 (target lookup + existing check + INSERT)
- GET /stats: 통계 (4 COUNT 쿼리)
- POST /push/token: 푸시 토큰 등록
- GET /notes/received (empty + 10개): 쪽지 수신함
- POST /code/register: 코드 등록 (잘못된 형식 fast-path)
- GET /user/me: 프로필 조회
- GET /gift/received: 선물 수신함
- Sustained throughput: 50회 연속 GET /alarm (avg + p95 검증)

## 검증

- backend `npx tsc --noEmit` — 0 errors
- mobile `npx tsc --noEmit` — 0 errors
- backend tests — 672/672 passed (기존 653 + P42 19)
- mobile tests — 변경 없음 (449/449)

## 다음 루프

자가 생성 풀 남은 항목: 모바일 번들 사이즈 모니터링.
