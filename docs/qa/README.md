# QA

목표는 하나다. **"알람이 안 울렸다"를 0으로.** 나머지는 전부 부차적이다.

- 릴리스 전 실기기 회귀: `apps/android-native/README.md` 의 Physical Device Checklist
- 지금 진행 중인 검증 항목: [`dev-test-handoff.md`](dev-test-handoff.md)
- 2026-10-18 금요일 이후 Sentry 오류와 탈퇴 재시도: [`sentry-followup-2026-10-18.md`](sentry-followup-2026-10-18.md)
- 2026-09-21 Sentry 후속·양 앱 정합성·요청 비용 검토와 수정/실행 결과: [`sentry-and-parity-audit-2026-09-21.md`](sentry-and-parity-audit-2026-09-21.md)
- 2026-08-24 네이티브 출시 점검 결과: [`release-readiness-2026-08-24.md`](release-readiness-2026-08-24.md)
- 자동 테스트: 백엔드 Vitest(+ in-memory libSQL), Android JUnit — CI 에서 돈다

## 테스트 케이스

ID 규칙 `TC-<영역>-<번호>`. **P0 은 릴리스 차단**, P1 은 다음 릴리스 차단, P2 는 여유 있을 때.

### 알람 (ALM)

| ID | 제목 | 절차 | 기대 | P |
|---|---|---|---|---|
| TC-ALM-001 | 1분 뒤 알람 | "+" → 지금+1분 → 저장 | 정확히 그 분에 울리고 RingingActivity 표시 | P0 |
| TC-ALM-002 | 요일 반복 | 월~금 선택 → 저장 | 다음 평일로 발사 시각 계산 | P0 |
| TC-ALM-003 | 잠금화면 울림 | 발사 전 화면 잠금 | 화면 깨어나며 잠금화면 위에 RingingActivity | P0 |
| TC-ALM-004 | 비행기모드 | 비행기모드 켜고 대기 | 로컬 캐시로 재생, logcat 에 네트워크 호출 없음 | P0 |
| TC-ALM-005 | Doze | `adb shell dumpsys deviceidle force-idle` | 제시각에 울림 | P0 |
| TC-ALM-006 | 스누즈(5분) | 스누즈 탭 | 정확히 5분 뒤 알람 재등록 | P0 |
| TC-ALM-007 | 해제 | 해제 탭 | 서비스 종료, 1회성=비활성 / 반복=다음날 등록 | P0 |
| TC-ALM-008 | 부팅 복원 | 알람 예약 → 재부팅 | `dumpsys alarm` 에 활성 알람 전부 복귀 | P0 |
| TC-ALM-009 | 공휴일 끄기 | 공휴일 끄기 켠 뒤 공휴일에 알람 | 그날은 건너뜀 | P2 |
| TC-ALM-011 | 스와이프 삭제 | 왼쪽 스와이프 → 확인 | 목록·Room·AlarmManager 에서 모두 제거 | P1 |
| TC-ALM-012 | ON/OFF 토글 | 카드 스위치 탭 | OFF=OS 예약 취소, ON=재등록 | P0 |
| TC-ALM-013 | 버킷 회전 재생 | 무료 버킷 알람 발사 → 해제 후 재발사, 별도로 스누즈 1회 | 해제하면 버킷의 다음 클립(+1), 스누즈는 같은 클립 재생 | P1 |
| TC-ALM-014 | 사전렌더 비행기모드 발사 | 유료 클론 목소리(사전렌더 완료) → 비행기모드 → 발사 대기 | 로컬 사전렌더 클립으로 울리고 네트워크 없음, 들리는 문구가 해당 카테고리·변형의 예상 문구와 일치 | P0 |

### 목소리 (VOC)

| ID | 제목 | 절차 | 기대 | P |
|---|---|---|---|---|
| TC-VOC-001 | 최소 길이 녹음 | 12초를 갓 넘겨 녹음 → 정지 | 프로필이 `ready` 로 전환 | P0 |
| TC-VOC-002 | 길이 상한 초과 업로드 | 2분(+허용오차 5초)을 넘는 파일 업로드 | 트림 없이 거절(클론 오디오 한도는 12초~2분 — `voice-profile.ts` 의 MIN/MAX_CLONE_DURATION_MS, 앱은 `VoiceProfileAudioLimits`). 30초는 알람 로컬 오디오(`AlarmAudioLimits`) 상한이라 여기와 무관하다 | P0 |
| TC-VOC-003 | 슬롯 상한 | 상한을 넘겨 클론 생성 시도 | `VOICE_LIMIT_REACHED` 안내, 녹음 차단 | P1 |
| TC-VOC-004 | 공유 없음 | 목소리 탭·편집기의 목소리 고르기를 연다 | 내 목소리와 기본 목소리만 보인다. 공유 토글·'공유받은 목소리' 묶음이 없다 | P1 |
| TC-VOC-005 | 마이크 거부 | 권한 거부 후 녹음 탭 | 권한 안내 + 시스템 설정 딥링크 | P0 |
| TC-VOC-006 | 이름 변경 | 이름 수정 → 저장 | PATCH 200, 목록 갱신 | P1 |

### 문구/TTS (TTS)

| ID | 제목 | 절차 | 기대 | P |
|---|---|---|---|---|
| TC-TTS-001 | 같은 입력 = 캐시 히트 | 같은 (프로필, 문구, 언어)로 두 번 저장 | 첫 번째만 provider 합성, 두 번째는 R2 읽기만 | P0 |
| TC-TTS-002 | 기본 문구 | 문구 선택기에서 '직접 입력' 대신 기본/고정 문구 컨텍스트 선택 | 편집기에 문구 입력란이 뜨지 않고 그대로 저장 성공, 발사 때 서버 스톡 클립 문구가 재생 | P1 |
| TC-TTS-003 | 직접입력 월 쿼터 | 월 한도(플러스 30, KST 월 경계) 소진 후 1회 더 저장 | 429 `MANUAL_TTS_QUOTA_EXCEEDED`, `manual_quota.remaining=0`, UI 에 쿼터 안내 | P1 |
| TC-TTS-004 | 목소리 전용 울림 | 목소리 전용 알람 발사 | 로컬 파일 재생, fetch 없음 | P0 |
| TC-TTS-005 | 초장문 | 상한 근처 길이로 시도 | 서버가 사유와 함께 400 | P2 |
| TC-TTS-006 | 날씨 미해결 폴백 | 클론 날씨 알람에서 48시간 준비창 내내 오프라인 → 발사 | 무음·오답('맑음') 대신 마지막 안내 클립("날씨를 못 확인했어요") 재생 | P1 |

### 인증 (AUTH)

| ID | 제목 | 절차 | 기대 | P |
|---|---|---|---|---|
| TC-AUTH-001 | 이메일 로그인 | 정상 자격증명 | 200, SessionStore 에 JWT 저장 | P0 |
| TC-AUTH-002 | 잘못된 비밀번호 | 틀린 자격증명 | 401, 어느 필드가 틀렸는지 새지 않는 일반 메시지 | P0 |
| TC-AUTH-003 | 구글 로그인 | Google ID 토큰 전달 | 계정 생성/연결 후 로그인 | P0 |
| TC-AUTH-004 | JWT 만료 | TTL(`lib/jwt.ts` 의 `DEFAULT_TTL_SECONDS` = 365일)을 넘긴 토큰. 90일은 만료가 아니라 롤링 갱신을 시작하는 임계값이다 | 401, 앱이 재로그인 유도 | P1 |
| TC-AUTH-004b | 세션 롤링 | 앱 실행 → `GET /auth/me` | 새 토큰이 내려오고 만료가 뒤로 밀린다 | P1 |
| TC-AUTH-005 | 회원 탈퇴 | DELETE /api/user/me | 연쇄 삭제, R2 목소리 오브젝트 삭제 큐 적재 | P1 |

### 커플·가족 이용권 폐지 회귀 (GRP, 2026-10-20)

커플·가족 이용권과 초대 코드·목소리 공유·가족 알람을 없앤 출시(1.2.16)에서 본다. 옛 앱은 강제 업데이트 전까지 남는다.

| ID | 제목 | 절차 | 기대 | P |
|---|---|---|---|---|
| TC-GRP-001 | 받은 가족 알람 변환 | 1.2.15 에서 가족 알람을 받아 둔 기기(dev)를 1.2.16 으로 업데이트 → 알람 탭 | 그 알람이 내 알람으로 남는다(시각·요일 그대로). 목소리는 내 목소리, 없으면 기본 목소리 미나. 울려 보면 그 목소리로 난다 | P0 |
| TC-GRP-002 | 옛 앱 호환 | 1.2.15 로 새 서버에 로그인 → 알람·목소리·더보기·이용권 화면을 오간다 | 오류 배너·스낵바가 없다. 이용권 화면이 플러스 구독 상태를 그대로 보여 준다 | P0 |
| TC-GRP-003 | 옛 앱의 초대 코드 등록 | 1.2.15 더보기 → 초대 코드 등록에 아무 코드 | 404 `CODE_NOT_FOUND` → "잘못된 코드" 안내. Sentry 이슈가 생기지 않는다 | P1 |
| TC-GRP-004 | 새 앱 화면 | 1.2.16 의 이용권·더보기·목소리·편집기 | 커플·가족 카드, 초대 코드 등록, 공유 토글, 받은 알람 표시가 없다 | P1 |

### 결제 (BILL)

| ID | 제목 | 절차 | 기대 | P |
|---|---|---|---|---|
| TC-BILL-001 | 플러스 구독 | 스토어에서 플러스 구매 | 구독 생성, 플랜 상향 | P1 |
| TC-BILL-002 | 만료 처리 | 만료 강제 → cron 틱 | 상태 `expired`, 플랜 free | P1 |
| TC-BILL-003 | 없앤 상품 | 확정 요청에 커플·가족 상품 id(`couple_monthly`·`family_monthly`) | 400 `UNKNOWN_PRODUCT`, 스토어 호출 없음 | P2 |

### 동기화 (SYNC)

| ID | 제목 | 절차 | 기대 | P |
|---|---|---|---|---|
| TC-SYNC-001 | 알람 탭 진입 동기화 | 로컬 알람 3개 수정 → 다른 탭으로 이동 → 60초 지난 뒤 알람 탭 재진입(진입 시 자동 실행, 60초 스로틀) | 3행 반영, 서버와 일치 | P1 |
| TC-SYNC-002 | 서버 반영 | A 기기에서 알람 수정 → 동기화 | 서버 행이 A 와 일치. 다른 기기로는 내려가지 않는다(내 알람은 기기 로컬이 원본이다) | P1 |
| TC-SYNC-003 | 통신 장애 중 울림 | 울리는 동안 네트워크 차단 | 로컬 알람 정상 울림, 큐잉된 동기화는 복구 후 재개 | P0 |

### 보안 (SEC)

| ID | 제목 | 절차 | 기대 | P |
|---|---|---|---|---|
| TC-SEC-001 | 레이트 리밋 | `middleware/rateLimit.ts`의 `MAX_REQUESTS`를 초과해 요청 | 429 `RATE_LIMITED` | P1 |
| TC-SEC-002 | 과대 바디 | `middleware/bodyLimit.ts`의 `MAX_BODY_BYTES`를 초과한 바디 | 413 | P1 |
| TC-SEC-003 | 클라 내 키 노출 | 빌드 산출물 grep | API 키 문자열 없음 | P0 |
| TC-SEC-004 | HTTPS 전용 | http:// 접근 | https:// 로 리다이렉트 | P0 |

### 접근성·다국어 (A11Y / I18N)

| ID | 제목 | 기대 | P |
|---|---|---|---|
| TC-A11Y-001 | TalkBack | 모든 카드/버튼에 읽히는 라벨 | P1 |
| TC-A11Y-002 | 글꼴 200% | 레이아웃 안 깨짐 | P2 |
| TC-A11Y-003 | 다크 모드 | 대비 4.5:1 이상, 토큰 일관 | P1 |
| TC-I18N-001 | 영어 전환 | 모든 화면 번역, 레이아웃 유지 | P1 |
| TC-I18N-002 | 언어별 폰트 | Pretendard / Noto 폴백 정상 | P2 |

## E2E 시나리오 (수동)

**TS-1. 신규 가입 → 첫 울림** (유료 계정 전제)
가입(8자 이상 비밀번호) → 알림·정확한 알람·전체화면 권한 허용 → **결제로 유료 플랜을 먼저 붙인다**(무료는 내 목소리 녹음·업로드와 그 목소리 알람이 `VOICE_FEATURE_REQUIRES_PAID_PLAN` 로 막힌다) → 목소리 탭에서 15초 녹음 → 알람 탭에서 지금+2분·목소리+기본 문구로 저장 → 화면 잠금 후 대기.
기대: 전체화면으로 울리고, 해제하면 소리·진동 정지.

**TS-3. 서버 장애 내성**
알람 3개 예약된 상태에서 백엔드를 내림 → 앱 시작 시 목록 로드 실패 배너 → 발사 시각 도달.
기대: 정상 울림·해제 가능. 백엔드 복구 후 알람 탭에 다시 들어가면(진입 시 동기화가 자동 실행된다) 큐가 플러시되고 배너가 사라진다.

**TS-4. 탈퇴**
더보기 탭 → 회원 탈퇴 → 확인.
기대: 200, 연쇄 삭제 완료, R2 목소리 삭제 큐 적재. 같은 이메일 재가입 시 빈 상태로 시작.

**TS-5. 부팅 복원 (기기별)**
지금+10분 1회성 알람 예약 → 재부팅 → `adb shell dumpsys alarm | grep com.alarmtalk.app`.
기대: 재등록됨. 로그에 `Restore receiver invoked`, `Boot restore complete`.

## 버그 우선순위

| P | 기준 | 대응 |
|---|---|---|
| P0 | 알람 미발사, 데이터 유실, 보안 문제 | 즉시 핫픽스, 릴리스 보류 |
| P1 | 핵심 플로우 파손(로그인, 동기화) | 다음 릴리스 차단 |
| P2 | UX 결함, 복구 가능한 문제 | 몇 릴리스 안에 |
| P3 | 제안, 다듬기 | 백로그 |

## 로그·산출물 수집 (Android)

```bash
adb logcat -c
adb logcat | grep AlarmTalk > logcat.txt
adb shell dumpsys alarm | grep com.alarmtalk.app > alarms_dump.txt
adb bugreport bugreport_$(date +%Y%m%d_%H%M%S).zip
```

Room DB 를 직접 까야 할 땐 `.db`·`-wal`·`-shm` 세 파일을 **force-stop 후에** 같이 꺼낸다.

### 기기 Room DB 들여다보기 (실측 메모)

로컬 알람 id·상태를 확인할 때 쓴다. 실패 방식이 전부 **조용해서** 순서를 지켜야 한다.

- **세 파일을 같이, 따로 꺼낸다.** 아직 체크포인트 안 된 변경은 전부 `-wal` 에 있어서 `voice-alarm.db` 만 pull 하면 방금 만든 알람이 안 보인다(행 0개로 보인 적 있음). sqlite 는 세 파일이 **같은 폴더에 같은 이름으로 나란히** 있어야 `-wal` 을 반영한다.
- **`cat ...db{,-wal,-shm} > 한파일` 로 묶지 말 것.** 에러 없이 조용히 틀린다 — 합친 파일은 헤더의 페이지 수만큼만 읽히고 뒤 바이트는 통째로 무시된다(실측: 481,688바이트 중 앞 32,768바이트만 DB 본체). 결국 `.db` 만 꺼낸 것과 같은 '마지막 체크포인트' 스냅샷이 된다.
- **꺼내기 전에 앱을 멈춘다.** 복사 도중 Room 이 체크포인트·WAL 리셋을 하면 서로 다른 시점의 파일 셋이 만들어져 최근 알람이 빠지거나 `no such table` 이 난다. force-stop 이 WAL 을 접어 주므로 그 뒤로는 파일 셋이 얼어 있다.
- ⚠ **force-stop 은 OS 알람 예약을 지운다.** Room 행은 남지만 AlarmManager 예약(PendingIntent)이 날아가 그대로 두면 **안 울린다**. Android 15 부터 문서화된 동작이고([stopped state](https://developer.android.com/about/versions/15/behavior-changes-all#stopped-state)), 실측하면 **Android 13 에서도 이미 그렇다**(A32: 07:00 알람 켬 → `Next alarm clock … 07:00` → force-stop → 해당 줄이 빔 → 앱 재실행 → `Boot restore complete pending=1 scheduled=1` 과 함께 복귀).

순서: ① 관찰하려던 동작을 **끝내고**(결과가 Room 에 써진 뒤) → ② force-stop + 3파일 추출 → ③ **앱 재실행해 예약 복구**(로그 `Boot restore complete pending=N scheduled=N`, `adb shell dumpsys alarm` 의 `Next alarm clock information` 확인).

```powershell
$dst = '<받을 폴더>'
adb -s <serial> shell am force-stop com.alarmtalk.app.dev   # ← 반드시 먼저
foreach ($f in 'voice-alarm.db','voice-alarm.db-wal','voice-alarm.db-shm') {
  adb -s <serial> shell "run-as com.alarmtalk.app.dev cat /data/data/com.alarmtalk.app.dev/databases/$f > /data/local/tmp/$f"
  adb -s <serial> pull "/data/local/tmp/$f" "$dst\$f"
}
adb -s <serial> shell monkey -p com.alarmtalk.app.dev -c android.intent.category.LAUNCHER 1  # ← 예약 복구
```

`>` 는 반드시 **바깥 adb 셸**이 처리하게 둔다(위 형태). `run-as ... sh -c '... > /data/local/tmp/...'` 로 감싸면 앱 uid 로 쓰게 돼 `Permission denied` 다 — /data/local/tmp 는 shell uid 만 쓸 수 있다.
그 뒤 `python -c "import sqlite3; ..."` 로 `$dst\voice-alarm.db` 를 열면 `-wal` 이 자동 반영된다.
