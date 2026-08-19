package com.alarmtalk.app.data

import android.content.Context

/**
 * **"목소리 알람이 기본 알람음으로 바뀌었다" 를 한 번 알리기 위한 대기표.**
 *
 * 왜 저장하는가: 강등이 확정되는 자리는 **화면이 없을 수도 있다** —
 * `VoiceAccessSyncWorker`(백그라운드)도 강등을 한다. 그 순간 토스트를 띄워 봐야 볼 사람이
 * 없다. 그래서 여기 적어 두고, 앱이 **보여줄 수 있는 상태가 됐을 때** 모달로 띄운다.
 *
 * ⚠ **소진 플래그가 아니라 대기표다 — 이 차이가 중요하다.**
 * `PromoPromptStore` 같은 1회성 플래그는 "떴다" 를 기록하므로, 차단 화면 아래에서 잘못
 * 뜨면 **본 적도 없이 소진**된다(`docs/spec/gates-and-overlays.md` — 같은 버그가 네 번 났다).
 * 여기는 반대로 **사용자가 '확인' 을 눌러야 지운다.** 못 보고 지나가면 다음 기회에 또 뜬다.
 * 그래도 띄우는 쪽은 준비 신호를 지킨다 — 차단 화면 위에 겹쳐 봐야 읽을 수 없다.
 *
 * 계정별이다. 앞 사람의 강등 안내가 새 계정에 뜨면 안 된다.
 */
class DowngradeNoticeStore(context: Context) {
    private val prefs = context.applicationContext
        .getSharedPreferences("downgrade_notice", Context.MODE_PRIVATE)

    enum class Cause {
        /** 유료 → 무료 강등. 이용권을 다시 등록하면 **복원된다**. */
        FREE_PLAN,

        /** 공유받던 목소리가 끊겼다(그룹에서 나감·내보내짐·공유 해제). **복원되지 않는다.** */
        SHARED_RELEASED,
    }

    data class Notice(val cause: Cause, val count: Int)

    fun record(userId: String?, cause: Cause, count: Int) {
        if (userId.isNullOrBlank() || count <= 0) return
        val previous = read(userId)
        // 확인 전에 또 강등되면 **합쳐서** 한 번만 알린다 — 모달을 두 번 띄우지 않는다.
        // 원인이 섞이면 무료 강등 쪽으로 말한다(그쪽이 복구 가능하다는 더 쓸모 있는 정보다).
        val mergedCount = (previous?.count ?: 0) + count
        val mergedCause = if (previous != null && previous.cause != cause) Cause.FREE_PLAN else cause
        prefs.edit()
            .putString(causeKey(userId), mergedCause.name)
            .putInt(countKey(userId), mergedCount)
            .apply()
    }

    fun read(userId: String?): Notice? {
        if (userId.isNullOrBlank()) return null
        val rawCause = prefs.getString(causeKey(userId), null) ?: return null
        val count = prefs.getInt(countKey(userId), 0)
        if (count <= 0) return null
        val cause = runCatching { Cause.valueOf(rawCause) }.getOrNull() ?: return null
        return Notice(cause, count)
    }

    /** 사용자가 '확인' 을 눌렀을 때만 부른다. */
    fun clear(userId: String?) {
        if (userId.isNullOrBlank()) return
        prefs.edit().remove(causeKey(userId)).remove(countKey(userId)).apply()
    }

    private fun causeKey(userId: String) = "pending_cause_$userId"
    private fun countKey(userId: String) = "pending_count_$userId"
}
