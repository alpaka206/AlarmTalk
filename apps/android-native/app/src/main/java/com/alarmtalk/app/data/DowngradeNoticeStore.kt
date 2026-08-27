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

    /**
     * ⚠ **선언 순서가 곧 우선순위다**(앞이 셈). 원인이 섞이면 **가장 할 수 있는 일이 많은
     * 쪽**으로 말한다 — 무료 강등은 이용권을 다시 등록하면 복원되고, 공유 해제는 새 초대
     * 코드가 필요하며, 교체는 아무 액션도 없다. 뒤엣것으로 뭉치면 사용자가 할 수 있는 일을
     * 안내에서 잃는다.
     */
    enum class Cause {
        /** 유료 → 무료 강등. 이용권을 다시 등록하면 **복원된다**. */
        FREE_PLAN,

        /** 공유받던 목소리가 끊겼다(그룹에서 나감·내보내짐·공유 해제). **복원되지 않는다.** */
        SHARED_RELEASED,

        /**
         * 내가 **목소리를 새로 등록하며 옛 목소리를 교체**했다. 직접 입력 문구로 만들어 둔
         * 알람은 옛 목소리로 합성해 둔 것이라 다시 만들 수 없어 기본 알람음이 된다.
         * 프리셋 알람은 새 목소리로 다시 만들어지므로 그대로 남는다. **복원되지 않는다.**
         */
        VOICE_REPLACED,
    }

    data class Notice(val cause: Cause, val count: Int)

    fun record(userId: String?, cause: Cause, count: Int) {
        if (userId.isNullOrBlank() || count <= 0) return
        // ⚠ **읽기·합치기·쓰기를 통째로 잠근다**(Codex #703 P2). 전경 정리와
        // `VoiceAccessSyncWorker` 가 **서로 다른 인스턴스로** 같은 계정에 동시에 적을 수
        // 있는데, 둘이 같은 이전 값을 읽으면 나중 쓰기가 앞의 것을 통째로 덮는다 — 개수를
        // 잃는다. 잠금은 프로세스 전역이어야 한다(인스턴스마다 두면 소용없다).
        synchronized(RECORD_LOCK) {
            migrateLegacy(userId)
            val previous = prefs.getInt(countKey(userId, cause), 0)
            // ⚠ `apply()` 가 아니라 `commit()` 이다 — 잠금을 놓기 전에 디스크에 남아야 다음
            // 회차가 방금 합친 값을 읽는다(비동기로 미루면 그 사이 읽는 쪽이 옛 값을 본다).
            prefs.edit().putInt(countKey(userId, cause), previous + count).commit()
        }
    }

    /**
     * 지금 띄울 안내.
     *
     * ⚠ **원인은 따로 보관하고, 말할 때만 하나로 고른다**(Codex #703 P2). 예전에는 적는
     * 순간 하나로 뭉갰는데(`minOf`), 그러면 `VOICE_REPLACED` 가 대기 중일 때 `FREE_PLAN`
     * 이 하나 들어오는 것만으로 저장된 원인이 `FREE_PLAN` 이 되어, 유료 복원의
     * `clear(FREE_PLAN)` 이 **복원되지 않는 교체 안내까지** 지웠다.
     *
     * 고르는 규칙은 그대로다 — **가장 할 수 있는 일이 많은 원인**(선언 순서가 앞선 것)으로
     * 말하고, 개수는 대기 중인 것을 **전부 더한다** — 한 번 띄울 때 다 말한다.
     *
     * ⚠ 그래서 '확인' 을 누르면 한 번에 다 지워진다. 다만 **유료 복원처럼 원인 하나만
     * 지우는 경우**에는 남은 원인이 다음에 다시 뜬다 — 그건 의도다(교체 안내는 이용권으로
     * 복원되지 않으므로 사용자가 반드시 봐야 한다).
     */
    fun read(userId: String?): Notice? {
        if (userId.isNullOrBlank()) return null
        synchronized(RECORD_LOCK) { migrateLegacy(userId) }
        var total = 0
        var top: Cause? = null
        for (cause in Cause.values()) {
            val count = prefs.getInt(countKey(userId, cause), 0)
            if (count <= 0) continue
            total += count
            if (top == null) top = cause
        }
        val cause = top ?: return null
        return Notice(cause, total)
    }

    /** 사용자가 '확인' 을 눌렀을 때만 부른다 — 말해 준 것을 전부 비운다. */
    fun clear(userId: String?) {
        if (userId.isNullOrBlank()) return
        // 지우는 것도 같은 잠금 아래에서 한다 — 합치는 중에 지워지면 방금 확인한 안내가
        // 되살아난다(합친 값이 잠금 밖에서 뒤늦게 쓰인다).
        synchronized(RECORD_LOCK) {
            val edit = prefs.edit()
            Cause.values().forEach { edit.remove(countKey(userId, it)) }
            edit.remove(legacyCauseKey(userId)).remove(legacyCountKey(userId)).commit()
        }
    }

    /**
     * **그 원인의 안내만** 지운다.
     *
     * ⚠ 유료 복원은 `FREE_PLAN` 만 지워야 한다(Codex #703 P2). 무조건 비우면 다른 기기가
     * 적어 둔 `VOICE_REPLACED`(복원되지 않는 안내)를 사용자가 보기도 전에 지운다 —
     * `docs/spec/voice-and-message.md` 는 그 안내를 다음에 앱을 열 때까지 남기라고 한다.
     */
    fun clear(userId: String?, cause: Cause) {
        if (userId.isNullOrBlank()) return
        synchronized(RECORD_LOCK) {
            migrateLegacy(userId)
            prefs.edit().remove(countKey(userId, cause)).commit()
        }
    }

    /**
     * 원인을 하나로 뭉개 두던 시절의 행을 원인별 칸으로 옮긴다. 잠금을 쥔 채로만 부른다.
     *
     * 업그레이드 순간 대기 중이던 안내를 잃지 않기 위한 것이고, 한 번 옮기면 옛 키는 없앤다.
     */
    private fun migrateLegacy(userId: String) {
        val rawCause = prefs.getString(legacyCauseKey(userId), null) ?: return
        val count = prefs.getInt(legacyCountKey(userId), 0)
        val cause = runCatching { Cause.valueOf(rawCause) }.getOrNull()
        val edit = prefs.edit().remove(legacyCauseKey(userId)).remove(legacyCountKey(userId))
        if (cause != null && count > 0) {
            edit.putInt(countKey(userId, cause), prefs.getInt(countKey(userId, cause), 0) + count)
        }
        edit.commit()
    }

    private fun countKey(userId: String, cause: Cause) = "pending_count_${cause.name}_$userId"

    private fun legacyCauseKey(userId: String) = "pending_cause_$userId"
    private fun legacyCountKey(userId: String) = "pending_count_$userId"

    private companion object {
        /** `record`/`clear` 의 read-modify-write 를 직렬화한다 — 프로세스 전역이어야 한다. */
        private val RECORD_LOCK = Any()
    }
}
