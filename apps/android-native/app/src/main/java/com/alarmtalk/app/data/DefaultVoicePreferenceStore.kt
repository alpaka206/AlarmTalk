package com.alarmtalk.app.data

import android.content.Context

/**
 * 사용자가 온보딩 "목소리 고르기"에서 선택한 **기본 목소리**(시스템 스톡 보이스) id 를
 * 기기에 저장한다. 기기별 클라이언트 설정이며 유저별 키를 둔다(온보딩 seen_users 와 동일하게).
 *
 * 용도:
 *  - 새 알람 에디터가 이 값을 미리 선택(임의 첫 번째 대신).
 *  - 목소리 탭이 "선택된 기본 목소리 + 변경"으로 노출.
 *  - 한 번이라도 골랐는지로 온보딩 목소리 스텝 노출 여부 판정([hasChosen]).
 *
 * 코드베이스에 DataStore 가 없으므로 다른 설정처럼 SharedPreferences 를 그대로 쓴다.
 */
class DefaultVoicePreferenceStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    /** 저장된 기본 목소리 id. 고른 적 없으면 null. */
    fun read(userId: String?): String? {
        val key = keyFor(userId) ?: return null
        return prefs.getString(key, null)?.takeIf { it.isNotBlank() }
    }

    /** 기본 목소리 선택을 저장한다. voiceId 가 비면 선택을 지운다. */
    fun set(userId: String?, voiceId: String?) {
        val key = keyFor(userId) ?: return
        prefs.edit().apply {
            if (voiceId.isNullOrBlank()) remove(key) else putString(key, voiceId)
        }.apply()
    }

    /** 사용자가 기본 목소리를 한 번이라도 골랐는지(온보딩 목소리 스텝 완료 판정). */
    fun hasChosen(userId: String?): Boolean = read(userId) != null

    /**
     * 기본(시스템) 목소리가 사용자를 부를 호칭(listener_title). 온보딩/목소리 탭에서 정하며,
     * 시스템 음성 알람 TTS 생성 시 listenerTitle 로 쓰인다. (내/공유 음성은 각자 프로필 호칭 사용)
     */
    fun readListenerTitle(userId: String?): String? {
        val key = listenerKeyFor(userId) ?: return null
        return prefs.getString(key, null)?.takeIf { it.isNotBlank() }
    }

    fun setListenerTitle(userId: String?, title: String?) {
        val key = listenerKeyFor(userId) ?: return
        prefs.edit().apply {
            val trimmed = title?.trim()
            if (trimmed.isNullOrEmpty()) remove(key) else putString(key, trimmed)
        }.apply()
    }

    companion object {
        private const val PREFS_NAME = "default_voice_preferences"

        private fun keyFor(userId: String?): String? {
            val id = userId?.trim().orEmpty()
            return if (id.isEmpty()) null else "default_voice_$id"
        }

        private fun listenerKeyFor(userId: String?): String? {
            val id = userId?.trim().orEmpty()
            return if (id.isEmpty()) null else "default_listener_$id"
        }
    }
}
