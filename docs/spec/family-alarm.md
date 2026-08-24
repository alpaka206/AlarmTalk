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

⚠ **수신은 계정당 한 기기다.** 먼저 받은 기기가 원본이고, 같은 계정의 다른 기기에는
내려가지 않는다 — 수신 확인(아래 1-2)이 기기가 아니라 **사용자** 단위라 첫 기기가
확인하는 순간 서버 행이 사라지기 때문이다.

### 1-2. 전달이 끝나면 **서버 행을 지운다** (2026-08-24)

서버의 알람 행은 **전달 수단**이다. 수신자 기기가 로컬 행을 세우고 음원까지 받으면
전달은 끝났고, 그 뒤로 그 행을 읽을 일이 없다 — 내 알람은 서버에서 다시 받아오지 않고
(pull 은 `isReceived` 만 임포트한다), 알람의 원본은 언제나 기기다.

그래서 양 앱의 pull 은 임포트 직후 `POST /alarm/:id/received` 를 부르고, 서버는
tombstone 을 남긴 뒤 `alarms` 행을 지운다. 단 켜진 알람은 **OS 예약까지 성공한 뒤에만**
ack 한다. 로컬 행과 음원이 있어도 AlarmManager/AlarmKit 예약이 실패했다면 전달은 끝난
것이 아니다. 서버 행을 남겨 다음 pull·예약 복구가 다시 시도하게 한다.

**왜 지우나.** 남겨 두면 `audio-retention` 이 "아직 쓰는 알람이 있다" 고 보아 **클론
음원을 TTL(30일)이 지나도 영구 보존**한다. 생체정보에서 파생된 데이터를 이유 없이
붙들고 있게 된다.

⚠ **행은 '음원을 받을 권리' 이기도 하다.** `GET /tts/messages/:id/audio` 의 수신자
갈래가 `EXISTS (SELECT 1 FROM alarms WHERE message_id = ? AND target_user_id = 나)` 로
판정한다(`routes/tts.ts`). 그래서 **음원 확보가 끝난 뒤에만 ack 한다** — 다운로드가
실패한 회차나 아예 반영하지 않은 회차에 ack 하면 그 알람은 **영영 목소리를 못 받는다**
(행이 없으니 다음 pull 목록에도 안 실리고 음원 요청은 404 다). 판정은 안드로이드
`audioSecured`, iOS `MergeOutcome.deliveryComplete`. 서버는 이걸 강제할 수 없다.

⚠ **ack는 가져온 버전에 묶는다.** 같은 발신자가 같은 수신자·시각으로 다시 보내면 서버는
알람 id를 재사용하고 내용을 교체한다(`claimTargetedAlarmSlot`). 다운로드 중 교체될 수 있으므로
목록 응답의 `delivery_version`을 ack 본문에 그대로 보내고, 서버는 현재 행의 버전이 같을
때만 tombstone을 남기고 삭제한다. 구버전 ack가 새 내용을 지우면 새 알람은 어느 기기에도
전달되지 않는다. 재전송으로 내용을 교체할 때마다 버전은 새 UUID로 바꾼다.

⚠ **지우기 전에 tombstone 을 남긴다** — 실패하면 지우지 않는다(fail-closed). 행이
없어지면 나중에 발신자가 목소리를 지웠을 때 **어느 수신 알람을 걷어내야 하는지** 알
방법이 사라진다. 옮겨 적는 것은 발신자와 **실제 재생 음원의 출처**다.

- 클론으로 합성한 음원: `voice_profile_id`
- 발신자가 직접 녹음해 보낸 `family-voice`: `sender_user_id` + `sender_voice_upload=1`

`family-voice`의 `messages.voice_profile_id`는 메시지 행을 만들기 위해 넣은 수신자 프로필일
뿐 재생 음원의 출처가 아니다. 그것을 tombstone에 적으면 수신자의 무관한 클론을 지울 때
발신자 녹음이 철회되고, 정작 발신자가 동의를 철회할 때는 남는 방향으로 판정이 뒤집힌다.
스톡 목소리는 없어지지 않으므로 어느 출처에도 적지 않는다.

**그래서 이 스펙의 다른 규칙들 사정거리가 ack 전으로 줄었다** — 재구성, 서버가 끄는
같은-시각 슬롯(1-3), 발신자의 원격 조작. 전부 아직 수신 확인이 안 온 알람에만 닿는다.

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
| 아직 안 고친 행 | `updatedAtMillis == lastSyncedAtMillis` | 서버본으로 재구성(첫 수신, 그리고 음성 다운로드 실패로 아직 ack 하지 않은 알람의 재시도) |
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

⚠ **다만 이 서버 경로는 ack 전까지만 닿는다**(1-2). 수신 확인이 끝난 알람은 서버 행이
없어 `claimTargetedAlarmSlot` 의 UPDATE 가 훑을 대상이 아니고, pull 목록에도 안 실려
`is_active` 가 내려올 길이 없다. **이미 받은 알람의 같은 시각 중복은 클라가 막는다** —
pull 이 새 알람을 세울 때 같은 시각의 수신자 소유 알람을 로컬에서 끈다
(안드로이드 `alarmDao.getEnabledAtTime`). 두 겹이 서로 다른 구간을 덮는 것이지
한쪽이 남는 것이 아니다.

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

가족 알람은 **최소 5분 뒤**여야 만들 수 있다. 받는 사람 기기가 신호를 받아 로컬에
예약할 시간이 필요하다 — 그보다 가까우면 신호가 도착하기 전에 시각이 지난다.

⚠ 편집기가 안내하는 "가능한 가장 이른 시각"은 `현재+5분`을 시:분으로 잘라 보여주지
않는다. 선택기는 분 단위이므로 **다음 분으로 올린 뒤 전송 여유 1분을 더한 시각**을 안내한다.
예를 들어 10:00:30이면 10:07부터 안내한다. 10:05는 실제로 4분 30초 뒤이고, 단순 올림한
10:06도 10:00:59에 저장하면 서버 도착 시 5분 아래로 내려갈 수 있다. 서버의 실제 하한은
5분 그대로고, 추가 1분은 앱 안내·선택에만 쓰는 전송 여유다.

⚠ **값은 세 곳에 있고 반드시 같아야 한다.** 하나만 내리면 앱은 통과시키는데 서버가
400 `FAMILY_ALARM_LEAD_TIME` 으로 거절해, 사용자에게는 이유를 알 수 없는 "상대 알람
설정에 실패했어요" 만 보인다(2026-08-21 실기기에서 실제로 그랬다).

| 서버 | Android | iOS |
| --- | --- | --- |
| `routes/alarm-helpers.ts` 의 `FAMILY_ALARM_MIN_LEAD_MINUTES` | `ui/editor/AlarmEditorScreenComponents.kt` 의 `FAMILY_ALARM_MIN_LEAD_MILLIS` | `AlarmEditorSheet.familyAlarmMinLeadMillis` |

**30분이었던 이유와 바뀐 이유.** 예전에는 받은 알람을 가져오는 길이 **15분 주기 폴링**
뿐이라, 폴링 한 번을 놓쳐도 남는 여유가 필요했다. 지금은 `family_alarm` 푸시가 즉시
pull 을 돌린다(실측 3초). 그래서 근거가 사라진 값이다.

**0 으로는 두지 않는다.** 받는 기기가 오프라인이거나 Doze 에 들어가 있으면 푸시가 늦고,
그러면 알람이 **울리지 않은 채 시각이 지나간다.** 보낸 사람은 보냈다고 믿는다.

## 4. 문구는 **받는 사람 기준**으로 고른다 (2026-08-18 결정)

알람 음성이 프리셋 + 직접 입력 둘로 좁혀지면서(`docs/qa/dev-test-handoff.md` 5절),
가족 알람도 프리셋 클립을 실어 보낸다. 그때 **어느 조건의 클립을 고르느냐**가 갈린다 —
날씨 테마는 클립이 날씨별로 여러 벌이고(`variant`), 운세도 사주별로 다르다.

> **보내는 사람이 아니라 받는 사람의 조건으로 고른다.**

「받은 뒤엔 전부 받은 사람 것」의 연장이다. 서울에 사는 사람이 부산에 사는 부모에게
알람을 보내면, 울릴 때 들리는 건 **부산 날씨**여야 한다 — 보낸 사람 동네 날씨를 듣는
알람은 받는 사람에게 아무 뜻이 없다.

- **보내는 사람의 지역·사주를 행에 복사하지 않는다.** 편집기가 `targetProvidesWeather`
  /`targetProvidesFortune` 로 이미 이 선을 긋고 있다 — 수신자가 자기 설정을 갖고 있으면
  그 칸이 비어 있는 게 **정상**이고, 막지 않는다.
- **variant 는 받는 사람 기기가 자기 위치로 resolve 한다.** 행이 받는 사람 기기에 내려간
  뒤 그쪽의 `DynamicVoiceRefreshWorker`(iOS 는 대응 갱신 경로)가
  `/tts/prerender-variant` 를 자기 지역으로 물어 `contextVariantIndex` 를 갱신한다.
  보내는 쪽에서 미리 확정해 박으면 **그 순간의 발신자 날씨가 영원히 고정**된다.
- ⚠ **받는 사람이 지역을 등록하지 않았으면 서버 폴백(서울)이 아니라 날씨가 아닌 테마로
  보내야 한다.** 폴백은 "내 날씨인 줄 알았는데 아니었다" 를 조용히 만든다.

## 구현 지도

| 규칙 | Android | iOS | 백엔드 |
| --- | --- | --- | --- |
| 보내기(로컬 행 없음) | `MainViewModelAlarmActions.createFamilyTargetAlarm` | `AlarmEditorSheet.createFamilyTargetAlarm` | `routes/family-alarm.ts` |
| 받는 사람 고르기 | 「누구를 깨울까요?」 시트 | `WakeTargetSheet` | — |
| 저장 버튼 라벨 | `editor_save_for`(`저장 · %1$s`) | `AlarmEditorSheet.saveButtonTitle` | — |
| 방해금지 판정 | — | — | `lib/family-alarm-settings.ts` `isBlockedByFamilyAlarmQuietTime` |
| 방해금지 기본값 없음 | `MainViewModelAuthActions`(다 지우면 그대로) | `AuthViewModel.updateProfile`(같음) | `normalizeQuietWindows` 폴백 `[]` + 가입 응답 |
| 기존 계정 정리 | — | — | 마이그레이션 98 |
| 리드타임(**세 값이 같아야 한다**) | `AlarmEditorScreenComponents.kt` 의 `FAMILY_ALARM_MIN_LEAD_MILLIS`·`earliestSelectableFamilyAlarmMillis`·`isFamilyAlarmLeadTooSoon` | `AlarmEditorSheet.familyAlarmMinLeadMillis`·`earliestSelectableFamilyAlarmMillis` | `routes/alarm-helpers.ts` 의 `FAMILY_ALARM_MIN_LEAD_MINUTES` |
| 수신 확인 → 서버 행 삭제 | `RemoteAlarmPullSyncService`(`audioSecured` + 예약 성공 + `deliveryVersion`) | `RemoteAlarmPullSync`(`MergeOutcome.deliveryComplete` + `deliveryVersion`) | `POST /alarm/:id/received`(현재 `delivery_version` 일치 시만 삭제) |
| 수신자 음원 접근권 | — | — | `routes/tts.ts` `GET /messages/:id/audio` 의 `target_user_id` 갈래 |
| 받은 뒤 수정은 수신자 것 | `RemoteAlarmPullSyncService.locallyEditedByRecipient` | `RemoteAlarmPullSync.locallyEditedByRecipient` | — |
| '안 고침' 불변식 세우기 | `buildReceivedAlarmRow`(같은 `now`) | `LocalAlarmStore.upsert(_:syncedNow:)` | — |
| 수신자 편집을 서버에 안 올림 | `AlarmSyncService`(`origin == LOCAL_OWNED`) | `RemoteAlarmPushSync` + `AlarmsListView.shouldPushToServer` | `alarm-mutation.ts` PATCH 소유권 게이트 |
| 그만받기(삭제) | `MainViewModelAlarmActions`(decline) | `RemoteAlarmSyncViewModel`(decline) | `POST /alarm/:id/decline`, `GET /alarm/declined` |
| 목소리가 사라짐 → 목소리만 회수 | `withVoiceRevoked` | `RemoteAlarmPullSync.withVoiceRevoked` | `lib/voice-revocation.ts` → `GET /alarm/declined` 의 `revokedAlarmIds` |
| 회귀 테스트 | `RemoteAlarmPullSyncServiceTest` | `RemoteAlarmPullSyncTests` | — |

## 검증 방법

⚠ **실기기 2대가 필요하다.** 보내는 계정과 받는 계정이 달라야 하고, 받는 쪽은 푸시를
받아 로컬에 예약해야 한다 — 시뮬레이터·에뮬레이터로는 그 왕복을 볼 수 없다.
