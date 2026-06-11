package com.alarmtalk.app.ui.guide

import android.content.Context

/**
 * 화면별 "처음 사용 가이드" 노출 이력 저장소.
 *
 * `DynamicPromptPreferenceStore` 와 같은 SharedPreferences 패턴. 가이드는 계정과
 * 무관한 기기 단위 UX 라 가이드 id 별 본 여부만 보관한다.
 */
class UsageGuideStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun hasSeen(guideId: String): Boolean = prefs.getBoolean(guideId, false)

    fun markSeen(guideId: String) {
        prefs.edit().putBoolean(guideId, true).apply()
    }

    companion object {
        private const val PREFS_NAME = "usage_guide_seen"
        const val GUIDE_ALARM_EDITOR = "alarm_editor_v1"
        const val GUIDE_VOICE_CREATE = "voice_create_v1"
    }
}
