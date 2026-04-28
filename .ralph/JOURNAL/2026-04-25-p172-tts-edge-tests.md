# P172 — TTS 라우트 엣지 케이스 테스트 확장

## BACKLOG 항목
- translate.ts 라우트 엣지 케이스 테스트 확장 → translate.ts 미존재 확인 (dub.ts에 통합됨)
- notification 라우트 테스트 커버리지 추가 → push.ts 이미 22개로 충분
- **최종 선택**: tts.ts 라우트 — 249 lines에 20 tests (0.08 tests/line, 전체 최저 비율)

## 접근
tts.ts의 4개 엔드포인트별 미커버 코드 경로를 분석하여 19개 엣지 케이스 테스트 추가.

## 추가된 테스트 (19개, 20→39)

### POST /tts/generate edge cases (13개)
1. user 미존재 시 사용량 체크 건너뛰고 voice profile 조회로 진행
2. daily_tts_reset_at가 오늘이 아니면 카운트 리셋 후 진행
3. 알 수 없는 plan이면 기본 제한 3으로 폴백
4. elevenlabs_voice_id 없으면 NO_VOICE_ID 400
5. ElevenLabs 실패 시 500 + detail 포함
6. ElevenLabs가 비-Error를 throw하면 detail "Unknown error"
7. 성공 시 201 + message_id, audio_base64, category 기본값 custom
8. 성공 시 category 명시하면 해당 category 저장
9. text 정확히 200자면 허용
10. voice_profile_id 있고 text 없으면 400
11. text 있고 voice_profile_id 없으면 400
12. free plan 일일 제한 미달이면 진행
13. family plan은 사실상 무제한

### GET /tts/messages edge cases (6개)
14. limit > 100이면 100으로 클램핑
15. limit=0은 falsy이므로 기본값 50으로 폴백 (구현 특성 확인)
16. limit 비숫자이면 기본값 50
17. offset 음수이면 0으로 클램핑
18. 유효한 voice_profile_id 필터 SQL에 포함
19. category + voice_profile_id 복합 필터

### DELETE /tts/messages/:id edge cases (3개 — 기존 describe에 추가하지 않고 별도 describe)
1. 삭제 시 message_library부터 삭제 후 messages 삭제 (순서 검증)
2. 삭제 SQL에 user_id 포함 (사용자 격리)
3. force=true이고 알람 0개여도 정상 삭제

## 변경 파일
- `packages/backend/test/tts.test.ts` — 19개 테스트 추가

## 검증
- vitest: 39/39 passed ✅
- tsc --noEmit: 0 errors ✅

## 발견사항
- `limit=0`은 `parseInt('0', 10) || 50` = 50으로 폴백됨 (0이 falsy이므로). 버그는 아니지만 주의할 동작.
- translate.ts 라우트는 별도 파일로 존재하지 않음 (dub.ts에 통합). BACKLOG 항목 삭제.

## 다음 루프 참고
- 백엔드 테스트 총 1245+19 = 1264개
- 남은 BACKLOG: alarm-mutation 확장, notification 확장 (push 외 알림), 앱 아이콘/스플래시 에셋
