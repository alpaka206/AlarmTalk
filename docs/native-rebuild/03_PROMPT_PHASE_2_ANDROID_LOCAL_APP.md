# Prompt: Phase 2 Android Local Alarm App

```text
C:\Users\gyuwo\Desktop\voice_alarm_native_rebuild 에서 작업해줘.

Phase 1 Android Alarm Engine이 실기기에서 검증됐다는 전제에서 진행해.
docs/native-rebuild/00_GOAL.md와 docs/native-rebuild/01_ROADMAP.md를 읽고, 이번 작업은 Phase 2: Android Local Alarm App만 구현해.

목표:
네트워크 없이도 동작하는 로컬 알람앱을 완성한다.

구현 범위:
1. Room 또는 DataStore 기반 알람 저장소
2. 알람 목록 화면
3. 알람 생성 화면
4. 알람 수정 화면
5. 알람 삭제
6. 활성화/비활성화 토글
7. 반복 요일
8. 스누즈 분 설정
9. 진동 패턴 설정
10. playMode: alarm_only, voice_only, alarm_voice 저장
11. OS 스케줄과 로컬 DB 동기화
12. 앱 재시작 후 스케줄 복구

이번 단계에서는 아직 백엔드 연동, 로그인, TTS, 가족/연인, 캐릭터, 결제 기능은 구현하지 마.
실기기 테스트 절차와 남은 리스크를 문서화해.
```

