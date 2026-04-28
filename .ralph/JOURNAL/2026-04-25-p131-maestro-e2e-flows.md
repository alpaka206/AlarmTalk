# P131 — Maestro E2E 플로우 추가 (R0~R5 기능 커버)

## 선택한 항목
Section 4 규칙 적용: BACKLOG 잔여 항목이 모두 blocked/사용자 의존적 → E2E 테스트 확장 선택

## 작업 내역

### 신규 Maestro 플로우 3개

1. **07-message-tab.yaml** — 메시지 탭 (R4 기능)
   - 💌 탭 진입 → 알람 보내기/쪽지 보내기 카드 확인
   - 각 카드 탭 → 해당 화면 진입 확인
   - 받은 쪽지 목록 or 빈 상태 확인
   - 비로그인/비가족 플랜 안내 메시지 대응 (optional)

2. **08-code-register.yaml** — 코드 등록 (R3 기능)
   - 프로필 드롭다운 → 코드 등록 진입
   - 코드 입력 필드 확인
   - 이용권 코드 포맷(VA-XXXX) 입력 → 타입 감지 뱃지 확인
   - 가족 초대 코드(6자리) 입력 → 타입 감지 변경 확인
   - 등록하기 버튼 존재 확인

3. **09-alarm-voice-toggle.yaml** — 알람 음성 토글 (R2 기능)
   - 알람 생성 화면 진입
   - TTS 모드 🗣️ 탭 → 깨우기 방식(sound_then_voice / voice_only) 확인
   - 사운드 모드 🔊 전환 확인
   - 화면 정상 상태 검증 후 복귀

### config.yaml 업데이트
flowsOrder에 3개 플로우 추가 (총 9개)

### README.md 테스트 수 보정
- 백엔드: 872 → 1068
- 모바일: 1012 → 1044
- E2E: 6 → 9 플로우

## 변경 파일 (5개)
1. `apps/mobile/.maestro/07-message-tab.yaml` (신규)
2. `apps/mobile/.maestro/08-code-register.yaml` (신규)
3. `apps/mobile/.maestro/09-alarm-voice-toggle.yaml` (신규)
4. `apps/mobile/.maestro/config.yaml` (수정)
5. `README.md` (수정)

## 검증
- typecheck: backend 0 errors, mobile 0 errors
- YAML 문법 유효 (Write 성공)
- Maestro 실 실행은 디바이스 필요 (코드만 작성, 실행 불가)

## 다음 루프 참고
- Maestro 실행에는 Android 에뮬레이터 또는 실 디바이스 필요
- 07-message-tab은 로그인 + 가족 플랜 상태에 따라 다른 경로를 탄다 (optional 처리)
- BACKLOG 잔여: 앱 아이콘+스플래시(디자인 검증), Sentry(blocked), wrangler deploy(사용자), font rendering(디바이스)
