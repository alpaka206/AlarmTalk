package com.alarmtalk.app

import com.alarmtalk.app.data.AlarmEntity

/**
 * 알람을 켠 순간 화면 아래에 잠깐 띄우는 "N 후에 울려요."(`docs/spec/alarm-editor.md` §7)의 대상 — 방금 켠 **그 알람**과
 * 그 예약 시각이다(전체의 다음 알람이 아니다). 문장은 화면이 띄우는 순간 홈 헤드라인과 같은 함수(`ringInSentence`)로 만든다.
 *
 * [announcedAtElapsedMillis] 는 안내가 생긴 때다(`SystemClock.elapsedRealtime` — 사용자가 시계를 바꿔도 뛰지 않는다).
 * 두 군데에 쓴다. 띄우지 못한 채 오래된 안내를 버리고([ringInAction]), 같은 알람을 다시 켠 안내를 앞 안내와 가른다 —
 * 둘이 같은 값이면 앞 안내를 소진할 때([RingInEvent.Finished]) 방금 켠 안내까지 지워진다.
 */
data class RingInNotice(
    val alarmId: String,
    val fireAtMillis: Long,
    val announcedAtElapsedMillis: Long,
)

/**
 * 안내를 바꾸는 일 — 뷰모델의 저장·스위치·삭제가 **반영된 뒤**와 화면의 표시 완료. 실패는 아무 일도 아니다: 실패 갈래는
 * 이걸 부르지 않으므로 떠 있던 안내도 그대로다(지난 날짜라 켜지지 않은 날짜 알람도 저장소가 예외로 돌려보내 여기 오지 않는다).
 */
internal sealed interface RingInEvent {
    /**
     * 저장(새 알람·기존 알람)이나 목록 스위치(켜기·끄기)가 반영된 뒤의 **그 행**. 켜진 행이면 그 알람이 새 안내가 되고(떠 있던
     * 앞 안내를 밀어낸다 — 방금 켠 것이 말할 대상이다), 꺼진 행이면 그 알람의 안내만 거둔다. 다른 알람의 안내는 둔다.
     */
    data class Applied(val alarm: AlarmEntity, val atElapsedMillis: Long) : RingInEvent

    /** 지웠다 — 여러 개 삭제도 한 개씩 온다. 그 알람의 안내만 거둔다(남기면 없는 알람을 두고 울린다고 말한다). */
    data class Deleted(val alarmId: String) : RingInEvent

    /** 화면이 그 안내를 끝냈다 — 다 보였거나, 도중에 걷었거나, 띄우기 전에 버렸다. 그 사이 들어온 새 안내는 둔다. */
    data class Finished(val notice: RingInNotice) : RingInEvent
}

/** [event] 뒤의 안내. 뷰모델은 이 값을 싣기만 한다(`MainViewModel.applyRingInEvent`) — 규칙은 여기 한 곳이다. */
internal fun RingInNotice?.after(event: RingInEvent): RingInNotice? = when (event) {
    is RingInEvent.Applied ->
        if (event.alarm.enabled) {
            RingInNotice(event.alarm.id, event.alarm.fireAtMillis, event.atElapsedMillis)
        } else {
            withdrawn(event.alarm.id)
        }
    is RingInEvent.Deleted -> withdrawn(event.alarmId)
    is RingInEvent.Finished -> takeUnless { it == event.notice }
}

private fun RingInNotice?.withdrawn(alarmId: String): RingInNotice? = takeUnless { it?.alarmId == alarmId }

/** 화면이 지금 안내를 어떻게 할지([ringInAction]). */
internal enum class RingInAction {
    /** 하단 탭이 없는 화면이다 — 띄우지 않고 남겨 둔다. 저장 직후 편집기가 닫히는 사이에 온 안내가 이 경우다. */
    Wait,

    /** 더는 맞는 말이 아니다 — 띄우지 않고 소진한다. */
    Drop,

    /** 띄운다. */
    Show,
}

/**
 * 띄우려는 순간 안내를 어떻게 할지(§7).
 *
 * - **하단 탭이 있는 화면에서만 띄운다**(스펙의 자리는 '하단 탭 위'다). 편집기 같은 하위 화면에는 탭이 없고 맨 아래에
 *   취소·저장이 있어, 안내가 그 위를 덮는다. 그래서 하위 화면이면 버리지 않고 기다린다 — 저장 직후에는 편집기가 닫히고
 *   탭이 돌아오는 전환 동안 이 상태다.
 * - **그 시각이 이미 지났으면 버린다.** `remainingDurationLabel` 은 0·음수도 "1분" 으로 올리므로, 지난 알람을 두고
 *   "1분 후에 울려요." 라고 말하게 된다.
 * - **생긴 지 [RING_IN_NOTICE_FRESH_MILLIS] 넘게 못 떴으면 버린다.** 정상 경로에서는 곧바로 뜨므로 그만큼 늦었다는 것은
 *   그동안 앱이 멈춰 있었다는 뜻이다(화면 꺼짐·다른 앱 — Compose 는 멈춘 동안 효과를 돌리지 않는다). 그 사이 알람이 울려
 *   꺼졌거나 다음 회차로 옮겨 갔을 수 있는데, 울림·해제는 뷰모델을 거치지 않아 안내를 거두지 못한다.
 *
 * ⚠ **알람 목록(`alarms`)과 대조해 "아직 켜져 있나" 를 보지 않는다.** 목록은 Room 이 쓰기를 늦게 흘려보낸 값이라,
 * 띄우는 순간에는 방금 만든 알람이 아직 없고 방금 켠 알람이 아직 꺼진 행으로 남아 있을 수 있다 — 맞는 안내를 버리게 된다.
 * 그 사이 일어날 수 있는 변화는 위 둘이 덮는다(뷰모델을 거치는 끄기·삭제는 [RingInEvent] 가 바로 거둔다).
 */
internal fun ringInAction(
    notice: RingInNotice,
    onTabScreen: Boolean,
    nowMillis: Long,
    nowElapsedMillis: Long,
): RingInAction = when {
    !onTabScreen -> RingInAction.Wait
    notice.fireAtMillis <= nowMillis -> RingInAction.Drop
    nowElapsedMillis - notice.announcedAtElapsedMillis > RING_IN_NOTICE_FRESH_MILLIS -> RingInAction.Drop
    else -> RingInAction.Show
}

/** 하단 안내가 머무는 시간 — 약 3초(§7). 접근성 설정에서 안내 시간을 늘렸으면 화면이 그만큼 늘린다. */
internal const val RING_IN_NOTICE_MILLIS = 3_000L

/**
 * 생긴 지 이만큼 지나도록 띄우지 못한 안내는 버린다([ringInAction]). 목록 스위치는 그 자리에서, 저장은 편집기가 닫히는
 * 전환(220ms) 뒤에 뜨므로 넉넉히 길고, 앱을 떠났다 돌아온 사용자가 맥락 없이 받을 만큼 길지는 않게.
 */
internal const val RING_IN_NOTICE_FRESH_MILLIS = 5_000L
