package com.alarmtalk.app.data

import android.content.Context

/**
 * **제자리 목소리 교체를 스스로 알아채기 위한 표식.**
 *
 * 교체는 옛 프로필 **행을 재사용**한다(id 가 그대로다). 그래서 접근 가능 목록 대조
 * ([AlarmRepository.degradeAlarmsWithInaccessibleVoice])로는 영원히 안 걸리고, 본인 소유
 * 알람은 pull 대상도 아니라 서버가 행을 내려도 그 기기에 닿지 않는다.
 *
 * 푸시(`voice_access_revoked` + `voiceProfileId`)는 **즉시성만** 맡는다 — best-effort 라
 * 오프라인·강제종료·OEM 절전에서 조용히 버려진다. 정확성은 목록을 다시 받는 경로(하루 주기
 * 워커·앱 시작 새로고침)가 서버의 `custom_audio_invalidated_at` 을 여기 적힌 값과 대조해
 * 맡는다. 이게 없으면 푸시를 놓친 기기가 **영원히** 지운 목소리로 운다.
 *
 * ⚠ **처음 본 프로필은 조용히 적기만 한다.** 첫 조회에서 '바뀌었다' 로 읽으면 업그레이드
 * 직후 모든 설치가 직접 입력 알람을 되돌릴 수 없이 날린다. 값이 **이미 있었고 달라졌을
 * 때만** 참이다.
 *
 * ⚠ `updated_at` 으로 대신하지 말 것 — 이름 변경·공유 토글도 그 값을 올리므로, 이름만 바꿔도
 * 알람이 사라진다.
 *
 * 계정별이다. 앞 사람의 표식이 새 계정 판정에 쓰이면 안 된다.
 */
class VoiceReplacementMarkerStore(context: Context) {
    private val prefs = context.applicationContext
        .getSharedPreferences("voice_replacement_marker", Context.MODE_PRIVATE)

    /**
     * **그 사이 교체가 있었는가.** 처음 보는 프로필은 조용히 적어 두고 false 를 돌려준다.
     *
     * ⚠ 바뀐 값은 여기서 적지 **않는다** — 강등이 실제로 끝난 뒤 [commit] 으로 적는다.
     * 여기서 미리 적으면 강등이 실패했을 때 다시는 시도하지 않는다(신호를 잃는다).
     */
    fun changed(userId: String?, profileId: String, invalidatedAt: String?): Boolean {
        if (userId.isNullOrBlank() || profileId.isBlank()) return false
        val key = key(userId, profileId)
        val incoming = invalidatedAt.orEmpty()
        if (!prefs.contains(key)) {
            prefs.edit().putString(key, incoming).apply()
            return false
        }
        return prefs.getString(key, "").orEmpty() != incoming
    }

    /** 강등까지 끝났으니 이 값을 '본 것' 으로 확정한다. */
    fun commit(userId: String?, profileId: String, invalidatedAt: String?) {
        if (userId.isNullOrBlank() || profileId.isBlank()) return
        prefs.edit().putString(key(userId, profileId), invalidatedAt.orEmpty()).apply()
    }

    /** 명시적 로그아웃·탈퇴에서만 부른다(자동 401 은 같은 사람이 다시 들어온다). */
    fun clear(userId: String?) {
        if (userId.isNullOrBlank()) return
        val prefix = "$userId:"
        val doomed = prefs.all.keys.filter { it.startsWith(prefix) }
        if (doomed.isEmpty()) return
        prefs.edit().apply { doomed.forEach { remove(it) } }.apply()
    }

    private fun key(userId: String, profileId: String) = "$userId:$profileId"
}
