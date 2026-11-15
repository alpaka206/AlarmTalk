package com.alarmtalk.app

import android.content.Context

/**
 * 목소리 등록 권리 확인 — **계정마다 한 번** 받는다(2026-11-15 오너: "권리 권한도 그냥 앞으로 등록하는 목소리 전부로 해",
 * "등록할때마다 확인받아야한다는건 없잖아").
 *
 * 예전에는 '추가' 를 누를 때마다 입구 모달로 **이번 등록**의 권리를 확인했다. 이제는 '등록' 을 누르는 순간 빠진 법정 동의와
 * 함께 한 시트(`VoiceConsentSheet`)에서 **앞으로 등록하는 목소리 전부**에 대한 확인을 한 번 받고, 계정별로 이 기기에 적는다.
 * 법정 동의 유형이 아니라 서버에 기록하지 않는다(예전 입구 모달도 기록하지 않았다) — 다른 기기에서는 한 번 더 묻는다.
 * 규칙: `docs/spec/consent.md` 「목소리 권리 확인」.
 */
internal object VoiceRightsAttestation {
    private const val PREFS = "voice_rights_attestation"

    private fun key(userId: String) = "attested_$userId"

    fun isAttested(context: Context, userId: String): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(key(userId), false)

    fun markAttested(context: Context, userId: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(key(userId), true).apply()
    }
}
