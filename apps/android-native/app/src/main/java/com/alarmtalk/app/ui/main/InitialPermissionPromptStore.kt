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

    /**
     * 이 **런타임 권한**을 시스템 다이얼로그로 물어본 적이 있는가.
     *
     * 왜 위 단일 플래그로 안 되나: 그건 '첫 진입 1회 안내를 띄웠나' 라는 다른 질문이다.
     * 여기서 필요한 건 권한 하나하나에 대해 "시스템이 이미 물어봤나" 다 —
     * `shouldShowRequestPermissionRationale` 이 false 일 때 **한 번도 안 물어본 것**과
     * **영구 거부**를 가르는 유일한 근거다. 그 둘을 구분 못 하면 영구 거부한 사용자에게
     * 아무 설명 없이 시스템 다이얼로그만 반복해 띄우게 된다(뜨지도 않는다).
     */
    fun hasPrompted(permission: String): Boolean = prefs.getBoolean(permissionKey(permission), false)

    fun markPrompted(permission: String) {
        prefs.edit().putBoolean(permissionKey(permission), true).apply()
    }

    private fun permissionKey(permission: String) = "asked_$permission"

    private companion object {
        const val PREFS_NAME = "voice_alarm_initial_permission_prompt"
        const val KEY = "initial_alarm_permission_prompted"
    }
}
