package com.alarmtalk.app

import android.content.Context
import android.content.Intent

/**
 * 초대 코드를 앱 밖으로 내보낸다.
 *
 * 코드 문자열만 던지면 받는 사람은 `INV-XXXX-XXXX-XXXX` 한 줄만 보고 **이게 뭔지, 어디에
 * 넣는지, 앱이 뭔지** 를 모른다. 초대 코드를 쥔 사람은 전부 이 경로로 들어오므로, 여기
 * 안내를 붙이는 것이 코드 수신자에게 닿는 유일하고 확실한 자리다.
 *
 * 클립보드에는 **코드만** 넣는다 — 받은 사람이 붙여넣기로 바로 등록할 수 있어야 한다.
 * 공유 본문(EXTRA_TEXT)에만 안내를 싣는다.
 *
 * ⚠ **선물 코드 공유 문구(`share_code_gift_body`)와 코드 종류 구분(`RedeemCodeKind`)은 2026-10-14 에
 * 지웠다 — 되살리지 말 것.** iOS 1.2.12 가 App Store 지침 3.1.1 로 두 번째 반려됐다("선물 코드로
 * 디지털 기능을 연다"). 공유하는 코드는 초대 코드뿐이다. 할인·무료 이용은 스토어 오퍼 코드로 준다.
 */
internal fun Context.shareRedeemCode(code: String) {
    val body = getString(R.string.share_code_invite_body, code)
    val sendIntent = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, body)
    }
    startActivity(
        Intent.createChooser(sendIntent, getString(R.string.social_share_code_chooser_title)),
    )
}
