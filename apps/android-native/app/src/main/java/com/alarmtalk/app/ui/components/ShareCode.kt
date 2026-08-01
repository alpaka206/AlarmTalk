package com.alarmtalk.app

import android.content.Context
import android.content.Intent

/**
 * 이용권 코드를 앱 밖으로 내보낸다.
 *
 * 코드 문자열만 던지면 받는 사람은 `INV-XXXX-XXXX-XXXX` 한 줄만 보고 **이게 뭔지, 어디에
 * 넣는지, 앱이 뭔지** 를 모른다. 초대 코드를 쥔 사람은 전부 이 경로로 들어오므로, 여기
 * 안내를 붙이는 것이 코드 수신자에게 닿는 유일하고 확실한 자리다.
 *
 * 클립보드에는 **코드만** 넣는다 — 받은 사람이 붙여넣기로 바로 등록할 수 있어야 한다.
 * 공유 본문(EXTRA_TEXT)에만 안내를 싣는다.
 */
internal fun Context.shareRedeemCode(code: String, kind: RedeemCodeKind) {
    val body = getString(
        when (kind) {
            RedeemCodeKind.Invite -> R.string.share_code_invite_body
            RedeemCodeKind.Gift -> R.string.share_code_gift_body
        },
        code,
    )
    val sendIntent = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, body)
    }
    startActivity(
        Intent.createChooser(sendIntent, getString(R.string.social_share_code_chooser_title)),
    )
}

/** 코드 종류에 따라 받는 사람이 할 일이 다르다 — 합류(가족·커플) vs 개인 이용권 활성화. */
internal enum class RedeemCodeKind {
    Invite,
    Gift,
}
