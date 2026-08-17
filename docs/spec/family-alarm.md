# 가족 알람 — 남의 기기에서 울리는 알람

> **단일 출처.** 구현이 이것과 다르면 구현이 틀린 것이다. → [README](README.md)

## 1. 보내면 끝이다

가족 알람은 **한 번 보내고 손을 뗀다.**

| | 보낸 사람 | 받은 사람 |
| --- | --- | --- |
| 만들기 | 한다 | — |
| 만든 뒤 고치기 | **못 한다** | 자기 기기에서 자유롭게 |
| 끄기·지우기 | **못 한다** | 한다 |
| 그만받기 | — | 한다(그 사람에게서 오는 알람 차단) |

⚠ **보낸 사람의 목록에 그 알람이 남지 않는다.** 양 앱 모두 가족 알람은 서버로만 보내고
**로컬 행을 만들지 않는다**(`createFamilyTargetAlarm`). 그래서 보낸 사람에게는 고칠 화면
자체가 없다 — 이게 위 표를 지키는 방식이다.

### 1-1. 받은 뒤에는 **전부** 받은 사람 것이다

「자기 기기에서 자유롭게」는 시각만이 아니다. **시각·요일·스누즈·재생 방식·목소리·문구·
볼륨·알람음 — 무엇이든** 받은 사람이 고칠 수 있고, 고친 값은 **영구히** 남는다.

그러니 **서버 값은 처음 받을 때의 씨앗일 뿐이다.** 보낸 사람은 고칠 수단이 없으므로
(위 표), 매 pull 이 서버 값을 다시 입힐 이유가 애초에 없다.

⚠ **'무엇을 지킬지' 를 세지 말 것 — 이 규칙이 깨진 방식은 언제나 같았다.** 재구성이
서버본으로 행을 다시 만들고, '지켜야 할 필드' 목록으로 수신자 값을 덮어썼다. 목록에서
빠진 값이 **여섯 번** 되돌아왔다: 시각 → 끄기 → 스누즈 상태 → 볼륨·알람음(안드로이드,
`2cafd54f`·`850b9032`) → 일정 전체(iOS, `1f195191`) → **재생 방식·문구·목소리**
(양 앱, 2026-08-18).

마지막 것이 가장 오래 숨어 있었다. 가족 알람은 `message_id` 가 **없어서**(보낸 사람은
문구를 정하지 않는다) 서버본에 음성이 없다 → 재구성이 `playMode` 를 `ALARM_ONLY` 로
계산한다 → **받은 사람이 목소리로 바꿔 저장해도 다음 pull 이 알람음으로 되돌린다.**
저장은 됐는데 되돌아가므로 "저장이 안 된다" 가 아니라 "자꾸 알람음으로 바뀐다" 로 겪는다.

**그래서 방향을 뒤집었다: 고쳐진 행에는 손대지 않는다.**

| | 판정 | 그때 하는 일 |
| --- | --- | --- |
| 아직 안 고친 행 | `updatedAtMillis == lastSyncedAtMillis` | 서버본으로 재구성(첫 수신·음성 다운로드 실패분 재시도) |
| 수신자가 고친 행 | `updatedAtMillis > lastSyncedAtMillis` | **아무것도 하지 않는다** |

- 두 시각의 등호가 '아직 안 고침' 의 신호다. pull 이 쓸 때 **같은 값**을 넣고
  (안드로이드 `buildReceivedAlarmRow` 의 `now`, iOS `upsert(_:syncedNow:)`),
  수신자가 저장할 때는 `lastSyncedAtMillis` 를 보존한 채 `updatedAtMillis` 만 올린다
  (`upsertPreservingServerSyncFields`). 이 불변식이 깨지면 판정이 통째로 뒤집힌다.
- `syncState` 로는 못 한다 — 받은 알람은 항상 `synced` 로 파생된다(`nextLocalSyncState`).
- **예외는 목소리 철회뿐이다.** 발신자가 탈퇴하면 고친 행에서도 목소리를 걷어낸다
  (생체정보 파기). 그건 재구성이 아니라 별도 경로다(`withVoiceRevoked`).

**보낸 사람이 뒤늦게 바꾸는 경로는 앱에 없다.** 두 앱 모두 가족 알람은 `createFamilyTargetAlarm`
으로 **만들기만** 하고, 알람 업데이트 요청에는 수신자를 싣지 않는다(iOS `RemoteAlarmMapper`
의 `targetUserId: nil`). 그러니 "발신자 수정을 받아 반영하는" 코드를 새로 만들지 말 것 —
반영할 변경이 애초에 생기지 않는다.

⚠ **딱 하나, 서버가 보낸 알람을 끄는 경우가 있다.** 같은 (수신자, 시각) 슬롯에 새 가족
알람이 오면 백엔드가 그 슬롯의 다른 활성 발신 알람을 `is_active = 0` 으로 내린다
(`alarm-helpers.ts` 의 `claimTargetedAlarmSlot`). 발신자의 '수정' 이 아니라 **같은 시각
중복을 막는 시스템 동작**이다. 그래서 `resolveReceivedRemoteEnabled` 의 원격 끄기 반영은
**죽은 코드가 아니다** — 지우면 남이 보낸 옛 알람이 수신자 기기에 켜진 채 남아 같은 시각에
둘이 운다. (수신자가 고친 행에는 이것도 오지 않는다 — 위 표대로 재구성 자체를 건너뛴다.)

⚠ **수신자의 변경을 서버에 올리지 말 것.** 받은 알람에도 `remoteAlarmId` 가 있지만 그건
**보낸 사람의 행**이다. `PATCH /alarm/:id` 는 소유권 게이트(`WHERE a.id = ? AND a.user_id
IN (...)`)에 걸려 **404** 로 떨어지고, 로컬 저장은 멀쩡한데 화면에는 "알람 변경사항을
저장하지 못했어요" 만 뜬다. 일괄 push 는 `origin == localOwned` 로 거르지만, **단건 push
호출부가 `remoteAlarmId != nil` 만 보고 빠져나간 적이 있다**(iOS 목록의 켜기/끄기 토글,
2026-08-18 수정). 새 push 호출부를 만들면 **origin 을 함께 볼 것.**

⚠ **편집기 안에 '받는 사람 바꾸기' 를 두지 말 것.** 받는 사람은 「누구를 깨울까요?」
시트에서 정해져 편집기로 넘어오고, 그 뒤로 바뀌지 않는다. iOS 에 한때 그 카드가 있었으나
안드로이드에는 없었고 2026-08-07 에 없앴다. 지금 누구에게 저장되는지는 **하단 저장
버튼**이 말한다("저장 · 이름") — 픽커가 없으니 그게 유일한 표시라 이름을 빼면 안 된다.

## 2. 설정 불가능 시간(방해금지)

받는 사람이 "이 시간엔 알람을 받지 않겠다" 고 정해 두는 창이다.

- **평일/주말/매일** 프리셋만 쓴다. 개별 요일 조합은 저장 시 감싸는 프리셋으로 흡수한다
  (거부하지 않는다 — 무관한 시간 편집이 400 나지 않게).
- 창은 **최대 2개**(평일 근무 + 주말 정도). 「누구를 깨울까요?」 행 라벨이 길어지지 않게
  하려는 제약이다.

⚠ **가입만으로 창이 생기지 않는다**(2026-08-08 결정). 어떤 플랜이든 마찬가지다.

예전에는 컬럼 기본값이 `평일 09:00–18:30` 이라, **가입만 하면 아무도 설정한 적 없는
시간대에 가족 알람이 막혔다.** 받는 사람은 자기가 막아 둔 줄 모르고, 보내는 사람은 왜 못
보내는지 모른다. 방해금지는 사용자가 **명시적으로 켜는** 기능이다.

그래서 세 곳이 모두 '없음' 이어야 한다 — 하나라도 기본값을 만들면 되살아난다:

| 자리 | 규칙 |
| --- | --- |
| **가입 INSERT** | `family_alarm_quiet_windows` 를 **명시**해 `'[]'` 를 넣는다 |
| 가입 응답 | `family_alarm_quiet_windows: []` 를 보낸다 |
| 저장된 값 읽기 | 비어 있으면 **빈 목록**. 기본 창을 만들어 내지 않는다 |
| 앱의 저장 경로 | 사용자가 창을 다 지웠으면 **지운 대로** 보낸다 |

⚠ **첫 줄이 가장 잘 빠진다.** 컬럼 DEFAULT 가 `평일 09:00–18:30` 이라, INSERT 에서
그 컬럼을 생략하면 SQLite 가 알아서 박는다. SQLite 는 컬럼 DEFAULT 를 바꿀 수 없고
(테이블 재작성이 필요한데 prod 재생성은 금지) 그래서 **INSERT 마다 명시하는 것이 유일한
방법**이다. 새 로그인 경로를 만들면 그 INSERT 도 같이 고칠 것 —
회귀 테스트 `test/no-auto-quiet-windows.test.ts` 가 소스에서 이를 검사한다.

빈 목록이면 판정 함수가 곧바로 통과시킨다(`quietWindows.length === 0` 가드).

## 3. 리드타임

가족 알람은 **최소 30분 뒤**여야 만들 수 있다. 받는 사람 기기가 서버 신호를 받아
로컬에 예약할 시간이 필요하다 — 그보다 가까우면 신호가 도착하기 전에 시각이 지난다.

## 구현 지도

| 규칙 | Android | iOS | 백엔드 |
| --- | --- | --- | --- |
| 보내기(로컬 행 없음) | `MainViewModelAlarmActions.createFamilyTargetAlarm` | `AlarmEditorSheet.createFamilyTargetAlarm` | `routes/family-alarm.ts` |
| 받는 사람 고르기 | 「누구를 깨울까요?」 시트 | `WakeTargetSheet` | — |
| 저장 버튼 라벨 | `editor_save_for`(`저장 · %1$s`) | `AlarmEditorSheet.saveButtonTitle` | — |
| 방해금지 판정 | — | — | `lib/family-alarm-settings.ts` `isBlockedByFamilyAlarmQuietTime` |
| 방해금지 기본값 없음 | `MainViewModelAuthActions`(다 지우면 그대로) | `AuthViewModel.updateProfile`(같음) | `normalizeQuietWindows` 폴백 `[]` + 가입 응답 |
| 기존 계정 정리 | — | — | 마이그레이션 98 |
| 리드타임 | — | `FamilyAlarmScheduleRules` | `routes/alarm-helpers.ts` |
| 받은 뒤 수정은 수신자 것 | `RemoteAlarmPullSyncService.locallyEditedByRecipient` | `RemoteAlarmPullSync.locallyEditedByRecipient` | — |
| '안 고침' 불변식 세우기 | `buildReceivedAlarmRow`(같은 `now`) | `LocalAlarmStore.upsert(_:syncedNow:)` | — |
| 수신자 편집을 서버에 안 올림 | `AlarmSyncService`(`origin == LOCAL_OWNED`) | `RemoteAlarmPushSync` + `AlarmsListView.shouldPushToServer` | `alarm-mutation.ts` PATCH 소유권 게이트 |
| 그만받기(삭제) | `MainViewModelAlarmActions`(decline) | `RemoteAlarmSyncViewModel`(decline) | `POST /alarm/:id/decline`, `GET /alarm/declined` |
| 발신자 탈퇴 → 목소리만 회수 | `withVoiceRevoked` | `RemoteAlarmPullSync.withVoiceRevoked` | `GET /alarm/declined` 의 `revokedAlarmIds` |
| 회귀 테스트 | `RemoteAlarmPullSyncServiceTest` | `RemoteAlarmPullSyncTests` | — |

## 검증 방법

⚠ **실기기 2대가 필요하다.** 보내는 계정과 받는 계정이 달라야 하고, 받는 쪽은 푸시를
받아 로컬에 예약해야 한다 — 시뮬레이터·에뮬레이터로는 그 왕복을 볼 수 없다.
