package com.alarmtalk.app.data

import android.content.Context

/**
 * **예전 캐시 키에 들어 있던 닉네임** — 키 계산에만 쓴다(2026-10-29 닉네임 삭제).
 *
 * 안드로이드는 기본 목소리 직접 입력 음성의 폰 안 재사용 키(`AlarmAudioStore.ttsInputKey`)에 계정 닉네임을 넣어 왔다(iOS 는
 * 넣지 않았다 — 목소리 프로필의 호칭만 넣는다). 서버는 직접 입력 문구에 호칭을 붙이지 않으므로 소리에는 아무 영향이 없었고,
 * 키에만 들어갔다. 닉네임을 지우면 그 키가 바뀌어, 직전에 쓴 문구로 새 알람을 저장할 때 폰에 있는 음성을 못 찾고 서버에서 다시
 * 받는다 — 무료 한도가 한 번 더 깎인다. 그래서 그 계정에서 **처음 본 닉네임을 이 기기에 얼려 두고** 키 계산에만 쓴다.
 * 화면에도, 서버로 보내는 문구에도 쓰지 않는다. 새 계정(닉네임 없음)은 빈 값으로 얼어 키에 아무것도 넣지 않는다.
 */
class LegacyNicknameKeyStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("legacy_nickname_cache_key", Context.MODE_PRIVATE)

    /** [userId] 의 얼린 값. 처음이면 [sessionName](지금 세션의 닉네임 — 서버가 아직 싣는 동안만 있다)으로 얼린다. */
    fun titleFor(userId: String, sessionName: String?): String? {
        val key = "title_$userId"
        if (!prefs.contains(key)) prefs.edit().putString(key, sessionName?.trim().orEmpty()).apply()
        return prefs.getString(key, null)?.takeIf { it.isNotBlank() }
    }
}
