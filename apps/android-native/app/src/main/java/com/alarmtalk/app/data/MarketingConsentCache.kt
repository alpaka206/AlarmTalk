package com.alarmtalk.app.data

import android.content.Context

/**
 * 마케팅(광고성 정보 수신) 동의의 '직전 서버 확인값'을 계정별로 로컬 캐시한다.
 * 법적 정보 화면 진입 시 GET 응답이 오기 전에 토글을 즉시(낙관적으로) 띄우기 위한 seed 용도.
 *
 * 값을 모를 때(캐시 없음/다른 계정)엔 [read] 가 null 을 돌려줘, 실제 동의 상태를 'off' 로
 * 오인 표시하지 않도록 한다(동의 토글이라 잘못된 낙관 표시는 금물). 계정 전환 오염을 막기 위해
 * 저장된 userId 와 일치할 때만 값을 돌려준다.
 */
class MarketingConsentCache(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun read(userId: String): Boolean? {
        if (prefs.getString(KEY_USER_ID, null) != userId) return null
        if (!prefs.contains(KEY_AGREED)) return null
        return prefs.getBoolean(KEY_AGREED, false)
    }

    fun write(userId: String, agreed: Boolean) {
        prefs.edit()
            .putString(KEY_USER_ID, userId)
            .putBoolean(KEY_AGREED, agreed)
            .apply()
    }

    companion object {
        private const val PREFS_NAME = "marketing_consent_cache"
        private const val KEY_USER_ID = "user_id"
        private const val KEY_AGREED = "agreed"
    }
}
