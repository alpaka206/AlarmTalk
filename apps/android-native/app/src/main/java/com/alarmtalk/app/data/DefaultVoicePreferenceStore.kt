package com.alarmtalk.app.data

import android.content.Context

/**
 * **알람에 마지막으로 쓴 목소리** id 를 기기에 저장한다(계정별 키). 새 알람 편집기가 처음
 * 고르는 목소리가 이 값이다 — 그래서 이걸 지우면 편집기 프리셀렉트가 통째로 죽는다.
 *
 * 클래스·prefs·키 이름의 `default_` 는 **이력상 남은 이름**이다. 예전에는 목소리 탭에서
 * '기본 목소리'를 직접 지정하게 했는데(그 UI 는 제거됨), 고를 게 하나 더 있는 것보다 마지막에
 * 쓴 것이 다음 기본이 되는 편이 손이 덜 가서 자동 기억으로 대체했다. 이름만 보고 '사장된 기본값
 * 저장소'로 판단해 지우지 말 것.
 *
 * 짝: 마지막에 고른 문구 종류·무료 테마는 `DynamicPromptPreferenceStore` 가 같은 규약으로 맡는다.
 * 기록 시점은 둘 다 **알람 저장 성공 시**(MainViewModel.rememberVoiceUsed /
 * rememberMessageChoiceUsed), 삭제는 **명시적 로그아웃·탈퇴에서만**(자동 401 은 지우지 않는다).
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
