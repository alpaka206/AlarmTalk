# 사용 기록(이벤트)

> 앱이 "무슨 일이 있었는지" 를 남긴다. **오프라인에서도 남고**, 연결되면 모아서 올라간다.
> 2026-09-07 구현.

## 1. 무엇을 남기나

| 종류 | 언제 |
| --- | --- |
| `alarm_created` / `alarm_updated` / `alarm_deleted` | 알람을 만들·고칠·지울 때 |
| `alarm_rang` | 실제로 울린 순간 |
| `alarm_dismissed` / `alarm_snoozed` | 알람이 **실제로 끝났을 때** / **실제로 미뤄졌을 때**. ⚠ '다시 알림' 을 눌러도 미뤄지지 않는 갈래가 둘이다 — 행이 사라진 경합(`detail = "snooze_denied"`)과 **재무장 실패**(`detail = "snooze_failed"`, iOS)다. (2026-09-09 전에는 '한도 도달·비활성' 이 여기 있었다. 그 설정을 없앴으므로 **정상 조작으로는 더 이상 닿지 않는다** — `snooze_denied` 가 늘면 그건 한도가 아니라 경합이다.) 둘 다 `alarm_snoozed` 가 아니라 `alarm_dismissed` 로 적는다. **누른 사실은 그 `detail` 이 나른다** — 눌렀는데 막힌 횟수는 한도를 조정할 유일한 근거라 버리지 않는다. ⚠ 안드로이드의 `snooze_failed` 는 뜻이 달라 `alarm_snoozed` 에 붙는다(§2) |
| `manual_message_attached` | 직접 입력 문구가 알람에 붙었다 = 그 오디오가 이 기기에서 **사용중** |
| `manual_message_released` | 그 문구를 쓰는 알람이 이 기기에서 모두 사라져 오디오를 지웠다 = **비사용중** |
| `voice_created` / `voice_deleted` | 목소리를 등록·삭제할 때(자리만 열어 둠) |

한 건에 담기는 것: 사건 종류, **일어난 시각**, 알람·목소리·문구의 **식별자**, 짧은 부가
값(`detail`, 120자).

**해제 사유(`alarm_dismissed` 의 `detail`)**: `"screen_off"`(전원 버튼·커버로 화면이 꺼져
울림 화면을 벗어남) / `"left_screen"`(홈·최근앱·앱 전환·전화 수신으로 벗어남) /
`"snooze_denied"` / `"snooze_failed"`. 앞의 둘은 **사용자가 '끄기' 를 누르지 않은 유일한
해제**라 오탐 가능성이 있다 — 가방·플립커버가 알람을 끄고 있는지 확인할 유일한 장치이므로
지우지 말 것(`docs/spec/alarm-ringing.md` §2).

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

iOS도 BGTask에서 알람 정합화 이후 남은 실행 시간에 제한된 배치를 보낸다. 기록 전송 실패는
알람 정합화의 성공을 뒤집지 않는다. 앱→서버 배치뿐 아니라 서버→DB 쓰기도 트랜잭션 내
batch로 묶으며, 이벤트 순서·UUID 멱등·소유권 조건을 유지한다.

⚠ **iOS 는 울린 순간에 우리 코드가 돌지 않는다.** 안드로이드는 울림 서비스가 직접 울리므로
그 자리에서 적지만, iOS 는 AlarmKit 이 울리고 우리는 **해제·다시 울림을 누를 때** 불린다.
그래서 iOS 는 울림을 두 자리에서 적는다 — 앱이 살아 있으면 관찰자가(`AlarmKitViewModel`
의 `.alerting` 진입), 아무도 못 봤으면 그 인텐트가(`Shared/AlarmIntents.swift` 의
`recordRingIfObserverMissedIt`).

- **중복은 회차마다 남기는 표시로 가른다**(`ObservedRingMarkerStore`). 관찰자는 울림이
  **실제로 적힌 뒤에** 표시를 남기고, 인텐트는 그 표시를 **소비**한다 — 있으면 관찰자가
  적은 것이니 넘어가고, 없으면 적는다. ⚠ 순서를 뒤집지 말 것: 표시를 먼저 남기면 쓰기가
  실패하거나 그 사이에 프로세스가 죽었을 때 **적히지 않은 울림**을 적힌 것으로 오인해
  삼킨다. 소비는 이번 회차 것이든 아니든 **언제나** 한다 — 낡은 표시를 남겨 두면 다음
  회차를 삼킨다.
- ⚠ **행의 상태(`ringing`)로 가르지 않는다**(2026-09-07 리뷰 35차). 두 방향으로 틀렸다:
  관찰자가 적은 직후 프로세스가 죽고 인텐트가 콜드로 깨어나면 **행을 못 읽어** 한 번 더
  적었고(사건 `id` 가 달라 §3 의 서버 멱등으로도 안 걸린다), 반대로 콜드 인텐트는
  `markStopped` 를 못 돌려 행에 `ringing` 이 남아 **다음 회차의 정당한 울림을 삼켰다.**
- **남겨 둔 실패 방향은 '중복 1건' 이다.** 표시를 잃으면 울림이 한 번 더 적히지만 그건
  나중에 지울 수 있고, 삼킨 회차는 되짚을 방법이 없다. 아무도 안 누른 울림이 남긴 표시는
  `staleAfter`(6시간)로 만료된다 — 반복 알람의 가장 짧은 주기보다 넉넉히 짧게 잡아,
  어제 표시가 오늘 울림을 삼키지 못하게 한다.
- ⚠ **소비가 지나간 뒤에 도착한 표시는 남기지 않는다.** 표시는 울림이 적힌 **뒤에**
  남으므로, 쓰기가 끝나기 전에 누른 회차는 **소비가 먼저** 지나간다 — 그때 뒤늦게 남은
  표시는 아무도 소비하지 않아 다음 회차를 삼킨다. 가르는 것은 **시각이 아니라 인과**다:
  관찰자가 `.alerting` 에서 표를 **동기로** 뽑고(`beginObservation`), 쓰기 콜백은 그 표가
  아직 유효할 때만 커밋한다(`commit`). 소비가 그 표를 무효로 만들므로, 콜백이 몇 분 뒤에
  와도(파일 쓰기와 메인 큐를 거치는 콜백의 **도착 시각에는 상한이 없다**) 표시가 남지
  않는다. 짧은 창(`lateMarkWindow`)은 **표가 새로 발급되는 갈래**에만 남는다 — 소비 뒤에
  `.alerting` 이 뒤늦게 처리되는 경우는 토큰으로 못 가른다. ⚠ 이 창은 **길어도 잃는 것이
  없다** — 표시를 *안 남기는* 쪽이라 최악이 중복 1건이고 `staleAfter` 와 방향이 반대다.
- ⚠ **미래에 앉은 표시는 믿지 않는다**(2026-09-08 리뷰 39차). 기기 시계가 뒤로 가면
  `지금 - 표시` 가 음수라 `staleAfter` 비교를 **언제나** 통과하고 정리에서도 만료되지
  않는다 — 되돌린 만큼 6시간을 넘겨 살아남아 **어제 표시가 오늘 울림을 삼킨다.** 나이가
  음수인 표시는 소비도 정리도 **없는 것으로 본다**(최악은 중복 1건). 서버가 미래의 `occurred_at`
  을 저장하지 않는 것(§3)과 같은 이유다.
- ⚠ **단, '소비가 방금 지나갔는가' 는 벽시계로 재지 않는다**(2026-09-08 리뷰 40차). 그
  시각은 디스크에 없고 **한 프로세스 안에서만** 비교되는데, 벽시계로 적어 두면 **두 방향
  다 틀린다**: 시계를 되돌린 구간에서는 `지금 - 소비` 가 음수라 창을 **언제나** 통과해
  그 구간의 울림이 관찰자와 인텐트 **양쪽에서** 적히고(중복), 앞으로 뛴 구간에서는 늦은
  표시가 창을 **빠져나가** 다음 회차를 **삼킨다.** 그래서 이 값만 **단조 시계**로 잰다
  (`ContinuousClock` — 잠든 사이에도 흘러야 한다. `SuspendingClock`·`systemUptime` 은
  멈춰서, 밤새 잠든 폰의 다음 울림이 "소비 10초 안" 으로 보인다). 디스크에 남는 표시의
  시각은 프로세스를 건너 비교되므로 계속 벽시계이고, 거기서는 바로 위의 '미래는 믿지
  않는다' 가 답이다 — **두 시계는 하는 일이 다르다.**
- ⚠ **끝내 아무도 안 누른 울림은 적을 방법이 없다** — 그때는 우리 코드가 한 번도 돌지
  않고, 반복 알람은 목록에서 사라지지도 않는다. 플랫폼 한계이고, 그래서 iOS 의 울림 수는
  **아래로 치우친다.**

⚠ **다시 울림은 결과가 정해진 뒤에 적는다**(2026-09-07 리뷰 37차). 누른 것과 미뤄진 것은
다르다 — 한도 도달·비활성이면 그 누름은 알람을 **끝낸다.** 예전에는 누른 자리에서 먼저
적어서, 일어나지 않은 미룸이 기록되고 **실제로 일어난 종료는 아무 데도 남지 않았다.**
판정은 안드로이드가 `repository.snooze` 의 반환, iOS 가 `snoozeDecision` 이다.
해제는 지금대로 **누른 자리**에서 적는다 — 그 경로는 누름과 결과가 언제나 같고,
`handleAlarmStopped` 로 옮기면 알람을 지우거나 끄기만 해도 해제로 적힌다.
iOS 의 `.unknown`(콜드 부팅)은 다시 울림 쪽이므로 **재무장이 돌아오면** `alarm_snoozed` 다 —
기본 동작과 기록이 같은 방향이어야 한다.

⚠ **판정만으로는 부족하다 — iOS 는 재무장이 실제로 돌아온 뒤에 적는다.** 보조 버튼이
`.custom` 이라 OS 는 스스로 다시 걸지 않으므로 `countdown(id:)` **그 한 번이 유일한
재무장**이다. 그게 던졌는데 `alarm_snoozed` 를 적으면 그 행은 **영영 울리지 않을 미룸**을
주장한다 — 행은 '5분 뒤' 인데 OS 에는 카운트다운이 없고, 되살릴 경로도 이 행을 보지 않는다
(`recoverScheduledAlarms` 는 `alarmKitID` 가 살아 있어 후보에서 빼고,
`AlarmScheduleReconciler` 는 `.snoozed` 를 in-flight 로 비켜 간다). 그래서 **재무장 실패는
해제다** — 알람을 stop 으로 마무리하고 `alarm_dismissed`(`detail = "snooze_failed"`)로 적는다.
누른 사실은 여기서도 `detail` 이 나른다.

⚠ **안드로이드는 같은 `detail` 을 다른 종류에 붙인다 — 맞춰 놓지 말 것.** `repository.snooze`
가 던지면 DB 쓰기까지 갔는지 알 수 없고(행이 이미 `SNOOZED` 로 전진했을 수 있다), 전진한
행은 `reschedulePendingAlarms` 가 그대로 다시 등록한다. 즉 그쪽은 **결과를 모르는 것**이지
끝난 것이 아니라서, `alarm_snoozed`(`detail = "snooze_failed"`)로 적고 알람을 끝내지 않는다.
종류는 **그 기기에서 실제로 일어난 일**을 말한다 — 두 앱의 종류를 억지로 같게 만들면
한쪽이 거짓이 된다.

⚠ **미루는 시간은 인텐트가 정하지 않는다**(2026-09-08 리뷰 39차). 그 값은 예약할 때 행의
`snoozeMinutes` 로 `countdownDuration` 에 구워지고 `countdown(id:)` 은 그걸 바꾸지 못한다 —
호출자가 다른 값을 줄 수 있으면 **행만 그만큼 전진하고 OS 는 원래 시간에 울린다**(홈 화면이
"30분 남음" 을 띄우고 5분 뒤에 울렸다). 그래서 파라미터 자체를 두지 않는다.

## 3. 재전송은 안전해야 한다

- `id` 는 **기기가 만든 UUID** 이고 서버에서 그대로 PK 다. 서버는 `INSERT OR IGNORE` 로
  넣는다 — 응답을 못 받은 배치를 그대로 다시 보내도 사건이 겹치지 않는다.
- 앱은 **성공한 배치만** 큐에서 지운다. 실패하면 남겨 두고 다음 기회에 다시 보낸다.
- **일어난 시각(`occurred_at`)과 도착 시각(`received_at`)을 나눈다.** 며칠 늦게 도착해도
  진실은 앞의 값이다.
- ⚠ **미래 시각의 기록은 저장하지 않는다.** `occurred_at`은 기기 시계라 앞서 있을 수 있다.
  서버는 원본 발생 시각을 먼저 확인해 **요청 도착 시각을 넘으면 해당 기록을 버린다.** 도착 시각으로 바꾸면
  재동의 전에 쌓인 기록도 동의 후 사건으로 읽힐 수 있다. 버린 기록은 보관함 갱신에도 쓰지 않고, 배치에는
  200으로 답해 앱이 큐를 비우게 한다. 같은 배치의 정상 기록은 받는다. 과거 시각은 동의 경계 검사를 통과한
  뒤 값은 그대로, 표기만 UTC로 정규화한다. 미래 기록의 보관 기한·보관함 시각이 고정되는 문제도 함께 막는다.

- ⚠ **동의가 모자라면 오류가 아니라 200 으로 받고 버린다**(`accepted: 0`, `skipped_reason: consent_below_disclosure`).
  처리방침이 고지 버전(5) 미만이거나 필수 동의가 없으면 그렇다. 그래서 이 라우트는 **동의 미들웨어를 거치지 않는다**
  (`POST /events` 면제, 2026-10-16) — 미들웨어가 403 을 주면 앱이 배치를 들고 있다가 재동의가 끝난 뒤 다시 보내,
  **고지 전에 쌓인 기록**이 저장된다.
  재동의 뒤 처음 올라온 오프라인 배치도 발생 시각으로 거른다. 필수 동의가 현재 기준을 **연속해서 충족하기 시작한
  시각**보다 이른 `occurred_at`은 저장·보관함 상태 갱신에서 제외하고 200으로 답한다. 같은 범위의 동의를 다시
  기록한 것만으로 시작 시각을 늦추지는 않으며, 거절·버전 미달 기록이 있으면 그 뒤 동의부터다.
  새 동의는 서버 밀리초 시각을 적고, 초 단위 옛 기록은 그 초의 끝을 경계로 삼는다. 시각이 불명확하면 수집하지 않는다.

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

- ⚠ **놓음도 붙임과 같은 선으로 가른다** — 판정은 `isManualMessageAlarm` 하나이고, 그것은
  기존 `usesCustomMessageVoice` 에서 **유도한다**(거기에 `stock_` 캐시 키 제외와
  `voiceCategory` 항이 있다). 항을 호출부에서 다시 적지 말 것 — 그렇게 적었다가 두 항이
  빠져 **버킷 없이 프리셋 클립 하나만 문 옛 행**이 직접 입력으로 통과했다(리뷰 35차). 테마 알람도 `ttsMessageId`·캐시 키를 **둘 다**
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

## 7. 2판 — 준비시간·첫 경험·저장·직접 입력·광고·결제(2026-10-26)

v1.3 지시서 10장. 1판(위 §1~§6)은 그대로 두고 **종류와 칸을 더한다.** 옛 앱·옛 큐가 보내는 1판 기록은 계속 받는다.

### 7.1 새 종류

| 영역 | 종류 | 뜻 | 누가 적나 |
| --- | --- | --- | --- |
| 첫 경험 | `sample_started` / `sample_completed` | 샘플(목소리 미리듣기)이 **실제로 재생을 시작**했다 / **끝까지** 갔다. 화면 노출이 아니다 | 재생기(재생 시작 콜백·끝 콜백) |
| | `onboarding_step` | 로그인 뒤 첫 경험의 한 단계를 지났다(`step`) | 그 단계 화면 |
| | `auth_result` | 로그인 결과(`outcome`·`method`). 계정이 생긴 **뒤**에만 적힌다(§7.4) — 실패는 계정이 없어 적히지 않는다 | 로그인 처리 |
| 목소리 선택 | `voice_selected` | 알람에 쓸 목소리를 **골랐다**(미리 골라 둔 값은 아니다). `is_first`(이 계정 첫 선택)·`prepared`(그 순간 기기에 준비돼 있었나)·`pack_id` | 편집기 |
| 음성 준비 | `voice_preparation_started` / `_ready` / `_failed` | 범위(`scope`)·언어·`revision`·시작 캐시(`cache_state`)·대상/완료 수·바이트·`duration_ms`·`error_code` | **작업 소유자 한 곳**(§7.3) |
| 알람 저장 | `alarm_save_attempt` / `alarm_save_blocked` / `alarm_ready` | 저장을 눌렀다 / 요청 전에 막혔다(`reason`) / OS 예약과 오디오 파일이 **둘 다** 갖춰졌다 | 편집기 저장 흐름 |
| 직접 입력 | `manual_result_reused` | 이미 만든 결과를 다시 썼다(`reuse_location` = `local` 기기 캐시 / `server` 서버 재사용). 차감 없음 | 직접 입력 생성 흐름 |
| | `generation_outcome` | 새 제작의 결과 — `outcome`·`charged_source`(base/ad/none)·`usage_month`(실제 원래 사용월)·`result_id`·`request_id`·`char_count` | 같음 |
| 광고 | `reward_offer` / `reward_view_started` / `reward_pending` / `reward_granted` / `reward_spent` | 제안을 보였다 / 시청 시작 / 시청이 끝나 서버 확인(SSV) 대기 / 적립 확인(`duration_ms` = 대기) / 보상을 썼다 | 광고 보상 흐름 |
| 콘텐츠 | `content_selected` | 응원의 고정/다양하게(`content_mode` = `fixed`/`varied`, voice-and-message §5-4). **저장에 성공한** 응원 알람의 선택이다 — 편집기에서 눌러만 보고 취소한 것은 적지 않는다. 고정한 문구 ID 는 싣지 않는다(담을 정해진 칸이 없다) | 알람 저장 성공 한 곳(「직전 선택 유지」와 같은 시점), 저장을 **시작한** 계정으로 |
| | `dated_alarm_saved` / `pack_selected` | 날짜 알람 저장, 팩별 사용 | **스키마만** — 그 기능 PR 이 심는다 |
| 소식 | `briefing_opened` / `source_opened` / `briefing_audio_requested` | 아침 소식 화면이 열렸다(`surface` = `menu`) / 원문 링크를 열었다 / '음성 만들기' 로 음성 문장을 요청했다(보내기 **전에** 적는다 — 결과는 직접 입력과 같은 길이 말한다). 원천 구분은 `surface` = `disclosure`(공시)·`policy_news`(정책뉴스)뿐이다. **관심기업·기업 고유번호·접수번호·기사 제목·원문·URL 을 싣지 않는다** | 아침 소식 화면(열림은 화면 하나에 한 번) |
| 결제 | `paywall_viewed` / `store_purchase_verified` / `entitlement_changed` | 결제 화면(`surface`) / 스토어 구매를 서버가 확인했다(`product_id`·`store_offer`·`outcome`) / 앱이 본 플랜이 바뀌었다(`from_plan`→`to_plan`) | 결제 화면·구매 흐름·플랜 갱신 |

⚠ **기존 `alarm_created` 를 저장 시도로 재해석하지 않는다.** `alarm_created` 는 '로컬 행이 생겼다' 이고, 저장 시도·막힘·
준비 완료는 새 종류가 따로 말한다. 이름이 겹치는 종류는 없다(1판·2판 목록은 shared 에서 서로 겹치지 않음을 테스트가 고정).

### 7.2 공통 필드와 정해진 칸

- `id`(= 지시서의 `event_id`, 기기 UUID — §3 그대로) · `schema_version`(없으면 1, 2판은 2) · `occurred_at` · `received_at`(서버)
  · `platform`(android|ios) · `app_version`(**적는 순간의** 안드로이드 versionCode·iOS 빌드 번호) · `feature_version`(그 기록을
  만든 흐름의 판 — 흐름을 바꾸면 올려 집계를 가른다) · `attempt_id`(한 시도를 묶는 UUID).
- 나머지는 `props` 의 **정해진 칸**이다(`UsageEventPropsSchema`). 서버는 칸마다 열을 하나씩 두고(#142) 그대로 옮긴다 —
  ⚠ 큰 JSON 을 `detail`(120자)에 끼워 넣지 않는다.
- 칸은 모양을 막는다: 사유·단계·수단·코드 칸은 영문 소문자 코드(`^[a-z0-9][a-z0-9_.-]{0,63}$`)만, 수는 범위를 둔다.
  **모르는 칸·모르는 종류는 400** 이다 — 앱이 서버보다 앞서 나가도 조용히 버려지지 않게(§1 과 같은 이유). 새 칸·종류는
  **서버를 먼저** 올린다.
- 1판 기록의 `platform` 은 요청 헤더(`X-App-Platform`)로 채운다 — 같은 기기라 큐를 건너도 바뀌지 않는다. `app_version` 은
  채우지 않는다 — 업데이트를 건너 남은 큐의 사건은 보내는 앱의 버전에서 일어나지 않았다.
- **권한 출처(`entitlement_source`)는 서버가 찍는다** — 앱은 보내지 않는다(보내면 400). 받는 순간의 계정 상태로 하나를 고르고
  (`paid` > `trial` > `admin` > `promo` > `free`), 한 기록에 값이 하나라 출처별 사람을 더해도 같은 사람이 두 번 세지지 않는다.
  ⚠ 서버의 구독 행에는 아직 스토어 무료 체험 구간 표식이 없어 **`trial` 은 찍히지 않고 체험 구독은 `paid` 로 섞인다.**
  체험과 결제는 `store_purchase_verified` 의 `store_offer`(앱이 스토어에서 읽은 조건)로 가른다. 표식이 생기면
  `lib/usage-entitlement.ts` 에 갈래 하나를 더한다. 며칠 밀린 배치는 '받은 시각의 권한' 이다.
- 제작은 `charged_source` = `base`(월 기본분 — 무료 3·유료 30)/`ad`(광고 보상)/`none`(세지 않음 — 재사용·실패 환불)과 **실제 원래
  사용월**(`usage_month` — 서버가 기본분을 차감한 KST 달, `POST /tts/generate` 응답의 `usage_month`. 월 경계를 넘긴 재시도도 처음 달.
  광고 보상은 비운다), `result_id`·`request_id` 를 함께 적어 결과와 요청을 내부에서 잇는다. 두 값 다 서버 응답을 그대로 옮기고 앱이 지어내지
  않는다 — 연결이 끊겨 셌는지 모르면 비운다. 문구 원문은 싣지 않고 `char_count` 만 남긴다.

### 7.3 한 번만, 정확한 시간으로

- **같은 다운로드를 여러 화면이 지켜봐도 작업 소유자(워커·프리페처) 한 곳만** 준비 기록을 적는다. 화면은 적지 않는다.
- `duration_ms` 는 **단조 시계**로 잰다(안드로이드 `SystemClock.elapsedRealtime`, iOS `ContinuousClock`). 벽시계 차이로 재면
  시계를 돌린 구간에서 음수·거대값이 나온다.
- 시작·완료·실패는 같은 `attempt_id` 를 쓴다. **앱을 다시 켜면 새 시도다** — 이전의 미완료 시작은 실패로 세지 않는다
  (관리자 화면은 '끝나지 않은 시작' 으로 따로 센다). 완료·실패도 시작의 `cache_state` 를 그대로 싣는다 — 이미 다 있던
  시도(`warm`)는 대기시간에서 뺀다. 지금 두 앱은 **받을 것이 없는 회차를 아예 적지 않아**(복귀마다 도는 보충이 기록을 쌓지 않게)
  `warm` 은 사실상 나오지 않는다. 매니페스트를 받기 전에 실패하면 대상을 몰라 적지 않고, 매니페스트에 판 값이 없어 `revision` 은
  아직 비어 있다.
- **준비 시작 → 알람 저장의 차이는 다운로드 대기시간이 아니다** — 사이에 사용자가 고르는 시간이 섞인다. 대기시간은 작업이 잰
  `duration_ms` 만 쓴다.
- 울림 경로는 1판 그대로 **로컬 큐에 적기만** 한다(§2). 2판 종류 중 울림 경로에서 적는 것은 없다.

### 7.4 가입 전 수집은 하지 않는다 — 익명 세션은 **별도 동의·계약 필요, 미구현**

- 기록기는 계정을 모르면 적지 않는다(§4). 그래서 로그인 전 샘플·선택·로그인 실패는 **남지 않는다.**
- ⚠ **가입 전 사건을 모아 두었다가 로그인 뒤 계정을 붙여 보내는 우회를 만들지 않는다**(지시서 10.3). 지금의 수신은 처리방침
  고지(동의) 이전 사건을 받지 않는 구조이고(§3), 그 우회는 그 구조를 그대로 무너뜨린다.
- 로그인 전 퍼널을 재려면 **별도 계약**이 먼저다: 고지·필요 동의 상태, 측정 거부자는 그대로 쓰고 수집하지 않음, 분모는
  '측정 허용 신규 세션' 임을 표시, 광고 ID·기기 지문을 분석 식별자로 쓰지 않음, 익명 세션과 계정의 연결은 허용한 범위에서만,
  세션 만료·삭제. **미구현**이다 — 이 계약 없이 익명 기록 경로를 만들지 말 것.
- 그래서 관리자 퍼널의 첫 칸은 '앱을 처음 연 사람' 이 아니라 '로그인·동의한 계정 중 그 단계를 한 사람' 이다.

### 7.5 고지가 먼저다 — 2판 칸은 처리방침 8판 동의자부터

2판의 칸(앱 버전·플랫폼·준비시간·바이트·글자 수·실패 코드·정산 수단·권한 출처·결제 화면·광고 보상 단계)과 2판 종류는
지금 처리방침(7판) 1.2 「서비스 이용 기록」이 고지한 범위("사건 시각과 알람·음성 프로필·문구의 식별자만")를 넘는다.
그래서 서버는 **`USAGE_EVENT_DETAIL_MIN_PRIVACY_VERSION`(8) 이상의 privacy 동의를 연속으로 충족하기 시작한 뒤의 사건만**
2판으로 저장한다(`lib/consent.ts` 의 `usageEventDetailConsentSince`). 그 전 사건은:

- 1판 종류는 **2판 칸을 비워** 1판으로 저장한다(`schema_version` 1 — 집계에서 2판과 섞이지 않는다).
- 2판 종류는 **버린다.** 둘 다 200 으로 답해 앱이 큐를 비운다(§3 과 같은 이유 — 고지 전 기록을 나중에 받아 주지 않는다).

⚠ **지금은 일부러 꺼져 있다.** 8판이 아직 없어(저장된 미래 버전은 읽을 때 0 이 된다) 2판 칸은 하나도 저장되지 않는다. 앱은
그래도 적고 보낸다 — 켜는 날부터 새 사건이 모인다. 켜는 순서: ① 처리방침 1.2 에 아래 취지의 고지를 더한 8판(서버 먼저 —
`CLAUDE.md` 「법무 문서 버전」) ② 8판을 실은 앱 게재 ③ 기존 사용자까지 모으려면 privacy 최소 버전을 8 로 올려 재동의(그
판단은 오너·법무). 숫자를 낮춰 7판 동의자에게 소급하지 말 것.

고지에 더할 취지(문안은 법무 검토 뒤 확정): 앱 버전·운영체제 종류, 음성 준비에 걸린 시간·내려받은 용량·실패 코드, 알람 저장
시도·막힌 사유, 직접 입력 음성의 새 제작·재사용 여부·글자 수·차감 수단, 광고 보상의 제안·시청·지급·사용 단계, 결제 화면 열람·
스토어 구매 확인 결과·이용권 출처. 문구 원문·음성 파일·관심기업·기사 원문은 담지 않는다. 보관은 1년(§6) 그대로다.

### 7.6 집계

관리자 콘솔 「사용 지표」(`/admin/usage`, `docs/spec/admin-console.md`)가 기간·플랫폼·앱 버전·권한 출처로 거른다.

- ⚠ **iOS 에서 관측하지 못한 울림을 0회로 단정하지 않는다**(§2 — 아무도 안 누른 울림은 적히지 않는다). 화면은 '관측한 울림' 이라
  부르고, iOS 칸이 비면 '관측 없음' 이라 쓴다.
- ⚠ **해제를 기상 성공으로 세지 않는다.** `screen_off`·`left_screen` 해제는 사람이 끄지 않은 해제다(§1).
- 광고 지급 누락은 '대기로 적힌 지 30분이 지났는데 같은 시도의 지급이 없는 것' 이다. 순수익·제작 비용은 이 기록으로 알 수 없다.

## 구현 지도

| 규칙 | Android | iOS | 백엔드 |
| --- | --- | --- | --- |
| 종류 목록 | `data/UsageEventRecorder.kt` 의 `UsageEvents` | `UsageEventQueue.swift` 의 `UsageEventType` | `packages/shared/src/schemas/usage-event.ts` |
| 로컬 큐 | `data/UsageEventEntity.kt`(Room) | `UsageEventQueue.swift`(파일) | — |
| 전송 | `sync/UsageEventUploadWorker.kt` | `UsageEventUploader.swift` | `routes/events.ts` |
| 백그라운드 전송 예산 | WorkManager의 주기 전송 | `BackgroundSyncTask.runAndSchedule` → `flush(maxBatches: 1)`·`BackgroundTaskCompletion` | — |
| 트랜잭션 내 DB 묶음 | — | — | `routes/events.ts`의 기존 UUID 조회 batch·순서 보존 쓰기 batch |
| 울림 기록 | `alarm/RingingService.kt` 의 `startRinging` — 언제나 | `AlarmKitViewModel.swift` 의 `.alerting` 진입(표는 `ObservedRingMarkerStore.beginObservation` 으로 **동기로** 뽑고, 울림이 **적힌 뒤** 콜백이 `commit`), 관찰자가 못 봤으면 `Shared/AlarmIntents.swift` 의 `recordRingIfObserverMissedIt` | — |
| 울림 중복 판정 | — (울림 서비스가 그 자리에서 적어 갈림길이 없다) | `ObservedRingMarkerStore.swift` 의 `beginObservation`·`commit`·`consume`·`staleAfter`(디스크 표시 = 벽시계)·`lateMarkWindow`(메모리 = 단조 시계 `monotonicNow`) | — (사건 `id` 가 달라 `INSERT OR IGNORE` 로는 안 걸린다) |
| 알람 생성·수정·삭제 | `data/AlarmRepository.kt` 의 `recordAlarmEvent` | `Views/Editor/AlarmEditorSheet.swift` 의 `recordSaveUsageEvent`, `AlarmKitViewModel.deleteLocalAlarm` | — |
| 사용중/비사용중 | 붙임 `recordAlarmEvent` / 놓음 `deleteAlarmLocked`·`updateAlarm`(`manualMessageReleasedByEdit`) | 붙임·놓음 모두 `AlarmEditorSheet.recordSaveUsageEvent`, 삭제는 `AlarmKitViewModel.deleteLocalAlarm` | `message_library.in_use` |
| 해제 | `alarm/RingingService.kt` 의 `dismiss` — Intent 의 알람 id 로 **무조건** 적는다 | `Shared/AlarmIntents.swift` 의 `StopAlarmIntent` — **누른 자리**에서 적고(`handleAlarmStopped` 는 알람을 지우거나 끌 때도 불린다) **조회에 매달지 않는다**(콜드 부팅에서는 기록을 못 찾는다) | — |
| 다시 울림 | `alarm/RingingService.kt` 의 `snooze` — `repository.snooze` 의 **결과를 보고** 적는다(null 이면 해제 + `SNOOZE_DENIED_DETAIL`, 던지면 결과를 몰라 미룸 + `SNOOZE_FAILED_DETAIL` 이고 알람은 끝내지 않는다) | `Shared/AlarmIntents.swift` 의 `SnoozeAlarmIntent` — `.deny` 면 해제 + `"snooze_denied"`, 아니면 `AlarmAppContext.rearmCountdown` 이 **돌아온 뒤에** 미룸으로 적고, 던지면 stop + 해제 + `"snooze_failed"` | — |
| 계정이 바뀌면 멈춤 | `sync/UsageEventUploadWorker.kt` 의 `startGeneration` 비교 | `UsageEventUploader.swift` 의 `runIfCurrentSession`(세대 카운터가 없어 **토큰을 에폭으로** 쓴다) | — |
| 남긴 계정 | `data/UsageEventRecorder.kt` 의 `currentUserId` | `UsageEventQueue.swift` 의 `currentUserID` | — |
| 동의가 모자라면 받고 버림 | — (2xx 라 큐를 비운다) | 같음 | `routes/events.ts`(고지 버전·필수 동의) + `middleware/consent.ts` 의 `POST /events` 면제 |
| 동의 전 발생한 지연 기록 제외 | — (2xx 라 큐를 비운다) | 같음 | `lib/consent.ts`의 `usageEventConsentSince` → `routes/events.ts`의 발생 시각 필터 — `usage-events.test.ts`·`consent.test.ts` |
| 미래 시각의 기록 제외 | — (2xx 라 큐를 비운다) | 같음 | `routes/events.ts`의 원본 발생 시각 필터(`receivedAtMs` 이하), 통과 뒤 UTC 정규화 — `usage-events.test.ts` |
| 보관 기간 | — | — | `index.ts` 의 `USAGE_EVENT_RETENTION_DAYS` |
| 계정 파기 시 삭제 | — | — | `lib/account-deletion.ts` 의 `purgeUserAccount` |
| 2판 종류·칸 | `data/UsageEventRecorder.kt` 의 `UsageEvents`, `data/UsageEventProps.kt`(`sanitized` — 서버 모양에 안 맞는 칸만 비운다) | `UsageEventQueue.swift` 의 `UsageEventType`·`UsageEventProps`(`sanitized`) | `packages/shared/src/schemas/usage-event.ts` 의 `USAGE_EVENT_V2_TYPES`·`UsageEventPropsSchema` |
| 2판 로컬 큐·공통 필드 | `data/UsageEventEntity.kt`(Room 30 — `MIGRATION_29_30`, 옛 행은 1판), `UsageEventRecorder.record`(schemaVersion 2·versionCode) | `UsageEventQueue.record`(옛 큐 파일은 그대로 디코드, CFBundleVersion), `UsageEventContract` | — |
| 2판 전송 | `network/UsageEventApi.kt` 의 `UsageEventPayload`, `sync/UsageEventUploadWorker.kt` | `AlarmTalkAPI.swift` 의 사용 기록 Payload(1판 기록은 2판 키 없음) | `routes/events.ts` |
| 샘플 재생 시작·끝까지 | `data/UsageSignals.kt` 의 `SamplePlayback` ← `ui/onboarding/VoiceOnboardingPreviewState.kt` 의 `previewVoice`, `ui/voices/VoiceProfileManagementPanel.kt` 의 `playGreeting`·`playGreetingClip` | `VoiceStudioViewModel.previewGreeting` → `trackSamplePlayback`(끝은 `AudioPreviewPlayer.onPlayedToEnd`) | — |
| 로그인 결과 | `ui/main/MainViewModelAuthActions.kt` 의 `recordAuthSuccess`(세션 저장 뒤) | `AuthViewModel.adoptSignedInSession` | — |
| 첫 경험 단계 | `ui/main/MainViewModel.kt` 의 `skipVoiceSetup`·`completeVoiceSetupIfDownloaded` | `RootView.completeVoiceSetup`·`skipVoiceSetup` → `recordOnboardingStep` | — |
| 목소리 선택 | `ui/editor/VoiceAudioCard.kt` 의 `applyVoiceSelection` → `UsageSignals.voiceSelected` | `AlarmEditorSheet.commitVoiceSelection` → `recordVoiceSelected` | — |
| 음성 준비(작업 소유자 한 곳) | 기본 목소리 전체 `sync/StockClipPrefetchWorker.kt` 의 `runWork`, 목소리 하나 `ui/main/MainViewModelVoiceActions.kt` 의 `cacheVoiceClips` | `StockClipPrefetcher.start` 의 `PreparationReport`(`recordStartIfNeeded`·`recordEnd`) | — |
| 저장 시도·막힘·준비 완료 | `data/UsageSignals.kt` 의 `AlarmSaveAttempts` ← `ui/editor/AlarmEditorScreen.kt`(`onSave`·`showSaveBlockAlert`·`saveEditor`), 준비 완료는 `MainViewModelAlarmActions.recordAlarmReadyIfReady` → `AlarmRepository.isReadyToRing`(`AlarmScheduler.isScheduled` + 파일) | `AlarmEditorSheet.saveFlow` 의 `beginSaveAttempt`·`recordSaveBlocked`, `finishScheduling` 의 `recordAlarmReadyIfComplete` | — |
| 직접 입력 재사용·생성 결과 | 기기 `AlarmEditorScreen.kt` 의 `manualAudioReuse` `onFound`, 서버·결과 `UsageSignals.recordManualGenerationResult`(실패는 `startGeneration` 의 `onFailure`) | 기기 `VoiceStudioViewModel.recordManualLocalReuse`, 서버·결과 `recordManualGenerationAnswer`·`recordManualGenerationFailure` | `routes/tts.ts` 응답의 `cache_hit`·`charged_source`·`usage_month` |
| 광고 보상 | `data/UsageSignals.kt` 의 `AdRewardAttempts` ← 편집기 플랜 게이트·`AlarmEditorScreen.watchRewardedAd`(지급은 서버 적립을 확인했을 때만) | — (광고 보상 흐름 없음, 종류만) | — |
| 응원 고정/다양하게(`content_selected`) — 저장 성공 때만 | `data/UsageSignals.kt` 의 `contentSelectionProps`·`recordContentSelected` ← `ui/main/MainViewModelAlarmActions.kt` 의 `createAlarm`·`updateAlarm` `onSuccess`(계정은 시작할 때 잡은 `ownerUserId`) — 회귀 `ContentAndBriefingSignalsTest`·`ContentAndBriefingSignalWiringTest` | `CheerVariety.contentSelectionProps(for:)` ← `AlarmEditorSheet.finishScheduling` 의 성공 끝(`userID: ownerID`) — 회귀 `ContentAndBriefingSignalsTests` | — |
| 아침 소식 열람·원문·음성 요청(원천 종류만) | `data/UsageSignals.kt` 의 `BriefingSignals`·`BriefingSource` ← `ui/briefing/BriefingScreen.kt`(열림 `LaunchedEffect` + `rememberSaveable`, 원문 `onOpen`, 음성 `BriefingSpeechDialog.generate`) | `BriefingView.swift` 의 `BriefingUsageSignals`·`BriefingSource` ← `.task`(열림 `openRecorded`), `BriefingItemActions`(원문), `BriefingSpeechSheet.generate`(음성) | — |
| 결제 화면·구매 확인·플랜 변경 | `ui/alarms/AlarmListScreen.kt`(이용권 탭)·편집기 플랜 게이트, `MainViewModelBillingActions.recordStorePurchaseVerified`(`store_offer` 는 `PlayBillingManager.launchPurchase` 가 고른 오퍼), `MainViewModelAuthActions.refreshAppSessionNow` | `BillingPanel` 의 `.onAppear`, `SubscriptionManager.purchase` → `recordPurchaseVerified`(`transaction.offer`), `AuthViewModel.persistSession` → `recordPlanChangeIfNeeded` | — |
| 2판 열 | — | — | 마이그레이션 #142(`usage-events-v2-fields`), `routes/events.ts` 의 `PROP_COLUMNS` — `usage-events.test.ts` 「2판」 |
| 권한 출처(서버가 찍음) | — | — | `lib/usage-entitlement.ts` 의 `loadEntitlementSource` — `admin-usage-metrics.test.ts` 「권한 출처」 |
| 고지 전이면 1판으로 줄이거나 버림 | — (2xx 라 큐를 비운다) | 같음 | `lib/consent.ts` 의 `USAGE_EVENT_DETAIL_MIN_PRIVACY_VERSION`·`usageEventDetailConsentSince` → `routes/events.ts` 의 `toV1` — `consent.test.ts`·`usage-events.test.ts` |
| 1판 기록의 플랫폼 | — | — | `routes/events.ts`(요청 헤더 `X-App-Platform`) |
| 집계 | — | — | `lib/admin/usage-metrics.ts`·`lib/admin/usage-pages.ts`, `routes/admin.ts` 의 `/usage` |
