# 사용 기록(이벤트)

> 앱이 "무슨 일이 있었는지" 를 남긴다. **오프라인에서도 남고**, 연결되면 모아서 올라간다.
> 2026-09-07 구현.

## 1. 무엇을 남기나

| 종류 | 언제 |
| --- | --- |
| `alarm_created` / `alarm_updated` / `alarm_deleted` | 알람을 만들·고칠·지울 때 |
| `alarm_rang` | 실제로 울린 순간 |
| `alarm_dismissed` / `alarm_snoozed` | 껐을 때 / 다시 알림으로 미뤘을 때 |
| `manual_message_attached` | 직접 입력 문구가 알람에 붙었다 = 그 오디오가 이 기기에서 **사용중** |
| `manual_message_released` | 그 문구를 쓰는 알람이 이 기기에서 모두 사라져 오디오를 지웠다 = **비사용중** |
| `voice_created` / `voice_deleted` | 목소리를 등록·삭제할 때(자리만 열어 둠) |

한 건에 담기는 것: 사건 종류, **일어난 시각**, 알람·목소리·문구의 **식별자**, 짧은 부가
값(`detail`, 120자).

⚠ **문구 원문 같은 개인 텍스트를 담지 않는다.** 문구는 이미 `messages` 에 있고, 기록에
사본을 만들면 **목소리 삭제·동의 철회 때 지워야 할 곳이 하나 더 늘어난다.** 자유 문자열은
`detail` 하나뿐이고 앱·서버 양쪽에서 자른다.

## 2. 울릴 때는 **적기만** 한다

⚠ **울림 경로에서 네트워크를 부르지 않는다.** 이 앱의 첫 번째 원칙이 "알람은 OS 스케줄 +
로컬 오디오, 울릴 때 서버를 안 탄다" 이다(`docs/product/README.md` 「Real alarm」).
그래서 기록기와 전송기를 **갈라 두었다**:

- 기록: 로컬 큐에 적는다(안드로이드 Room, iOS 파일). 실패해도 **하던 일을 막지 않는다** —
  알람이 본업이고 기록은 곁다리라, 모든 경로가 실패를 삼키고 로그만 남긴다.
- 전송: 앱이 열릴 때·주기 워커가 배치로 보낸다.

## 3. 재전송은 안전해야 한다

- `id` 는 **기기가 만든 UUID** 이고 서버에서 그대로 PK 다. 서버는 `INSERT OR IGNORE` 로
  넣는다 — 응답을 못 받은 배치를 그대로 다시 보내도 사건이 겹치지 않는다.
- 앱은 **성공한 배치만** 큐에서 지운다. 실패하면 남겨 두고 다음 기회에 다시 보낸다.
- **일어난 시각(`occurred_at`)과 도착 시각(`received_at`)을 나눈다.** 며칠 늦게 도착해도
  진실은 앞의 값이다.

## 4. 계정이 바뀌면 보내지 않는다

서버는 **토큰의 주인**으로 기록한다. 그래서 A 가 남긴 사건이 B 의 기록에 들어가면 되돌릴
방법이 없다. 큐의 각 행에 남긴 계정을 적어 두고, 그 계정 것만 꺼내 보낸다. 업로드 도중
세션 세대가 바뀌면 **그 자리에서 멈춘다**.

## 5. 사용중/비사용중은 **폰이 판정한다**

그 오디오를 쓰는 알람이 **이 기기에** 남아 있는가 — 이건 기기만 알 수 있다(참조 카운트).
서버는 그 결과를 받아 적을 뿐이고, 추측하지 않는다. 추측하면 기기마다 다른 사실이 서로를
덮어쓴다.

- 알람을 지울 때 **오디오가 실제로 지워졌을 때만** `manual_message_released` 를 남긴다.
  같은 캐시 키를 다른 알람이 아직 쓰면 파일은 그대로이므로 여전히 사용중이다.
- ⚠ **늦게 도착한 '해제' 가 최신 '사용중' 을 덮지 않는다.** 오프라인 큐는 며칠 밀릴 수
  있어, 서버가 시각을 비교해 더 최근 사실만 남긴다.

## 6. 보관 기간

**1년.** 지나면 cron 이 배치로 지운다.

⚠ **이 숫자는 두 곳에 있고 반드시 같아야 한다** — 개인정보 처리방침 3장 표와 코드 상수
(`USAGE_EVENT_RETENTION_DAYS`). 문서와 코드가 갈라지면 어느 쪽이 진실인지 아무도 모른다.
회귀 테스트가 그 값을 고정한다(`test/scheduled-prune.test.ts`).

## 구현 지도

| 규칙 | Android | iOS | 백엔드 |
| --- | --- | --- | --- |
| 종류 목록 | `data/UsageEventRecorder.kt` 의 `UsageEvents` | `UsageEventQueue.swift` 의 `UsageEventType` | `packages/shared/src/schemas/usage-event.ts` |
| 로컬 큐 | `data/UsageEventEntity.kt`(Room) | `UsageEventQueue.swift`(파일) | — |
| 전송 | `sync/UsageEventUploadWorker.kt` | `UsageEventUploader.swift` | `routes/events.ts` |
| 울림 기록 | `alarm/RingingService.kt` 의 `startRinging` | `AlarmKitViewModel.swift` 의 `.alerting` 진입 | — |
| 알람 생성·수정·삭제 | `data/AlarmRepository.kt` 의 `recordAlarmEvent` | `Views/Editor/AlarmEditorSheet.swift` 의 `recordSaveUsageEvent`, `AlarmKitViewModel.deleteLocalAlarm` | — |
| 사용중/비사용중 | 같은 두 자리(참조 카운트 판정 뒤) | 같은 두 자리 | `message_library.in_use` |
| 보관 기간 | — | — | `index.ts` 의 `USAGE_EVENT_RETENTION_DAYS` |
