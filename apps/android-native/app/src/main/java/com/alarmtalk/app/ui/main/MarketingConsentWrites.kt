package com.alarmtalk.app

/**
 * 광고성 정보 수신 토글의 쓰기 하나가 끝난 뒤 할 일(`docs/spec/consent.md` 「광고성 정보 수신 토글」).
 *
 * 스위치는 쓰는 동안에도 눌린다(`ConsentHistoryScreen` — 비활성으로 그리면 색이 두 단계로 바뀐다). 그 사이 누른 값은
 * 마지막 것 하나만 남겨 두었다가(`pendingMarketingConsent`) 지금 쓰기가 끝나면 이어서 보낸다.
 *
 * ⚠ **실패하면 돌아갈 값은 화면 값이 아니라 서버가 가진 값이다.** 이어 보낼 때 화면은 이미 낙관적으로 바뀌어 있다.
 * 예전에는 그 화면 값을 되돌릴 값으로 잡아, 켬(첫 저장 성공) → 끔(이어 보낸 저장 실패) 이면 서버는 켜진 채 스위치만
 * 꺼졌다 — 끈 줄 아는 사람에게 광고 알림이 간다(관리자 콘솔은 이 값으로 받는 사람을 고른다).
 */
internal sealed interface MarketingConsentNext {
    /** 마지막으로 누른 값이 서버 값과 다르다 — 이어서 보낸다. 실패하면 [rollbackTo](지금 서버 값)로 돌아간다. */
    data class Send(val agreed: Boolean, val rollbackTo: Boolean?) : MarketingConsentNext

    /** 더 보낼 것이 없다. 스위치는 [shown](서버 값)을 그리고, [failed] 면 스위치가 되돌아간 이유를 알린다. */
    data class Settle(val shown: Boolean?, val failed: Boolean) : MarketingConsentNext
}

/**
 * @param sent 방금 보낸 값.
 * @param rollbackTo 보내기 전에 서버가 가진 값.
 * @param succeeded 서버가 받았는가.
 * @param queued 쓰는 동안 마지막으로 누른 값. 없으면 null.
 */
internal fun marketingConsentAfterWrite(
    sent: Boolean,
    rollbackTo: Boolean?,
    succeeded: Boolean,
    queued: Boolean?,
): MarketingConsentNext {
    val serverValue = if (succeeded) sent else rollbackTo
    if (queued != null && queued != serverValue) return MarketingConsentNext.Send(queued, rollbackTo = serverValue)
    // 마지막으로 누른 값이 이미 서버에 있으면 이 쓰기가 실패했어도 알릴 것이 없다 — 사용자가 고른 대로다.
    return MarketingConsentNext.Settle(shown = serverValue, failed = !succeeded && queued == null)
}
