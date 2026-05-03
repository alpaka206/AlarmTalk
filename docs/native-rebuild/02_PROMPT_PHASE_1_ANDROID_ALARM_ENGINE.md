# Prompt: Phase 1 Android Alarm Engine

다음 프롬프트를 새 Codex 작업 시작 시 그대로 사용한다.

```text
C:\Users\gyuwo\Desktop\voice_alarm_native_rebuild 에서 작업해줘.

docs/native-rebuild/00_GOAL.md, docs/native-rebuild/01_ROADMAP.md, NATIVE_REBUILD_PROMPT.md를 먼저 읽고 진행해.

이번 작업 범위는 Phase 1: Android Alarm Engine만이다.

apps/android-native/에 Kotlin + Jetpack Compose + Material 3 기반 Android 네이티브 프로젝트를 만들고, 실제 Android 알람 엔진 PoC를 구현해줘.

완료 기준:
1. 앱에서 1~5분 뒤 테스트 알람을 생성할 수 있다.
2. AlarmManager로 OS 정확 알람을 등록한다.
3. 앱 foreground/background 상태에서 울린다.
4. 화면 꺼짐/잠금화면에서 울린다.
5. Doze/idle 상태에서도 울린다.
6. full-screen ringing 화면이 열린다.
7. bundled 기본 알람음이 반복 재생된다.
8. 진동이 반복된다.
9. dismiss 전까지 멈추지 않는다.
10. snooze가 동작한다.
11. BootCompletedReceiver가 로컬 저장된 알람을 재등록한다.
12. adb/logcat/dumpsys 기반 실기기 검증 절차를 문서화한다.

이번 단계에서는 로그인, 음성 프로필, TTS, 가족/연인, 캐릭터, 결제 기능은 구현하지 마.

알람은 서버 cron이나 push notification에 의존하면 안 된다.
울리는 시점에는 네트워크 fetch 없이 로컬 데이터와 로컬 오디오만 사용해야 한다.
```

