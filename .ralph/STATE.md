# 현재 상태

- 브랜치: develop_loop
- 마지막 루프: 2026-04-25 — P87 character.ts API 라우트 테스트 24건 추가
- 현재 Phase: **R0~R6 전체 완료 + P11~P87 완료**
- 전체 typecheck 통과 (backend + mobile 0 errors)
- 전체 테스트 통과 (backend 857/857, mobile 662/662)

## 완료된 리팩토링

- **P0~P10**: 전체 완료
- **R0~R5**: 전체 완료
- **R6**: 프로젝트 문서화 6건 (docs/R6-A~F.md)
- **P11~P83**: 전체 완료 (상세 내역은 이전 STATE 참조)
- **P84**: alarm.ts validateAlarmFields() 추출로 POST/PATCH 검증 중복 제거 (~70줄→2줄), 모든 에러 응답에 error_code 추가 (17종), 프론트엔드 ALARM_NOT_FOUND 매핑 + i18n, 테스트 8건 추가
- **P85**: user.test.ts 테스트 16→30개 (+14): beforeEach reset() 수정, error_code 검증 5건, toBoolFlag 6변환 테스트, DB 에러 핸들링 3건, 엣지 케이스 4건
- **P86**: notes.test.ts 24→34개 (+10): vi.hoisted 도입, error_code 검증 10건 강화, sendNotePush 호출/locale 검증 3건, sender name 폴백 2건, 경계값 4건, sent 페이지네이션 3건
- **P87**: character.test.ts 11→35개 (+24): GET /characters/me 4건 (404, 자동생성, 기존캐릭터+stats, progress), POST /characters/xp 20건 (이벤트검증, XP지급, 일일캡, 날짜리셋, nonce멱등, 스트릭, 마일스톤, 캡면제)

## 알려진 이슈
- [blocked] Perso API 404
- [blocked] ElevenLabs 통합 테스트
- TTS 변환 미구현 (notes.audio_url 항상 null)
- eas.json submit: iOS ascAppId/appleTeamId placeholder 교체 필요
- eas.json submit: Android google-service-account.json 생성 필요
- Sentry DSN 미설정 (사용자가 Sentry 프로젝트 생성 후 설정 필요)
