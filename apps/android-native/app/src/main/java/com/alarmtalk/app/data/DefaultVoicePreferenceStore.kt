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
        val skippedKey = skippedKeyFor(userId)
        prefs.edit().apply {
            if (voiceId.isNullOrBlank()) {
                remove(key)
            } else {
                putString(key, voiceId)
                if (skippedKey != null) remove(skippedKey)
            }
        }.apply()
    }

    /** 사용자가 기본 목소리를 한 번이라도 골랐는지(온보딩 목소리 스텝 완료 판정). */
    fun hasChosen(userId: String?): Boolean = read(userId) != null

    fun markSkipped(userId: String?) {
        val key = skippedKeyFor(userId) ?: return
        prefs.edit().putBoolean(key, true).apply()
    }

    /**
     * 사용자가 '나중에 받기'를 눌렀는지. 준비 화면 노출 판정은 이 값만 본다 —
     * hasChosen(기본 목소리 저장 여부)은 이제 '마지막에 쓴 목소리' 기록이라
     * 다운로드 완료 여부와 무관하다.
     */
    fun hasSkipped(userId: String?): Boolean {
        val key = skippedKeyFor(userId) ?: return false
        return prefs.getBoolean(key, false)
    }

    // (기본 목소리 호칭 저장은 제거됨 — 시스템 음성 TTS 는 계정 닉네임으로 부른다.
    //  listenerKeyFor 잔여 키는 clear 에서만 정리한다.)

    fun clear(userId: String?) {
        val voiceKey = keyFor(userId) ?: return
        val listenerKey = listenerKeyFor(userId) ?: return
        val skippedKey = skippedKeyFor(userId) ?: return
        prefs.edit()
            .remove(voiceKey)
            .remove(listenerKey)
            .remove(skippedKey)
            .apply()
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

        private fun skippedKeyFor(userId: String?): String? {
            val id = userId?.trim().orEmpty()
            return if (id.isEmpty()) null else "default_voice_setup_skipped_$id"
        }
    }
}
