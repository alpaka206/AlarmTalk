# Prompt: Phase 3 Android Audio And Voice

```text
C:\Users\gyuwo\Desktop\voice_alarm_native_rebuild 에서 작업해줘.

Phase 1, Phase 2가 검증됐다는 전제에서 진행해.
docs/native-rebuild/00_GOAL.md와 docs/native-rebuild/01_ROADMAP.md를 읽고, 이번 작업은 Phase 3: Android Audio + Voice만 구현해.

목표:
보이스 알람의 로컬 오디오 흐름을 완성한다.

구현 범위:
1. 기본 알람음 playback 안정화
2. 앱 내 녹음
3. 30초 제한
4. 파일 업로드 선택
5. 긴 파일은 30초 crop 또는 제한 처리
6. 원본 음성 알람
7. TTS/voice 파일을 로컬 파일로 저장하는 캐싱 계층
8. alarm_only / voice_only / alarm_voice 실제 재생 순서 구현
9. 알람 울림 시점에 네트워크 fetch가 발생하지 않도록 보장
10. 비행기 모드 테스트 절차 문서화

이번 단계에서는 아직 가족/연인 공유, 캐릭터, 결제는 구현하지 마.
```

