# Prompt: Phase 4 Backend Integration

```text
C:\Users\gyuwo\Desktop\voice_alarm_native_rebuild 에서 작업해줘.

Phase 1~3이 Android 실기기에서 검증됐다는 전제에서 진행해.
docs/native-rebuild/00_GOAL.md와 docs/native-rebuild/01_ROADMAP.md를 읽고, 이번 작업은 Phase 4: Backend Integration만 구현해.

목표:
기존 Cloudflare Workers + Hono + Turso 백엔드를 Android 네이티브 앱에 연결한다.

구현 범위:
1. Android native env/API base 설정
2. Retrofit/OkHttp API client
3. 로그인/회원가입 중 하나를 먼저 안정화
4. 알람 CRUD sync
5. 음성 프로필 목록 조회
6. perso.ai voice clone 요청
7. TTS 생성 요청
8. TTS 응답 오디오 다운로드/로컬 캐싱
9. 오프라인 상태에서도 이미 예약된 알람은 울리도록 보장
10. 백엔드 env 위치와 실행 방법 문서화

알람 울림 경로는 절대 서버 cron이나 push notification에 의존하지 마.
```

