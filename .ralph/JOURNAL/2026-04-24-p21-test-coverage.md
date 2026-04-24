# P21: 백엔드 테스트 커버리지 100% 달성

**날짜**: 2026-04-24
**BACKLOG 항목**: 자가 생성 — 미테스트 모듈 커버리지 확장

## 접근

전체 백엔드 라우트 및 lib 모듈의 테스트 커버리지를 조사한 결과, 3개 파일이 미테스트:
- `routes/stats.ts` — 대시보드 통계 + 활동 피드
- `lib/elevenlabs.ts` — ElevenLabs API 클라이언트
- `lib/perso.ts` — Perso.ai API 클라이언트

## 생성 파일

| 파일 | 테스트 수 | 내용 |
|------|-----------|------|
| `test/stats.test.ts` | 14 | GET /stats (통계 6건) + GET /stats/activity (활동 8건) |
| `test/elevenlabs.test.ts` | 14 | listVoices, TTS, clone, diarize, deleteVoice + 에러 처리 |
| `test/perso.test.ts` | 13 | 전체 메서드 (spaces, SAS, upload, register, translate, progress, script, download, languages) + 204 + static |

## 설계 결정

- **stats 테스트**: 기존 mockDB 패턴 사용. 11개 Promise.all 쿼리를 순서대로 pushResult로 모킹. null 값 폴백, 빈 데이터, DB 에러 케이스 포함.
- **API 클라이언트 테스트**: `globalThis.fetch` mock으로 URL, 헤더, 바디 구성을 검증. 실제 API 호출 없음 (비용 방지). afterEach에서 원래 fetch 복구.
- **Perso 204 처리**: `res.json()`이 아닌 빈 객체 반환하는 분기 검증 추가.

## 검증

- 신규 41 tests 전체 통과
- backend 전체: 647/647 통과 (이전 606)
- mobile typecheck: 0 errors

## 커버리지 현황

모든 `routes/*.ts` (16/16) + 모든 `lib/*.ts` (16/16) 에 대응 테스트 존재. 100% 모듈 커버리지 달성.
