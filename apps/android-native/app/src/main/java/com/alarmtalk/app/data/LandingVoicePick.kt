package com.alarmtalk.app.data

import android.content.Context

/**
 * **로그인 전 랜딩에서 들어 보고 고른 기본 목소리**(2026-10-26 v1.3 W04). 계정이 없을 때라 계정별 키가 아니라 기기 하나의 값이다.
 *
 * 로그인한 계정이 **아직 목소리를 고른 적이 없으면** 그 계정의 직전 선택(`DefaultVoicePreferenceStore`)으로 한 번 옮기고 지운다
 * (`MainViewModel.checkVoiceSetupFor`). 이미 고른 적이 있으면 그 값이 이긴다 — 랜딩에서 눌러 본 것으로 기존 사용자의 선택을
 * 덮지 않는다. 기본(시스템) 목소리만 받는다.
 */
class LandingVoicePick(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun set(voiceId: String) {
        if (!isSystemVoiceId(voiceId)) return
        prefs.edit().putString(KEY_VOICE_ID, voiceId).apply()
    }

    /** 고른 값을 꺼내고 지운다(한 번만 옮긴다). */
    fun take(): String? {
        val value = prefs.getString(KEY_VOICE_ID, null)?.takeIf { isSystemVoiceId(it) }
        prefs.edit().remove(KEY_VOICE_ID).apply()
        return value
    }

    private companion object {
        const val PREFS_NAME = "alarmtalk_landing_voice"
        const val KEY_VOICE_ID = "voice_id"
    }
}
