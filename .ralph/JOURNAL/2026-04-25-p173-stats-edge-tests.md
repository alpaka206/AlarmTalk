# P173 — stats.ts 라우트 엣지 케이스 테스트 확장

## 선택한 항목
BACKLOG: `stats.ts 라우트 엣지 케이스 테스트 확장 (18 tests / 176 lines)`

## 작업 내역

### GET /stats 대시보드 — 신규 7개
1. **문자열 숫자 Number() 변환**: SQLite가 문자열로 반환하는 경우 Number() 강제변환 검증
2. **카테고리별 독립 트렌드 값**: 5개 트렌드 각각 다른 thisWeek/lastWeek 값 확인
3. **트렌드 쿼리 ISO 날짜 바인딩**: weekAgo/twoWeeksAgo가 ISO 문자열로 전달되는지 확인
4. **alarms OR target_user_id 양방향 검색**: SQL에 양쪽 조건 존재 + args 바인딩
5. **friendships accepted 상태 필터**: SQL에 status = 'accepted' 포함 확인
6. **gifts received vs sent 분리 카운트**: recipient_id vs sender_id 별도 쿼리
7. **undefined 필드 폴백**: rows에 필드 누락 시 0 변환 (active, pending, last_week)

### GET /stats/activity — 신규 10개
1. **메시지 50자 경계 (not truncated)**: 정확히 50자 → 그대로 유지
2. **메시지 51자 경계 (truncated)**: 51자 → 50자로 잘림
3. **단일 타입만 있는 활동**: 알람만 5개, 나머지 빈 배열
4. **선물 note 빈 문자열 → null**: falsy 값이므로 null 변환 확인
5. **activity userId 양방향 바인딩**: alarms/gifts는 [userId, userId], messages/voices는 [userId]
6. **SQL ORDER BY + LIMIT 5 검증**: 4개 쿼리 모두 동일 패턴
7. **정확히 10개 활동 경계**: 10개 → 모두 반환
8. **동일 timestamp 안정성**: 4개 다른 타입 동일 시각 → 모두 포함
9. **메시지 text 숫자 타입 String() 변환**: DB에서 숫자로 반환 시 문자열 변환
10. **4개 소스 max 5씩 (20개) → 10개 반환**: 최신 10개만 선택 확인

## 변경 파일 (1개)
1. `packages/backend/test/stats.test.ts` — 18→35 tests (+17)

## 검증
- stats.test.ts: 35/35 통과
- 전체 backend: 1284/1284 통과 (1264→1284, +20 — 이전 커밋과의 차이)
- typecheck: backend 0 errors, mobile 0 errors

## 발견사항
- `r.note ? String(r.note).slice(0, 50) : null` — 빈 문자열('')도 falsy이므로 null로 변환됨. 의도된 동작으로 판단 (빈 note와 null note를 구분할 필요 없음).

## 다음 루프 참고
- BACKLOG 잔여: notification 라우트 테스트, alarm-mutation 통합 테스트 확장, 앱 아이콘/스플래시 에셋 교체, Sentry DSN 설정 후 연동 등
