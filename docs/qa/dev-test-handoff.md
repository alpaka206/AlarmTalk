# Dev 테스트 핸드오프 (갱신 2026-07-29)

> 세션 재개용 라이브 문서. 상태가 바뀌면 이 파일을 갱신/정리한다. (다른 컴퓨터에서도 `git pull` 후 이 문서만 읽으면 이어서 진행 가능.)

## 0-1. 2026-07-29 — 계정 전환 소유권 스코프(#655) 실기기 검증 완료

#646/#650/#654 에서 이어진 "같은 기기에 앞 계정 알람이 남는다" 계열 결함 6건(Codex P1 2 + 형제 4)을
#655 로 고치고, **S23 + A32 두 대로 계정 전환 시나리오를 실측**했다. 전부 통과.

계정: **A = gyuwon05(김규원)**, **B = alpaka206(알파카)**, **가족 발신자 = devrel.365(rel dev)**.
시나리오: A 로 06:00 클론목소리(고죠) 알람 생성(미업로드 `local_only`) → 로그아웃 → B 로그인 →
B 로 같은 06:00 알람 생성 → A 로 복귀 → A32(rel dev)에서 A 에게 06:00 가족알람 발송.

| 검증 항목 | 관측 결과 |
|---|---|
| 아웃바운드 동기화 소유자 스코프 | B 세션에서 `Backend alarm sync complete total=0` — A 의 `local_only` 행이 **B 의 JWT 로 안 올라감**. A 복귀 시 `total=1 created=1` 로 **A 계정에 정상 업로드**(유실 아님, 지연) |
| 목소리 강등 소유자 스코프 | B 의 refreshSocial·주기 워커가 돌아도 A 행의 `voiceProfileId`·`playMode=alarm_voice`·캐시 mp3 **전부 무손상** |
| 같은 시각 충돌 판정 스코프 | B 가 A 와 **같은 06:00 에 중복 경고 없이 저장** 성공(예전엔 안 보이는 A 알람이 시각을 막음) |
| 가족알람 같은 시각 양보 스코프 | `Disabled same-time alarm id=f0dd66ab…`(=A 본인 행, 의도된 양보)만 발생. **B 소유 행은 `enabled=1` 유지** — 예전엔 여기서 꺼져 B 가 재로그인해도 영영 안 울렸다 |
| 로그인/로그아웃 정리 | `Cancelled 1 alarm reservations owned by another account`, `Rescheduled 1 alarms after sign-in` 정상 |

검증법 메모: Room DB 는 **WAL 까지 같이**, 그리고 **파일별로 따로** 꺼내야 한다. 아직 체크포인트되지
않은 변경은 전부 `-wal` 에 있어서, `voice-alarm.db` 만 pull 하면 방금 만든 알람이 안 보인다(이 세션에서
실제로 한 번 걸렸다 — 행 0개로 보였다). sqlite 는 세 파일이 **같은 폴더에 같은 이름으로 나란히** 있어야
`-wal` 을 반영한다.

주의: `cat ...voice-alarm.db{,-wal,-shm} > 한파일` 로 묶으면 **에러 없이 조용히 틀린다**. 합친 파일은
헤더의 페이지 수만큼만 읽히고 뒤에 붙은 `-wal`·`-shm` 바이트는 통째로 무시돼(실측: 481,688바이트 중
앞 32,768바이트만 DB 본체), 결국 `.db` 만 꺼낸 것과 똑같은 '마지막 체크포인트 시점' 스냅샷이 된다.
열리기는 하니 잘못된 줄 모르고 지나가기 쉽다.

```powershell
$dst = '<받을 폴더>'
foreach ($f in 'voice-alarm.db','voice-alarm.db-wal','voice-alarm.db-shm') {
  adb -s <serial> shell "run-as com.alarmtalk.app.dev cat /data/data/com.alarmtalk.app.dev/databases/$f > /data/local/tmp/$f"
  adb -s <serial> pull "/data/local/tmp/$f" "$dst\$f"
}
```

`>` 는 반드시 **바깥 adb 셸**이 처리하게 둔다(위 형태). `run-as ... sh -c '... > /data/local/tmp/...'`
로 감싸면 앱 uid 로 쓰게 돼 `Permission denied` 다 — /data/local/tmp 는 shell uid 만 쓸 수 있다.

그 뒤 `python -c "import sqlite3; ..."` 로 `$dst\voice-alarm.db` 를 열면 -wal 이 자동 반영된다.

**prod 마이그레이션**: #646 머지 후 main 배포에서 **79→86 전부 적용 확인**(무음 스킵 없음).

## 0. 2026-07-21 — #599 목소리 슬롯 상한(F1/F2/F3) 머지 + 검증 완료

- **#599 머지됨**(Codex 6차 클린 + CI 그린): 전역 클론 슬롯 상한(`MAX_PROVIDER_CLONE_VOICES=50`, voice-slots.ts 숫자 하나로 조정) + LRU eviction(공유/draft 보호) + 기본 목소리 선택 시 유료도 날씨+약만(F2) + evict된 보이스 TTS 요청 시 R2 원본 자동 재클론(F3). 마이그레이션 #75(last_used_at/evicted_at).
- **실기기 검증 완료(S23, dev cap=2 임시 하향으로 실측)**: 클론 등록(홍길동)→promote→SQL evict→가짜 활성 2개로 상한 채움→알람 저장 시 `/tts/generate`가 자동 재클론(새 provider id 발급·in-place 복원)→LRU(가장 오래된 것)만 evict·최신 보존→삭제 큐 적재→cron 실삭제까지 엔드투엔드 확인. F2 UI(기본 목소리=날씨+약만/내 클론=5종 전체), #594 무료 잠금(알람만 강제·데이터 보존)→플랜 복원 시 원복도 확인.
- **남은 것**: 프로드 릴리스(develop→main, versionCode 14, AAB) — 아래 §2 체크리스트 중 A32 필요 항목(FCM 즉시배달 등)과 실발사(18시 이후)는 미완. A32는 이번 세션에 adb 미인식(재연결 필요).

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
- 무음·무진동 발사법: A32 알람볼륨 0 + 진동패턴 OFF로 생성 → `adb shell am broadcast -a com.alarmtalk.app.action.ALARM_TRIGGER --es com.alarmtalk.app.extra.ALARM_ID <id> -n com.alarmtalk.app.dev/com.alarmtalk.app.alarm.AlarmReceiver`. 로컬 id는 §0-1 의 DB 추출 블록(`.db`·`-wal`·`-shm` 세 파일)으로 뽑아 python sqlite3 — `.db` 만 꺼내면 방금 만든 알람이 안 보인다.

### ④ #549 머지 후 — 등록 미리듣기
- [ ] 미리듣기 문구가 관계·호칭에 톤 적응돼 생성되는지.
- [ ] 재생 결정성: 같은 draft 재생 시 저장된 `preview_text` 재사용(재생성 없음), 동시 첫-미리듣기 레이스에서도 문구 1개로 수렴.

## 3. 예정 기능 (미구현)

1. **미리듣기 문구 표시 + 수정**: 등록 미리듣기에서 생성된 문구를 화면에 보여주고 수정 가능하게. 수정한 문구는 이후 프리셋 생성 스타일 참고로 사용.
2. **프리셋 준비중 게이트**: 사전렌더가 아직 안 끝난 목소리는 문구 선택기에서 해당 항목 비활성 + "준비 중" 안내. 직접 입력은 항상 가능.

## 4. 환경 주의 (이 PC)

- **WSAEFAULT(10014)**: 소켓 bind/listen 간헐 실패로 Gradle 데몬·adb 기동 실패 → 성공까지 재시도. adb가 아예 죽으면 라온 보안 드라이버 정지(관리자): `Stop-Service AnySign4PC Launcher, MagicLine4NXSVC, 'RAON K', WizveraPMSvc` + `sc stop KingsNET` `sc stop TNXNET_SVR` → `adb start-server`. 상세=메모리 `reference_winsock_wsaefault_build_workaround`.
- **K2 캐스케이드**: 같은 모듈 멀쩡한 심볼이 무더기 "Unresolved reference" → clean 재빌드로 해결.
