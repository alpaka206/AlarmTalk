# 알람의 생애 — 계정 경계와 예약

알람은 **두 겹**이다. 이 문서는 그 둘을 가르는 규칙만 다룬다.

| 겹 | 무엇 | 어디 있나 |
| --- | --- | --- |
| **행(row)** | 사용자가 만든 알람. `enabled` 는 **사용자 의도**다 | 앱 저장소(안드 Room / iOS JSON 파일) |
| **예약(schedule)** | OS 에 건 발사 요청. **수단**이다 | 안드 `AlarmManager` / iOS AlarmKit |

⚠ **둘을 같은 것으로 다루면 사고가 난다.** 예약만 끊으면 화면은 켜졌다고 말하는데 안
울리고, 행만 지우면 OS 예약이 남아 **없는 알람이 운다.**

---

## 1. 공통 규칙 — 세 구현이 모두 지킨다

### 1-1. 계정을 떠나면 알람을 끈다

로그아웃·탈퇴 신청·계정 삭제에서 **예약을 취소하고 행도 `enabled = false`** 로 둔다.

- **왜 예약을 끊나** — 로그아웃 상태에서는 알람 화면에 **들어갈 수도 없다**(로그인 게이트).
  예약이 남으면 사용자가 **끌 방법이 없는 알람**이 운다. 받은 알람은 보낸 사람의 복제
  목소리를 담고 있어, 떠난 기기가 남의 생체정보로 우는 셈이 된다.
- **왜 행도 끄나** — 로그아웃은 **이 앱을 그만 쓰겠다**는 뜻이다. 목소리는 서버에 있어
  로그아웃하면 핵심 기능을 못 쓰고 그동안 알람도 울리지 않는다. 그렇게 지내다 돌아왔는데
  옛 알람이 저절로 울리기 시작하는 편이 오히려 놀랍다(2026-08-19 결정).
- **꺼 두는 것이 안전한 이유** — **돌아왔을 때** 홈 headline 이 "모든 알람이 꺼진
  상태입니다." 라고 말한다. 조용히 꺼져 있으면 못 일어나지만, 보이면 사용자가 고른다.

⚠ **자동 401(세션 만료)은 여기 해당하지 않는다.** 토큰이 낡은 것뿐이라 사용자가 그만두겠다고
한 적이 없다 — 그걸로 내일 아침 알람을 없애면 안 된다.

### 1-2. 목록과 재예약은 **소유자**로 거른다

`ownerUserId == null || ownerUserId == 현재 계정` 인 것만 보이고, 그것만 다시 건다.

- 소유자 미기록(옛 행)은 **현재 계정 것으로 본다** — 저장소의 다른 파괴적 경로
  (무료 잠금·복원·목소리 강등)와 같은 관용이다.
- **로그아웃 상태(계정 없음)에서는 아무것도 보이지 않고 아무것도 재무장하지 않는다.**
  안 그러면 1-1 로 끊어 둔 것을 복구 sweep 가 곧바로 되살려 그 조치가 무의미해진다.

### 1-3. 삭제는 **예약을 먼저** 끊는다

행을 먼저 지우면 예약을 취소할 핸들을 잃어 **지운 알람이 계속 운다.** 취소 → 삭제 순서.

### 1-4. `.failed` 는 "사용자가 할 일이 있을 때" 만 쓴다

이 상태는 행에 빨간 "알람을 다시 예약하지 못했어요. 시간을 확인하고 다시 저장해 주세요."
를 띄운다. 그러므로 **정말 사용자가 손대야 하는 경우에만** 쓴다.

| 상황 | `.failed` | 왜 |
| --- | --- | --- |
| 만료된 1회성 알람을 되살릴 수 없다 | **쓴다**(끄고 함께) | 시각을 고쳐야 한다 — 문구가 정확히 그 말이다 |
| 켜기를 시도했다 실패해서 **되돌려 껐다** | **쓰지 않는다** | 그 자리에서 이미 알렸다. 낙인만 남는다 |
| 서버 동기화 실패 | **쓰지 않는다** | 다음 회차가 재시도한다 — 사용자가 할 일이 없다 |
| 무료 강등으로 알람음이 됐다 | **쓰지 않는다** | 알람은 정상 작동 중이다(1회성 모달이 알린다) |

⚠ **꺼진 알람에 낙인을 남기면 영영 지워지지 않는다.** 재예약 sweep 는 **켜진 알람만**
후보로 잡기 때문이다 — 사용자가 직접 열어 다시 저장할 때까지 빨간 경고가 붙어 있다
(2026-08-19 iPhone 실기기에서 그 상태의 알람을 확인했다).

### 1-5. 앱 업데이트는 알람을 지우지 않는다

행은 앱 데이터 컨테이너에 있어 업데이트를 넘어 살아남는다. **예약은 별개**이므로,
시작·전경 복귀의 재예약 sweep 가 `enabled && 예약 없음` 을 보고 다시 건다.

---

## 2. 플랫폼별로 따로 지킬 것

### iOS (AlarmKit)

- **예약에 실린 소리는 예약 시점에 확정된다.** 발사 순간 우리 코드가 돌지 않으므로,
  행만 고치고 재예약을 빠뜨리면 **행과 실제 소리가 갈라진다**(옛 목소리가 그대로 운다).
  → `scheduledSoundFingerprint` 로 지문을 남기고 `AlarmScheduleReconciler` 가 대조한다.
- **예약 취소는 우리가 든 핸들(`alarmKitID`)로만 된다.** 핸들을 잃으면 **취소할 수 없는
  고아 예약**이 남는다. 그래서 예약을 끊을 때는 핸들도 같이 비운다.
- `AlarmManager.shared.alarms` 가 **권위**다. 캐시된 스냅샷으로 "아직 예약돼 있는가" 를
  판단하지 말 것 — emit 이 늦는 창에서 잘못 답한다.

### 안드로이드 (AlarmManager)

- **`AlarmReceiver` 가 Room 을 직접 읽어 운다.** 화면과 무관하므로 행이 살아 있으면
  목록에서 감춰져 있어도 울린다 — 계정을 떠날 때 예약을 끊어야 하는 이유가 여기서 더 세다.
- 울릴 때 DB 를 다시 읽으므로, 행을 고치면 **재예약 없이도** 다음 울림에 반영된다
  (iOS 와 반대다 — 위 첫 항목).

---

## 3. 확인된 차이 — **맞춰야 할 것**

| 차이 | 지금 | 판단 |
| --- | --- | --- |
| 만료된 1회성 알람을 못 살릴 때 | 안드로이드는 `enabled=false + FAILED` 로 남겨 "시각을 고쳐 달라" 고 말한다. iOS 는 **조용히 건너뛴다**(`prepareForScheduleRecovery` 가 nil) | 안드로이드가 맞다 — iOS 는 사용자가 왜 안 울렸는지 알 방법이 없다. **iOS 를 맞출 것** |
| 행 경고 판정 | 양쪽 다 `state == FAILED` 만 본다(`enabled` 를 안 본다) | 1-4 의 낙인 규칙을 지키면 이 조합이 생기지 않는다. 방어로 둘 다 `enabled` 를 함께 보는 편이 낫다 |

---

## 구현 지도

| 규칙 | 백엔드 | 안드로이드 | iOS |
| --- | --- | --- | --- |
| 1-1 계정 떠날 때 끄기 | — | `data/AlarmRepository.detachAlarmsOnSignOut` | `AlarmKitViewModel.stopAllScheduledAlarms` ← `AuthViewModel.onLeaveAccountStopAlarms` |
| 1-1 자동 401 은 제외 | — | `AuthSessionStore` 주석의 자동/명시 구분 | `signOut(revokeOnServer:)` 는 훅을 부르지 않음 |
| 1-2 목록 소유자 필터 | — | `data/AlarmDao` 의 `(ownerUserId IS NULL OR ownerUserId = :callerUserId)` | `LocalAlarmStore.alarms(visibleTo:)` |
| 1-2 재예약 소유자 필터 | — | `AlarmRepository.cancelAlarmsNotOwnedBy` · `reschedulePendingAlarms` | `AlarmKitViewModel.recoverScheduledAlarms(store:ownerUserId:)` |
| 1-3 삭제는 취소 먼저 | — | `AlarmRepository.deleteAlarmLocked` | `AlarmKitViewModel.cancel(record:store:)` |
| 1-4 `.failed` 낙인 규칙 | — | `AlarmRepository` 의 두 `AlarmStates.FAILED` 자리 | `LocalAlarmStore.markFailed` 의 `enabled` 가드 |
| 1-4 행 경고 문구 | — | `ui/components/ControlsAndPermissions.alarmRowNotice` | `Views/Alarms/AlarmRow.rowNotice` |
| 1-5 업데이트 뒤 재예약 | — | `AlarmRepository.reschedulePendingAlarms` | `AlarmKitViewModel.recoverScheduledAlarms` |
| iOS 소리 지문 | — | (해당 없음) | `AlarmScheduleReconciler.scheduledFingerprint` |
| 회귀 테스트 | — | — | `AlarmTalkTests/InaccessibleVoiceReconcileTests.swift`(`LeaveAccountAlarmTests`) |
