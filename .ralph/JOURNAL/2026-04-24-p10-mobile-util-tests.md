# 2026-04-24 P10: 모바일 유틸 테스트 커버리지 확장

## 집은 항목
자가 생성 풀 → 모바일 유틸/서비스 모듈 테스트 커버리지 확장

## 접근
기존 모바일 15개 테스트 파일 분석 후 미테스트 모듈 식별:
- `formatLastSeen.ts` — 날짜→사람 친화적 문자열 변환 유틸. 순수 함수, 엣지케이스 풍부.
- `offlineCache.ts` — AsyncStorage 기반 4종 캐시 (alarms/messages/library/voices). 격리 및 덮어쓰기 검증 필요.

대안: `audio.ts`/`notifications.ts` 테스트도 고려했으나, 네이티브 모듈 의존성이 높아 jest-expo 환경에서 모킹 복잡도 큼. 순수 유틸부터 커버.

## 변경 파일
1. `apps/mobile/test/formatLastSeen.test.ts` (신규) — 15 tests
   - null/undefined/빈문자열/잘못된날짜/미래시간 → unknown (5건)
   - justNow: 30초 전, 0ms 차이 (2건)
   - minutesAgo: 5분, 59분 경계 (2건)
   - hoursAgo: 1시간, 23시간 경계 (2건)
   - daysAgo: 1일, 29일 경계 (2건)
   - longAgo: 30일, 90일 (2건)

2. `apps/mobile/test/offlineCache.test.ts` (신규) — 15 tests
   - alarms: null반환/저장복원/빈배열/다수 (4건)
   - messages: null반환/저장복원/빈배열 (3건)
   - library: null반환/저장복원/즐겨찾기 (3건)
   - voices: null반환/저장복원/다수 (3건)
   - 격리: 키 간섭 없음/덮어쓰기 (2건)

## 검증
- 신규 2파일: 30 tests 전체 통과
- 모바일 전체: 168/168 통과 (기존 138 + 신규 30)
- 백엔드 전체: 553/553 통과
- Mobile typecheck: 통과
- Backend typecheck: 통과

## 다음 루프
- 자가 생성 풀에서 다음 항목 선택
- 후보: notifications.ts/audio.ts 테스트 (네이티브 모킹 필요), 문서화, 성능 프로파일링
