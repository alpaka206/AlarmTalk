package com.alarmtalk.app.data

import android.content.Context
import android.util.Log
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

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
 * **본 값과 반영한 값을 따로 적는다.** 처음 본 프로필은 조용히 '봤다' 로만 적는데, 그걸
 * '반영했다' 로도 읽으면 곧이어 도착한 푸시가 **아무것도 하지 않고** 끝난다(둘의 순서는
 * 플랫폼마다 다르다 — iOS 는 목록 갱신이 푸시 처리보다 먼저 끝난다).
 *
 * ⚠ **판정·강등·확정은 한 임계구역이다.** 이 저장소가 노출하는 것은 [applyIfChanged]·
 * [applyIfNotApplied] 둘뿐이고, 강등을 **락 안에서** 부른다. 판정만 잠그면 소용없다 —
 * 예전에는 새로고침이 판정을 먼저 해 두고 코루틴을 띄웠는데, 그 코루틴이 `restoreMutex`
 * 뒤에서 기다리는 동안 더 새 세대가 강등·확정되고 사용자가 **새 목소리로** 알람을 만들면,
 * 뒤늦게 깨어난 옛 회차가 그 알람을 되돌릴 수 없이 지웠다.
 *
 * ⚠ **표식은 뒤로 가지 않는다.** 공유 목소리 목록은 내 목소리 목록과 갱신 경로가 달라
 * 한쪽이 몇 분 낡은 채로 판정에 들어올 수 있다.
 *
 * ⚠ `updated_at` 으로 대신하지 말 것 — 이름 변경·공유 토글도 그 값을 올리므로, 이름만 바꿔도
 * 알람이 사라진다.
 *
 * ⚠ **로그아웃에서 지우지 말 것.** 로그아웃은 로컬 알람을 지우지 않고 끄기만 한다 — 그 사이
 * 다른 기기에서 교체가 일어나고 같은 계정이 다시 들어오면, 표식이 없는 기기는 첫 조회를
 * '처음 봤다' 로 읽어 **영영 강등하지 않는다.** 그 알람을 다시 켜면 지운 목소리로 운다.
 *
 * 계정별이다. 앞 사람의 표식이 새 계정 판정에 쓰이면 안 된다.
 */
class VoiceReplacementMarkerStore(context: Context) {
    private val prefs = context.applicationContext
        .getSharedPreferences("voice_replacement_marker", Context.MODE_PRIVATE)

    /**
     * **목록에서 새 세대를 봤으면** 강등하고 확정한다(판정→강등→확정이 한 임계구역).
     *
     * 처음 보는 프로필은 조용히 적어 두고 아무것도 하지 않는다 — 첫 조회를 '바뀌었다' 로
     * 읽으면 업데이트 직후 모든 설치가 직접 입력 알람을 되돌릴 수 없이 날린다.
     *
     * @param degrade 강등 개수. **null 이면 확정하지 않는다**(계정이 바뀌었거나 실패해
     *   다음 회차가 다시 집어야 하는 경우).
     * @return 강등 개수와 **디스크까지 남았는가**. 후자가 false 면 호출부가 그 목소리를
     *   계속 '정리 중' 으로 두고 다음 회차가 같은 세대를 다시 집는다.
     */
    suspend fun applyIfChanged(
        userId: String?,
        profileId: String,
        invalidatedAt: String?,
        degrade: suspend () -> Int?,
    ): Result = MUTEX.withLock {
        if (userId.isNullOrBlank() || profileId.isBlank()) return@withLock Result.SKIPPED
        // 첫 조회 시드가 디스크에 못 남으면 **기준선이 없는 것**이다 — 다음 회차가 그때의
        // 세대를 '처음 봤다' 로 다시 적어 그 사이의 교체를 영영 놓친다. 실패를 알린다.
        val seen = seenLocked(userId, profileId, invalidatedAt)
        if (!seen.changed) return@withLock Result(0, seen.persisted)
        val degraded = degrade() ?: run {
            markRetryLocked(userId, profileId, invalidatedAt)
            return@withLock Result(0, persisted = false)
        }
        // ⚠ **확정에 실패한 것도 재시도 대상이다**(Codex #703 P1). 강등은 됐는데 표식만 못
        // 남긴 경우, `commitLocked` 의 롤백으로 기준선은 제자리로 돌아가지만 그 값이 **이미
        // 이 세대와 같으면**(목록이 먼저 시드해 둔 경우) `incoming > baseline` 을 통과하지
        // 못한다 — 다음 회차가 '바뀐 것 없음' 으로 읽고 정리 중 표시를 풀어, 그때 만든 알람을
        // 늦게 도착한 같은 세대의 푸시가 되돌릴 수 없이 벗긴다.
        val persisted = commitLocked(userId, profileId, invalidatedAt)
        if (!persisted) markRetryLocked(userId, profileId, invalidatedAt)
        Result(degraded, persisted)
    }

    /**
     * **아직 반영하지 않은 세대면** 강등하고 확정한다(푸시·교체 직후 경로).
     *
     * 늦게 도착한 푸시가 그 사이 사용자가 **새 목소리로** 다시 만든 알람까지 지우지 않도록,
     * 이미 그 세대 이후를 반영했으면 건너뛴다. 세대를 모르는 옛 신호(`invalidatedAt` 없음)는
     * 예전처럼 무조건 반영하되 **확정하지 않는다** — 무엇을 봤는지 모르기 때문이다.
     */
    suspend fun applyIfNotApplied(
        userId: String?,
        profileId: String,
        invalidatedAt: String?,
        degrade: suspend () -> Int?,
    ): Result = MUTEX.withLock {
        if (userId.isNullOrBlank() || profileId.isBlank()) return@withLock Result.SKIPPED
        val generation = invalidatedAt?.takeIf { it.isNotBlank() }
        if (generation != null && hasAppliedLocked(userId, profileId, generation)) return@withLock Result.SKIPPED
        val degraded = degrade() ?: run {
            markRetryLocked(userId, profileId, generation)
            return@withLock Result(0, persisted = false)
        }
        // 세대를 모르는 옛 신호는 확정할 것이 없다 — 남길 값이 없으니 실패도 아니다.
        val persisted = generation?.let { commitLocked(userId, profileId, it) } ?: true
        // 위 `applyIfChanged` 와 같은 이유로, 확정 실패도 재시도 표식을 남긴다.
        if (!persisted) markRetryLocked(userId, profileId, generation)
        Result(degraded, persisted)
    }

    /**
     * 한 회차의 결과. **강등 개수와 확정 여부를 분리한다** — 확정을 보류한 회차도 이미 내린
     * 것은 사용자에게 알려야 하고(그 회차가 아니면 말할 기회가 없다), 확정하지 못한 세대는
     * 호출부가 계속 '정리 중' 으로 두고 다음 회차가 다시 집어야 한다.
     */
    data class Result(val degraded: Int, val persisted: Boolean) {
        companion object {
            /** 할 일이 없었다 — 실패가 아니다. */
            val SKIPPED = Result(0, persisted = true)
        }
    }

    /** 첫 조회 시드의 결과. `changed` 가 false 면 강등할 것이 없다. */
    private data class Seen(val changed: Boolean, val persisted: Boolean)

    /**
     * **아직 확정하지 못해 고를 수 없는 목소리들.**
     *
     * ⚠ **메모리에만 두면 안 된다**(Codex #703 P1). 확정 실패는 **워커(백그라운드)** 에서도
     * 일어나는데 그쪽에는 화면 상태가 없고, 앱을 껐다 켜면 메모리 표시가 비어 **재시도 전에
     * 잠깐 고를 수 있게** 된다 — 그때 만든 알람을 그 재시도가 벗긴다. 계정별이다.
     */
    fun settlingProfileIds(userId: String?): Set<String> {
        val user = userId?.nilIfBlankOrNull() ?: return emptySet()
        return prefs.getStringSet(settlingKey(user), emptySet())?.toSet().orEmpty()
    }

    /**
     * 확정 성패에 따라 올리거나 내린다.
     *
     * ⚠ **디스크에 못 남겼으면 메모리도 되돌린다**(형제 `seenLocked`·`commitLocked` 와 같은
     * 규칙). `edit()` 은 성패와 무관하게 메모리 맵을 먼저 고치므로, 실패를 버리면 이
     * 프로세스에서만 맞는 값이 되어 **재시작하면 표시가 사라진다** — 재시도 전에 그 목소리를
     * 잠깐 고를 수 있게 되고, 그때 만든 알람을 그 재시도가 벗긴다.
     *
     * @return 디스크까지 남았는가.
     */
    fun setSettling(userId: String?, profileId: String, settling: Boolean): Boolean {
        val user = userId?.nilIfBlankOrNull() ?: return true
        if (profileId.isBlank()) return true
        val key = settlingKey(user)
        val previous = prefs.getStringSet(key, emptySet())?.toSet().orEmpty()
        val next = if (settling) previous + profileId else previous - profileId
        if (next == previous) return true
        if (prefs.edit().putStringSet(key, next.toMutableSet()).commit()) return true
        prefs.edit().putStringSet(key, previous.toMutableSet()).commit()
        Log.w(TAG, "Failed to persist settling state; leaving it retryable")
        return false
    }

    private fun String.nilIfBlankOrNull(): String? = takeIf { it.isNotBlank() }

    private fun settlingKey(userId: String) = "$SETTLING_PREFIX$userId"

    private fun retryKey(userId: String, profileId: String) = "$RETRY_PREFIX$userId:$profileId"

    /** 첫 조회 시드 + 세대 비교. 락을 쥔 채로만 부른다. */
    private fun seenLocked(userId: String, profileId: String, invalidatedAt: String?): Seen {
        val key = seenKey(userId, profileId)
        val incoming = invalidatedAt.orEmpty()
        if (!prefs.contains(key)) {
            // ⚠ **디스크 쓰기 실패를 메모리 값으로 덮지 말 것**(Codex #703 P1).
            // `edit()` 은 성패와 무관하게 **메모리 맵을 먼저 고친다.** 그대로 두면 이
            // 프로세스 안에서는 `contains` 가 true 라 시드가 다시 시도되지 않고, 재시작하면
            // 디스크에 값이 없어 **그때의 세대를 '처음 봤다' 로 다시 적는다** — 그 사이의
            // 교체를 영영 놓쳐 지운 목소리를 문 알람이 그대로 남는다.
            // 실패하면 메모리도 되돌려 이번 회차 안에서 다시 시도할 수 있게 한다.
            if (!prefs.edit().putString(key, incoming).commit()) {
                prefs.edit().remove(key).commit()
                Log.w(TAG, "Failed to seed replacement baseline; leaving it retryable")
                return Seen(changed = false, persisted = false)
            }
            return Seen(changed = false, persisted = true)
        }
        // 서버 값은 `datetime('now')` 문자열이라 사전순 = 시간순이다. 앞선 값이면 무시한다.
        val applied = prefs.getString(appliedKey(userId, profileId), "").orEmpty()
        if (incoming <= applied) return Seen(changed = false, persisted = true)
        // ⚠ **기준선과 같은 세대라도 '시도했다 실패한' 것이면 다시 집는다**(Codex #703 P1,
        // iOS 와 같은 규칙). 목록이 먼저 도착해 그 세대를 기준선으로 적어 둔 뒤 같은 회차의
        // 반영이 실패하면, `incoming > baseline` 을 영영 통과하지 못해 `applied` 가 비어
        // 있는데도 다시 집을 길이 없다 — 회수된 목소리가 예약된 채 남는다.
        if (incoming == prefs.getString(retryKey(userId, profileId), null)) {
            return Seen(changed = true, persisted = true)
        }
        return Seen(
            changed = incoming > prefs.getString(key, "").orEmpty(),
            persisted = true,
        )
    }

    /**
     * 반영에 실패해 **다시 집어야 하는** 세대. 확정하면 지운다.
     *
     * ⚠ **뒤로 되돌리지 않는다**(Codex #703 P1). 세대 B 가 실패해 `retry:B` 가 남은 뒤 늦게
     * 도착한 **앞선** 세대 A 가 또 실패하면, 그대로 쓰면 표식이 `retry:A` 로 내려간다.
     * 권위 목록은 여전히 B 를 주는데 B 는 기준선과 같으므로 `seenLocked` 가
     * `incoming == retry` 도 `incoming > baseline` 도 아니라고 답한다 — **B 는 영영 재시도되지
     * 않고** 회수된 목소리를 문 예약이 남는다. 그래서 항상 **더 뒤 세대**를 남긴다.
     *
     * ⚠ **세대를 모르는 실패는 기준선으로 대신 적는다**(Codex #703 P1). 옛 신호에는
     * `invalidatedAt` 이 없어 남길 값이 없는데, 그냥 지나가면 프로세스가 죽는 순간 재시도
     * 근거가 사라진다(메모리 표시는 사라지고, 다음 목록은 기준선과 같아 '바뀐 것 없음').
     * 그 회차가 실제로 보고 있던 세대는 기준선이므로, 그 값을 재시도 대상으로 적으면
     * 다음 권위 새로고침이 같은 값을 들고 와 그대로 다시 집는다.
     */
    private fun markRetryLocked(userId: String, profileId: String, invalidatedAt: String?) {
        val generation = invalidatedAt?.takeIf { it.isNotBlank() }
            ?: prefs.getString(seenKey(userId, profileId), null)?.takeIf { it.isNotBlank() }
            ?: return
        val key = retryKey(userId, profileId)
        val previous = prefs.getString(key, null).orEmpty()
        val newest = maxOf(generation, previous)
        if (newest == previous) return
        prefs.edit().putString(key, newest).commit()
    }

    /**
     * 이미 반영한 세대인가. **같은 값만 보면 안 된다** — 교체가 두 번 일어난 뒤 앞선 세대의
     * 푸시가 늦게 오면 '아직 안 본 것' 으로 읽혀 뒤 세대로 만든 알람을 지운다.
     */
    private fun hasAppliedLocked(userId: String, profileId: String, invalidatedAt: String): Boolean {
        val applied = prefs.getString(appliedKey(userId, profileId), null) ?: return false
        return invalidatedAt <= applied
    }

    /**
     * 앞선 세대로 되돌리지 않는다. `commit()`(동기 쓰기)이라 락을 놓기 전에 디스크에 남는다.
     *
     * ⚠ **디스크에 못 남겼으면 메모리도 되돌린다**(Codex #703 P1). `edit()` 은 성패와 무관하게
     * 메모리 맵을 먼저 고치므로, 실패를 버리면 이 프로세스는 '반영됨' 으로 읽어 **재시도를
     * 잃고**, 재시작하면 값이 없어 그 세대를 되짚을 근거도 사라진다. 되돌려 두면 다음 회차가
     * 다시 집는다(강등은 멱등이라 한 번 더 도는 것은 해가 없다).
     *
     * @return 디스크까지 남았는가.
     */
    private fun commitLocked(userId: String, profileId: String, invalidatedAt: String?): Boolean {
        val value = invalidatedAt.orEmpty()
        val seen = seenKey(userId, profileId)
        val applied = appliedKey(userId, profileId)
        val previousSeen = prefs.getString(seen, null)
        val previousApplied = prefs.getString(applied, null)
        val committed = prefs.edit()
            .putString(seen, maxOf(value, previousSeen.orEmpty()))
            .putString(applied, maxOf(value, previousApplied.orEmpty()))
            .commit()
        if (committed) {
            // 반영했으니 재시도 표시는 지운다(그 세대든 그보다 앞선 것이든 끝났다).
            val retry = prefs.getString(retryKey(userId, profileId), null)
            if (retry != null && retry <= value) {
                prefs.edit().remove(retryKey(userId, profileId)).commit()
            }
        } else {
            val rollback = prefs.edit()
            if (previousSeen == null) rollback.remove(seen) else rollback.putString(seen, previousSeen)
            if (previousApplied == null) rollback.remove(applied) else rollback.putString(applied, previousApplied)
            rollback.commit()
            Log.w(TAG, "Failed to persist replacement marker; leaving it retryable")
        }
        return committed
    }

    private fun seenKey(userId: String, profileId: String) = "$SEEN_PREFIX$userId:$profileId"
    private fun appliedKey(userId: String, profileId: String) = "$APPLIED_PREFIX$userId:$profileId"

    private companion object {
        const val TAG = "VoiceReplacementMarker"
        const val SEEN_PREFIX = "seen:"
        const val SETTLING_PREFIX = "settling:"
        const val RETRY_PREFIX = "retry:"
        const val APPLIED_PREFIX = "applied:"

        /**
         * 저장소 인스턴스는 호출부마다 새로 만들어지므로 락은 **프로세스 단위**여야 한다.
         * 코루틴 락이라 강등(`suspend`)을 감싼 채 스레드를 붙잡지 않는다.
         *
         * ⚠ 잠금 순서는 언제나 **이 락 → `AlarmRepository.restoreMutex`** 다. 저장소는 이
         * 표식을 만지지 않으므로 반대 방향이 없다(순환 없음).
         */
        val MUTEX = Mutex()
    }
}
