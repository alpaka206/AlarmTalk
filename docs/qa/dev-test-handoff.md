# Dev 테스트 핸드오프 (갱신 2026-07-15)

> 세션 재개용 라이브 문서. 상태가 바뀌면 이 파일을 갱신/정리한다. (다른 컴퓨터에서도 `git pull` 후 이 문서만 읽으면 이어서 진행 가능.)

## 1. PR 지도

| PR | 내용 | 상태 |
|---|---|---|
| #541 | 유료 클론 사전렌더 전체(백엔드 + 클라 오프라인 소비) | ✅ 머지 |
| #548 | 가족 알람 FCM 즉시배달 + 앱 복귀 즉시 pull + 날씨 미해결 안내 클립(weather 9클립=조건8+안내1), 발사시각 cron 알람푸시 제거, 마이그레이션 #63(token 인덱스)·#64(done requeue) | ✅ 머지 + dev 배포됨 |
| #549 | 등록 미리듣기 관계·호칭 톤 적응 + `preview_text` 영속(마이그레이션 #65), cron 틱당 클립 3→6 | ✅ 머지(2026-07-15, dev 배포) |
| #550 | 선택 시트 민짜 행+구분선 통일, 진동 라벨 한글화 | ✅ 머지(2026-07-15) |

develop 은 #549 머지로 마이그레이션 #65, cron `MAX_CLIPS_PER_TICK=6`.

## 2. 남은 것 = 실기기 검증 체크리스트

### ① 사전렌더 라이브 (dev 배포됨, 유료 계정 필요)
- [ ] 클론 목소리 등록(keep/promote) → cron(`*/5`)이 **21클립** 렌더: greeting 1 / weather 9(조건 8 + 미해결 안내 1) / fortune 5 / love 3 / medication 3, 앱 언어 1개. 틱당 6클립(#549)이라 완성까지 ~20분.
- [ ] 편집기에서 날씨/운세/사랑/약 각각 선택·저장 → 클론 버킷 부착(`hasCompleteCloneBucket`, weather 9개 풀셋 요구).
- [ ] **비행기모드 발사**: 그 목소리 클립 재생 + 잠금화면 문구가 재생 오디오와 같은 인덱스로 일치.
- [ ] 날씨 미해결(준비창에 인터넷 없음) 시 '맑음' 오재생 대신 **마지막 안내 클립**("인터넷이 안 돼서 날씨를 미리 확인 못 했어요" 톤) 재생.

### ② FCM 가족 알람 즉시배달
- [ ] 양 폰 모두 앱 1회 실행(토큰 등록: `POST /api/push/register`) → S23 발신, **A32 백그라운드**에서 수 초 내 수신(data-only push → 즉시 pull → Room 반영 + 수신 알림).
- [ ] 로그아웃 시 언레지스터(`/api/push/unregister`) 동작.
- [ ] 탈퇴 철회 후 재로그인 시 토큰 재등록.
- (폴백: 앱 포그라운드 복귀 시 60초 스로틀 즉시 pull + 15분 WorkManager 주기는 그대로 살아있음.)

### ③ 울림화면(RingingActivity) 실발사
- [ ] 실제 알람 발사로 잠금화면 위에 뜨는지(문구 표시·노브 화살표 포함). `am start` 는 exported=false 라 차단 — 실발사 필요.
- **규칙: 18시 이전엔 알람 울리게 하지 말 것.** 설정은 OK, 발사는 18시 이후.
- 무음·무진동 발사법: A32 알람볼륨 0 + 진동패턴 OFF로 생성 → `adb shell am broadcast -a com.alarmtalk.app.action.ALARM_TRIGGER --es com.alarmtalk.app.extra.ALARM_ID <id> -n com.alarmtalk.app.dev/com.alarmtalk.app.alarm.AlarmReceiver`. 로컬 id는 `adb exec-out run-as ... cat databases/voice-alarm.db` 로 뽑아 python sqlite3.

### ④ #549 머지 후 — 등록 미리듣기
- [ ] 미리듣기 문구가 관계·호칭에 톤 적응돼 생성되는지.
- [ ] 재생 결정성: 같은 draft 재생 시 저장된 `preview_text` 재사용(재생성 없음), 동시 첫-미리듣기 레이스에서도 문구 1개로 수렴.

## 3. 예정 기능 (미구현)

1. **미리듣기 문구 표시 + 수정**: 등록 미리듣기에서 생성된 문구를 화면에 보여주고 수정 가능하게. 수정한 문구는 이후 프리셋 생성 스타일 참고로 사용.
2. **프리셋 준비중 게이트**: 사전렌더가 아직 안 끝난 목소리는 문구 선택기에서 해당 항목 비활성 + "준비 중" 안내. 직접 입력은 항상 가능.

## 4. 환경 주의 (이 PC)

- **WSAEFAULT(10014)**: 소켓 bind/listen 간헐 실패로 Gradle 데몬·adb 기동 실패 → 성공까지 재시도. adb가 아예 죽으면 라온 보안 드라이버 정지(관리자): `Stop-Service AnySign4PC Launcher, MagicLine4NXSVC, 'RAON K', WizveraPMSvc` + `sc stop KingsNET` `sc stop TNXNET_SVR` → `adb start-server`. 상세=메모리 `reference_winsock_wsaefault_build_workaround`.
- **K2 캐스케이드**: 같은 모듈 멀쩡한 심볼이 무더기 "Unresolved reference" → clean 재빌드로 해결.
