# Prompt: Phase 6 Character, Streak, Billing

```text
C:\Users\gyuwo\Desktop\voice_alarm_native_rebuild 에서 작업해줘.

Phase 1~5가 검증됐다는 전제에서 진행해.
docs/native-rebuild/00_GOAL.md와 docs/native-rebuild/01_ROADMAP.md를 읽고, 이번 작업은 Phase 6: Character, Streak, Billing만 구현해.

목표:
알람 완료 이벤트 기반 캐릭터 성장, 스트릭, XP, 플랜 제한을 Android 네이티브 앱에 연결한다.

캐릭터 성장 콘셉트:
기존 앱/백엔드 타입과 맞춰 seed -> sprout -> tree -> bloom 흐름을 유지한다.
사용자 표시 문구는 씨앗 -> 새싹 -> 나무 -> 꽃 순서로 간다.

구현 범위:
1. 알람 dismiss/completed 이벤트 기록
2. 중복 완료 이벤트 방지
3. 오프라인 이벤트 큐
4. 서버 sync
5. 연속 기상 스트릭
6. XP
7. 씨앗/새싹/나무/꽃 성장
8. 무료/개인/커플/가족 플랜 제한
9. 쿠폰/초대 코드 상태 표시
10. 서버 권한 검증과 Android UI 제한 일치

주의:
- 알람 울림 시점은 네트워크에 의존하지 않는다.
- XP/캐릭터 이벤트는 알람 종료 후 로컬 큐에 기록하고, 네트워크 가능 시 sync한다.
- 결제/쿠폰/가족 기능은 실제 과금 API 호출 전 사용자 확인을 받는다.
```
