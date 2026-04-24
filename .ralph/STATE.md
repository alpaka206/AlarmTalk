# 현재 상태

- 브랜치: develop_loop
- 마지막 루프: 2026-04-25 — P82 백엔드 푸시 알림 + 화자 분리 i18n
- 현재 Phase: **R0~R6 전체 완료 + P11~P82 완료**
- 전체 typecheck 통과 (backend + mobile 0 errors)
- 전체 테스트 통과 (backend 798/798, mobile 662/662)

## 완료된 리팩토링

- **P0~P10**: 전체 완료
- **R0~R5**: 전체 완료
- **R6**: 프로젝트 문서화 6건 (docs/R6-A~F.md)
- **P11~P81**: 전체 완료 (상세 내역은 이전 STATE 참조)
- **P82**: 백엔드 FCM 푸시 알림 i18n (ko/en pushTexts 맵 + locale 파라미터) + voice diarize 응답 label 영문화 + notes.ts Accept-Language 기반 locale 전달 + FCM 테스트 7건 추가

## 알려진 이슈
- [blocked] Perso API 404
- [blocked] ElevenLabs 통합 테스트
- TTS 변환 미구현 (notes.audio_url 항상 null)
- eas.json submit: iOS ascAppId/appleTeamId placeholder 교체 필요
- eas.json submit: Android google-service-account.json 생성 필요
- Sentry DSN 미설정 (사용자가 Sentry 프로젝트 생성 후 설정 필요)
