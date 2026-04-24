# 현재 상태

- 브랜치: develop_loop
- 마지막 루프: 2026-04-24 — R0~R4 완료 + R5 부분 완료
- 현재 Phase: **R5 부분 완료. R6 (Notion 문서화) 진행 가능**
- 전체 typecheck 통과 (backend + mobile 0 errors)
- 전체 테스트 통과 (backend 553/553, mobile 168/168)

## 완료된 리팩토링

- **P0~P10**: 전체 완료
- **R0**: 탭 5→4 변경 + ProfileDropdown + NotificationBell
- **R1**: 음성 2개 제한 (백엔드 + 프론트), GET /voice/family, voices 탭 리빌드
- **R2**: wake_mode 마이그레이션, alarm create/edit UI에 깨우기 방식 추가
- **R3**: 통합 코드 등록 엔드포인트 + 코드 등록 화면 + ProfileDropdown 연결
- **R4**: compose 탭 실구현 + notes 테이블/API + 쪽지 보내기 화면
- **R5**: alarm/edit wake_mode 동기화 + lint/typecheck/test 전체 통과

## 다음 목표: R6 (Notion 문서화)

Notion MCP 도구 사용 가능 여부 확인 후:
- 사용 가능: 직접 Notion 페이지에 작성
- 사용 불가: docs/ 폴더에 마크다운으로 생성

## 알려진 이슈
- [blocked] Perso API 404
- [blocked] ElevenLabs 통합 테스트
- settings/people 스택 화면 코드 잔존 (아직 참조 있을 수 있음)
- gift/received.tsx 잔존 (코드 등록으로 대체됨, 보수적 보존)
- compose 탭: 쪽지 탭 시 읽음 처리 + 상세 미구현
- TTS 변환 미구현 (notes.audio_url 항상 null)
