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
        // 있는데, 둘이 같은 이전 값을 읽으면 나중 쓰기가 앞의 것을 통째로 덮는다 — 개수도
        // 잃고, 이 저장소가 지키기로 한 **우선순위 병합**(액션이 있는 원인이 이긴다)도
        // 깨진다. 잠금은 프로세스 전역이어야 한다(인스턴스마다 두면 소용없다).
        synchronized(RECORD_LOCK) { recordLocked(userId, cause, count) }
    }

    private fun recordLocked(userId: String, cause: Cause, count: Int) {
        val previous = read(userId)
        // 확인 전에 또 강등되면 **합쳐서** 한 번만 알린다 — 모달을 두 번 띄우지 않는다.
        // 원인이 섞이면 무료 강등 쪽으로 말한다(그쪽이 복구 가능하다는 더 쓸모 있는 정보다).
        val mergedCount = (previous?.count ?: 0) + count
        // 섞이면 **우선순위가 높은(= 안내할 액션이 있는) 쪽**으로 말한다. 새로 온 원인으로
        // 덮어쓰면, '이용권 보기' 가 필요한 공유 해제가 액션 없는 교체 안내로 바뀌어 사용자가
        // 고칠 방법을 못 본다. 반대로 전부 FREE_PLAN 으로 뭉치면 유료 사용자에게 "무료로
        // 바뀌었어요" 라는 거짓말을 하게 된다.
        val mergedCause = if (previous == null) cause else minOf(previous.cause, cause)
        // ⚠ `apply()` 가 아니라 `commit()` 이다 — 잠금을 놓기 전에 디스크에 남아야 다음
        // 회차가 방금 합친 값을 읽는다(비동기로 미루면 그 사이 읽는 쪽이 옛 값을 본다).
        prefs.edit()
            .putString(causeKey(userId), mergedCause.name)
            .putInt(countKey(userId), mergedCount)
            .commit()
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
        // 지우는 것도 같은 잠금 아래에서 한다 — 합치는 중에 지워지면 방금 확인한 안내가
        // 되살아난다(합친 값이 잠금 밖에서 뒤늦게 쓰인다).
        synchronized(RECORD_LOCK) {
            prefs.edit().remove(causeKey(userId)).remove(countKey(userId)).commit()
        }
    }

    private fun causeKey(userId: String) = "pending_cause_$userId"
    private fun countKey(userId: String) = "pending_count_$userId"

    private companion object {
        /** `record`/`clear` 의 read-modify-write 를 직렬화한다 — 프로세스 전역이어야 한다. */
        private val RECORD_LOCK = Any()
    }
}
