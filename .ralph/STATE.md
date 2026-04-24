# 현재 상태

- 브랜치: develop_loop
- 마지막 루프: 2026-04-24 — R0 + R1 + R2(핵심) 완료
- 현재 Phase: **R2 핵심 완료. R3 (코드 등록 시스템) 진행 필요**
- 전체 typecheck 통과 (backend + mobile 0 errors)

## 완료된 리팩토링

- **P0~P10**: 전체 완료
- **R0**: 탭 5→4 변경 + ProfileDropdown + NotificationBell
- **R1**: 음성 2개 제한 (백엔드 + 프론트), GET /voice/family, voices 탭 리빌드
- **R2**: wake_mode 마이그레이션, alarm create UI에 깨우기 방식 추가

## 다음 목표: R3 (코드 등록 시스템)

1. **R3**: 코드 등록 → 이용권/가족 초대 분기
2. **R4**: 메시지 작성 탭 실구현
3. **R5**: 정비 + 테스트 (R2 미완료 항목 포함)
4. **R6**: Notion 문서화

## 다음 루프 지시

**R3부터 시작하라.** gift/received 화면을 code-register로 리네임, 코드 타입 판별 UI.

## 알려진 이슈
- [blocked] Perso API 404
- [blocked] ElevenLabs 통합 테스트
- alarm/edit.tsx에 wake_mode UI 미적용 (R5에서 처리)
- settings 스택 화면 중복 (R5에서 정리)
