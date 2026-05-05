# Native Rebuild Prompt Pack

이 폴더는 Voice Alarm을 풀 네이티브 알람앱으로 전환하기 위한 작업 지시서 모음이다.

## 사용 순서

1. `00_GOAL.md`
2. `01_ROADMAP.md`
3. `02_PROMPT_PHASE_1_ANDROID_ALARM_ENGINE.md`
4. `03_PROMPT_PHASE_2_ANDROID_LOCAL_APP.md`
5. `04_PROMPT_PHASE_3_ANDROID_AUDIO_VOICE.md`
6. `05_PROMPT_PHASE_4_BACKEND_INTEGRATION.md`
7. `06_PROMPT_PHASE_5_SOCIAL_SHARING.md`
8. `07_PROMPT_PHASE_6_CHARACTER_BILLING.md`
9. `08_PROMPT_PHASE_7_IOS_NATIVE.md`
10. `09_LEGACY_REFERENCE_EXTRACT.md`

## Codex에 요청하는 방식

각 단계마다 해당 `PROMPT_PHASE_*` 파일 안의 코드블록을 그대로 새 작업 메시지로 붙여 넣는다.

한 번에 전체 기능을 요청하지 않는다. 최종 Goal은 전체 완성이지만, 실제 개발은 Phase 단위로 검증하면서 진행한다.

## 가장 중요한 원칙

알람 엔진이 실기기에서 검증되기 전까지 로그인, 캐릭터, 가족/연인, 결제 기능을 구현하지 않는다.
