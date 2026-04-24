# 현재 상태

- 브랜치: develop_loop
- 마지막 루프: 2026-04-24 — R2 세부사항 완료 + compose 쪽지 읽음 처리 구현
- 현재 Phase: **R0~R6 전체 완료 + R2 세부사항 전부 완료**
- 전체 typecheck 통과 (backend + mobile 0 errors)

## 완료된 리팩토링

- **P0~P10**: 전체 완료
- **R0~R5**: 전체 완료
- **R6**: 프로젝트 문서화 6건 (docs/R6-A~F.md)
- **R2 추가**: 가족 음성 알람 선택 UI (create + edit)
- **R2 추가**: 프리셋 카테고리 UI 개선 (2열 그리드 + i18n 전환 + 랜덤 선택)
- **R2 추가**: 최근 사용 메시지 목록 (AsyncStorage 캐싱, 최대 5개)
- **R2 추가**: 음성 캐싱 — 동일 voice+text 재생성 방지, 기존 메시지 재사용

## R2 세부사항 (전부 완료)
- [x] 프리셋 메시지 카테고리 선택 UI 개선
- [x] 최근 사용 메시지 목록 (AsyncStorage 캐싱)
- [x] 음성 캐싱 (동일 텍스트+음성 재사용)

## 알려진 이슈
- [blocked] Perso API 404
- [blocked] ElevenLabs 통합 테스트
- [x] compose 탭: 쪽지 읽음 처리 구현 완료 (탭하면 markNoteRead 호출 + 읽음 상태 반영)
- compose 탭: 쪽지 상세 화면 미구현 (현재 인라인 전체 텍스트 표시로 대체)
- TTS 변환 미구현 (notes.audio_url 항상 null)
