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

⚠ **식별자를 못 붙여도 사건은 적는다.** 식별자는 전부 nullable 이다 — 잠금화면에서 콜드
부팅된 iOS 는 알람 기록을 아직 못 읽어 알람 id 를 모를 수 있는데, **못 찾은 것은 안 누른
것이 아니다.** 못 적으면 그 회차는 영영 복구되지 않는다(나중에 어느 버튼을 눌렀는지
되짚을 방법이 없다).

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

⚠ **iOS 는 울린 순간에 우리 코드가 돌지 않는다.** 안드로이드는 울림 서비스가 직접 울리므로
그 자리에서 적지만, iOS 는 AlarmKit 이 울리고 우리는 **해제·다시 울림을 누를 때** 불린다.
그래서 iOS 는 울림을 두 자리에서 적는다 — 앱이 살아 있으면 `.alerting` 진입에서, 아니면
그 인텐트에서(관찰자가 봤는지는 행의 상태로 가른다). **끝내 아무도 안 누른 울림은 적을
방법이 없다** — 그때는 우리 코드가 한 번도 돌지 않고, 반복 알람은 목록에서 사라지지도
않는다. 이건 플랫폼 한계이고, 그래서 iOS 의 울림 수는 **아래로 치우친다.**

## 3. 재전송은 안전해야 한다

- `id` 는 **기기가 만든 UUID** 이고 서버에서 그대로 PK 다. 서버는 `INSERT OR IGNORE` 로
  넣는다 — 응답을 못 받은 배치를 그대로 다시 보내도 사건이 겹치지 않는다.
- 앱은 **성공한 배치만** 큐에서 지운다. 실패하면 남겨 두고 다음 기회에 다시 보낸다.
- **일어난 시각(`occurred_at`)과 도착 시각(`received_at`)을 나눈다.** 며칠 늦게 도착해도
  진실은 앞의 값이다.
- ⚠ **단 미래는 없다.** `occurred_at` 은 기기 시계라 앞서 있을 수 있다 — 서버는 **도착
  시각을 넘는 값을 도착 시각으로 자른다.** 거부하지 않는 이유는 앱이 2xx 가 아닌 배치를
  영원히 재전송하기 때문이다(400 은 그 기기의 큐를 영구히 막는다). 안 자르면 두 가지가
  깨진다 — 미래에 앉은 행이 보관 1년(§6)을 영영 빠져나가고, §5 의 시각 비교가 미래 값에
  고정돼 **이후의 정당한 기록이 전부 무시된다.** 늦게 도착한 **과거** 값은 그대로 둔다.

## 4. 계정이 바뀌면 보내지 않는다

서버는 **토큰의 주인**으로 기록한다. 그래서 A 가 남긴 사건이 B 의 기록에 들어가면 되돌릴
방법이 없다. 큐의 각 행에 남긴 계정을 적어 두고, 그 계정 것만 꺼내 보낸다. 업로드 도중
세션 세대가 바뀌면 **그 자리에서 멈춘다**.

⚠ **계정을 적는 것은 기록기(큐)이지 부르는 쪽이 아니다.** 호출부마다 계정을 넘기게 하면
언젠가 빠뜨리고, 빠진 행은 **비어 있는 계정** 이 되어 다음에 로그인한 사람의 기록으로
올라간다(서버는 토큰의 주인으로 적는다 — 되돌릴 수 없다). 그래서 계정은 기록기가 생성
시점에 스스로 채운다(안드로이드 `UsageEventRecorder(currentUserId)`, iOS
`UsageEventQueue(currentUserID:)`).

⚠ **계정을 모르면 아예 적지 않는다.** 로그아웃 구간(자동 401 로 세션만 잃은 구간 포함)에도
알람은 울리는데, 그때 남긴 사건을 계정 없이 적어 두면 **다음에 로그인한 사람의 기록**이
된다. 그런 사건은 애초에 올바르게 올릴 방법도 없다 — 배치에는 계정이 실리지 않고 서버는
토큰의 주인으로 적으며 `user_id` 는 NOT NULL 이다. 알람 행의 `ownerUserId` 와 달리 이 큐에는
떠나는 계정을 나중에 새겨 넣는 단계가 없다. 잃는 것은 그 구간의 사건 몇 건이고, 그것이
남의 기록이 되는 것보다 낫다. 꺼내는 쪽도 짝을 맞춘다 — 주인 없는 행은 **보내지 않는다**.

⚠ **정하는 시점은 '적는 순간' 이다 — 저장이 실제로 도는 순간이 아니다.** 두 앱 모두 기록을
비동기로 쓰는데(안드로이드 코루틴, iOS 직렬 큐), 계정을 그 안에서 읽으면 사이에 끼어든
로그아웃·로그인이 **A 의 사건을 B 의 이름으로** 저장한다. 계정은 `record()` 가 돌아오기 전에
정해져 있어야 한다.

## 5. 사용중/비사용중은 **폰이 판정한다**

그 오디오를 쓰는 알람이 **이 기기에** 남아 있는가 — 이건 기기만 알 수 있다(참조 카운트).
서버는 그 결과를 받아 적을 뿐이고, 추측하지 않는다. 추측하면 기기마다 다른 사실이 서로를
덮어쓴다.

- ⚠ **놓음도 붙임과 같은 선으로 가른다** — 랜덤도 아니고 테마도 아닌데 문구 id 가 있으면
  직접 입력이다(`isManualMessageAlarm`). 테마 알람도 `ttsMessageId`·캐시 키를 **둘 다**
  들고 있어서, 그 둘만 보면 갈리지 않는다 — 실제로 붙임 쪽에만 이 판정이 있어서 테마
  알람을 지우거나 테마를 바꾸기만 해도 '문구를 놓았다' 고 적고 있었다(2026-09-07 리뷰 34차).
  판정은 **놓는 쪽 행**(지우기 전 / 고치기 전)으로 한다 — 바뀐 뒤로 하면 직접 입력 →
  테마 편집에서 앞 문구를 영영 안 놓아 준다.
- 알람을 **지우거나 고쳐서** 그 오디오를 참조하는 알람이 이 기기에 하나도 안 남았을 때
  `manual_message_released` 를 남긴다. 같은 캐시 키를 다른 알람이 아직 쓰면 여전히 사용중이다.
  - ⚠ **파일 삭제 여부와는 다르다.** 지울 때는 파일도 사라지지만, **고쳐서 놓아 준
    오디오는 지우지 않는다** — 30일 sweep 에 맡긴다. 그 사이 같은 문구를 다시 고르면
    서버 호출도 월 한도 차감도 없이 재사용되기 때문이다(`docs/spec/voice-and-message.md` §8).
    그러니 언젠가 `in_use = 0` 을 보고 정리하는 것을 만들 때, **오디오가 기기에서
    사라졌다고 가정하지 말 것.**
  - ⚠ **`in_use` 는 마지막으로 보고한 *한 기기의* 사실이다.** 두 기기가 같은 문구를 쓰면
    한쪽의 참조 카운트 0 이 계정 전체를 0 으로 만든다 — 위의 시각 비교는 **순서만** 정하지
    두 기기의 상태를 합치지 못한다(합치려면 기기 식별자가 필요한데, 그건 새로 수집하는
    개인정보라 처리방침·릴리스와 묶인다). 그래서 **`in_use = 0` 을 삭제의 근거로 단독으로
    쓰지 말 것.** 지우는 문은 목소리 삭제 하나다(`docs/product/manual-message-reuse-plan.md` §1-4).
  - ⚠ **문구가 그대로면 적지 않는다.** 오디오만 다시 만든 경우까지 해제로 적으면, 해제와
    붙임이 같은 시각에 찍혀 순서가 뒤집히고(정렬 키가 시각 하나뿐이다) 아래 비교가 늦게
    온 해제를 받아들여 **붙어 있는 문구가 비사용중으로** 뒤집힌다.
- ⚠ **늦게 도착한 기록이 최신 사실을 덮지 않는다 — 붙임·해제 양쪽 다.** 오프라인 큐는
  며칠 밀릴 수 있고 같은 문구를 두 기기가 함께 쓸 수 있다(캐시 히트가 같은 `message_id`
  를 돌려준다). 서버가 `in_use_updated_at` 을 비교해 **더 최근 사실만** 남긴다.
  한쪽에만 가드를 두면 뒤늦게 도착한 '붙임' 이 최신 '해제' 를 되돌려 그 문구가 영원히
  사용중으로 남는다.

## 6. 보관 기간

**1년.** 지나면 cron 이 배치로 지운다.

⚠ **이 숫자는 두 곳에 있고 반드시 같아야 한다** — 개인정보 처리방침 3장 표와 코드 상수
(`USAGE_EVENT_RETENTION_DAYS`). 문서와 코드가 갈라지면 어느 쪽이 진실인지 아무도 모른다.
회귀 테스트가 그 값을 고정한다(`test/scheduled-prune.test.ts`).

⚠ **계정을 지우면 그 계정의 기록도 함께 지운다 — 1년을 기다리지 않는다.** `usage_events`
는 `users` 의 FK 자식이라, 파기에서 빼먹으면 `DELETE FROM users` 가 FK 로 던져 **탈퇴가
통째로 롤백된다**(마지막 기록이 1년을 채울 때까지 계정을 지울 수 없다).

## 구현 지도

| 규칙 | Android | iOS | 백엔드 |
| --- | --- | --- | --- |
| 종류 목록 | `data/UsageEventRecorder.kt` 의 `UsageEvents` | `UsageEventQueue.swift` 의 `UsageEventType` | `packages/shared/src/schemas/usage-event.ts` |
| 로컬 큐 | `data/UsageEventEntity.kt`(Room) | `UsageEventQueue.swift`(파일) | — |
| 전송 | `sync/UsageEventUploadWorker.kt` | `UsageEventUploader.swift` | `routes/events.ts` |
| 울림 기록 | `alarm/RingingService.kt` 의 `startRinging` — 언제나 | `AlarmKitViewModel.swift` 의 `.alerting` 진입, 그리고 관찰자가 못 봤으면 `Shared/AlarmIntents.swift` 의 `recordRingIfObserverMissedIt` | — |
| 알람 생성·수정·삭제 | `data/AlarmRepository.kt` 의 `recordAlarmEvent` | `Views/Editor/AlarmEditorSheet.swift` 의 `recordSaveUsageEvent`, `AlarmKitViewModel.deleteLocalAlarm` | — |
| 사용중/비사용중 | 붙임 `recordAlarmEvent` / 놓음 `deleteAlarmLocked`·`updateAlarm`(`manualMessageReleasedByEdit`) | 붙임·놓음 모두 `AlarmEditorSheet.recordSaveUsageEvent`, 삭제는 `AlarmKitViewModel.deleteLocalAlarm` | `message_library.in_use` |
| 해제·다시 울림 | `alarm/RingingService.kt` 의 `dismiss`/`snooze` — Intent 의 알람 id 로 **무조건** 적는다 | `Shared/AlarmIntents.swift` 의 `StopAlarmIntent`/`SnoozeAlarmIntent` — **누른 자리**에서 적고(`handleAlarmStopped` 는 알람을 지우거나 끌 때도 불린다) **조회에 매달지 않는다**(콜드 부팅에서는 기록을 못 찾는다) | — |
| 계정이 바뀌면 멈춤 | `sync/UsageEventUploadWorker.kt` 의 `startGeneration` 비교 | `UsageEventUploader.swift` 의 `runIfCurrentSession`(세대 카운터가 없어 **토큰을 에폭으로** 쓴다) | — |
| 남긴 계정 | `data/UsageEventRecorder.kt` 의 `currentUserId` | `UsageEventQueue.swift` 의 `currentUserID` | — |
| 미래 시각 자르기 | — | — | `routes/events.ts` 의 `boundOccurredAt` |
| 보관 기간 | — | — | `index.ts` 의 `USAGE_EVENT_RETENTION_DAYS` |
| 계정 파기 시 삭제 | — | — | `lib/account-deletion.ts` 의 `purgeUserAccount` |
