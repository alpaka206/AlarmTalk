# 현재 상태

- 브랜치: develop_loop
- 마지막 루프: 2026-04-25 — P96 character.ts 분할
- 현재 Phase: **R0~R6 전체 완료 + P11~P96 완료**
- 전체 typecheck 통과 (backend + mobile 0 errors)
- 전체 테스트 통과 (backend 780/780)

## 완료된 리팩토링

- **P0~P10**: 전체 완료
- **R0~R5**: 전체 완료
- **R6**: 프로젝트 문서화 6건 (docs/R6-A~F.md)
- **P11~P95**: 전체 완료
- **P96**: character.ts 405줄 → character-helpers.ts(168줄) + character-query.ts(30줄) + character-mutation.ts(215줄) + character.ts(11줄 aggregator) 분할

## 알려진 이슈
- [blocked] Perso API 404
- [blocked] ElevenLabs 통합 테스트
- TTS 변환 미구현 (notes.audio_url 항상 null)
- eas.json submit: iOS ascAppId/appleTeamId placeholder 교체 필요
- eas.json submit: Android google-service-account.json 생성 필요
- Sentry DSN 미설정 (사용자가 Sentry 프로젝트 생성 후 설정 필요)

## 남은 대형 라우트 파일
- billing.ts (378줄) — 분할 대상
