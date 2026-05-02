# Prompt: Phase 7 iOS Native

```text
C:\Users\gyuwo\Desktop\voice_alarm_native_rebuild 에서 작업해줘.

Android MVP가 안정화됐다는 전제에서 진행해.
docs/native-rebuild/00_GOAL.md와 docs/native-rebuild/01_ROADMAP.md를 읽고, 이번 작업은 Phase 7: iOS Native Implementation이다.

먼저 SwiftUI + AlarmKit PoC를 구현하고 제한을 문서화해.

검증 범위:
1. 1회 알람
2. 반복 알람
3. snooze
4. dismiss
5. 커스텀 로컬 음성 파일 사용 가능 여부
6. 잠금화면 동작
7. 앱 종료/백그라운드 상태 동작

AlarmKit으로 불가능한 부분은 Android와 억지로 동일하게 맞추지 말고, iOS 제약에 맞춘 UX 대안을 제안해.
Critical Alert entitlement는 기본 전제로 두지 말고, AlarmKit 한계를 확인한 뒤 별도 옵션으로 검토해.
```

