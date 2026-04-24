# 현재 상태

- 브랜치: develop_loop
- 마지막 루프: 2026-04-25 — P92 백엔드 테스트 파일 위치 정리 (중복 제거)
- 현재 Phase: **R0~R6 전체 완료 + P11~P92 완료**
- 전체 typecheck 통과 (backend + mobile 0 errors)
- 전체 테스트 통과 (backend 780/780, mobile 662/662)

## 완료된 리팩토링

- **P0~P10**: 전체 완료
- **R0~R5**: 전체 완료
- **R6**: 프로젝트 문서화 6건 (docs/R6-A~F.md)
- **P11~P83**: 전체 완료 (상세 내역은 이전 STATE 참조)
- **P84**: alarm.ts validateAlarmFields() 추출, error_code 17종 추가, 테스트 8건 추가
- **P85**: user.test.ts 16→30개 (+14)
- **P86**: notes.test.ts 24→34개 (+10)
- **P87**: character.test.ts 11→35개 (+24)
- **P88**: friend.test.ts 12→31개 (+19): error_code/페이지네이션/검색/UUID/DB에러
- **P89**: gift.test.ts 14→33개 (+19): error_code/페이지네이션/검색/UUID/경계값/DB에러
- **P90**: billing.test.ts 26→51개 (+25): error_code 전수검증/DB에러/malformed body/edge cases
- **P91**: MiniWaveformPlayer.tsx accessibilityLabel 하드코딩 영어→i18n(player.a11yPlay/a11yPause) 수정
- **P92**: 백엔드 테스트 파일 중복 정리 — src/routes/*.test.ts 6개 삭제, 고유 테스트 27건 test/로 병합, vitest.config 정리

## 알려진 이슈
- [blocked] Perso API 404
- [blocked] ElevenLabs 통합 테스트
- TTS 변환 미구현 (notes.audio_url 항상 null)
- eas.json submit: iOS ascAppId/appleTeamId placeholder 교체 필요
- eas.json submit: Android google-service-account.json 생성 필요
- Sentry DSN 미설정 (사용자가 Sentry 프로젝트 생성 후 설정 필요)
