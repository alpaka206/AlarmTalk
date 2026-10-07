package com.alarmtalk.app.data

import android.content.Context

/**
 * 목소리별 높이 보정값(`VoiceTuning`)을 기기에 저장한다 — **계정 id + 목소리 id** 키.
 *
 * 서버에는 올리지 않는다. 그래서 같은 목소리라도 다른 기기·재설치·공유받은 사람의 알람에는
 * 걸리지 않는다(스펙 `docs/spec/voice-and-message.md` §4-3).
 *
 * 쓰는 곳은 셋: 등록 미리듣기(저장 확정이 성공한 뒤 기록), 울림(`RingingService`), 편집기의 목소리 크기
 * 미리듣기. 교체 등록은 옛 프로필 행을 재사용하므로(같은 id) 새 값이 옛 값을 덮어쓴다. 0 은 적지 않고
 * 키를 지운다 — '없음' 과 '0' 을 한 상태로 둔다.
 *
 * 지우는 곳: 목소리 삭제·민감 동의 철회는 그 목소리 값([remove]), 명시적 로그아웃·탈퇴는 그 계정 값 전부
 * ([clearUser]). 자동 401 에서는 지우지 않는다 — 같은 사람이 다시 로그인하는 경우가 대부분이다.
 */
class VoiceTuningStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun read(userId: String?, voiceProfileId: String?): VoiceTuning? {
        val key = keyFor(userId, voiceProfileId) ?: return null
        return VoiceTuning.decode(prefs.getString(key, null))
    }

    fun write(userId: String?, voiceProfileId: String?, tuning: VoiceTuning) {
        val key = keyFor(userId, voiceProfileId) ?: return
        val normalized = tuning.normalized()
        if (normalized.isNeutral) {
            prefs.edit().remove(key).apply()
        } else {
            prefs.edit().putString(key, normalized.encode()).apply()
        }
    }

    fun remove(userId: String?, voiceProfileId: String?) {
        val key = keyFor(userId, voiceProfileId) ?: return
        prefs.edit().remove(key).apply()
    }

    /** 그 계정의 값을 모두 지운다 — 명시적 로그아웃·탈퇴. */
    fun clearUser(userId: String?) {
        val user = userId?.trim().orEmpty()
        if (user.isEmpty()) return
        val prefix = "${KEY_PREFIX}${user}_"
        val keys = prefs.all.keys.filter { it.startsWith(prefix) }
        if (keys.isEmpty()) return
        prefs.edit().apply { keys.forEach(::remove) }.apply()
    }

    companion object {
        private const val PREFS_NAME = "voice_tuning"
        private const val KEY_PREFIX = "voice_tuning_"

        private fun keyFor(userId: String?, voiceProfileId: String?): String? {
            val user = userId?.trim().orEmpty()
            val voice = voiceProfileId?.trim().orEmpty()
            if (user.isEmpty() || voice.isEmpty()) return null
            return "$KEY_PREFIX${user}_$voice"
        }
    }
}
