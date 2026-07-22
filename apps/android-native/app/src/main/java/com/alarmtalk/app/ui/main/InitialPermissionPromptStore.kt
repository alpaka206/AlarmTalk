package com.alarmtalk.app

import android.content.Context

/**
 * 첫 진입 1회 알림 권한 요청을 이미 띄웠는지 기록한다(기기 단위 SharedPreferences).
 *
 * 알림(POST_NOTIFICATIONS)은 알람 앱의 핵심 권한이라 최초 로그인 직후 한 번 권한 게이트
 * 모달로 요청한다. 이 플래그가 세워지면 이후 콜드스타트/재로그인에서는 자동 재노출하지 않고,
 * 권한이 없으면 알람 만들기 모달·홈 슬림 배너가 대신 처리한다(재노출로 조르지 않기 위함).
 *
 * 권한 자체는 앱 단위(계정 무관)라 사용자별이 아닌 기기 단위 단일 플래그로 둔다.
 */
internal class InitialPermissionPromptStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun hasPrompted(): Boolean = prefs.getBoolean(KEY, false)

    fun markPrompted() {
        prefs.edit().putBoolean(KEY, true).apply()
    }

    private companion object {
        const val PREFS_NAME = "voice_alarm_initial_permission_prompt"
        const val KEY = "initial_alarm_permission_prompted"
    }
}
