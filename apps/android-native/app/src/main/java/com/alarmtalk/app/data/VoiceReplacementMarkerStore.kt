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
 * **본 값과 반영한 값을 따로 적는다.** 처음 본 프로필은 조용히 '봤다' 로만 적는데, 그걸
 * '반영했다' 로도 읽으면 곧이어 도착한 푸시가 **아무것도 하지 않고** 끝난다(둘의 순서는
 * 플랫폼마다 다르다 — iOS 는 목록 갱신이 푸시 처리보다 먼저 끝난다).
 *
 * ⚠ **표식은 뒤로 가지 않는다.** 공유 목소리 목록은 내 목소리 목록과 갱신 경로가 달라
 * 한쪽이 몇 분 낡은 채로 판정에 들어올 수 있다. 되돌아가는 것을 허용하면 이미 처리한
 * 교체를 다시 처리하고, 그 사이 **새 목소리로** 만든 알람을 지운다.
 *
 * ⚠ `updated_at` 으로 대신하지 말 것 — 이름 변경·공유 토글도 그 값을 올리므로, 이름만 바꿔도
 * 알람이 사라진다.
 *
 * ⚠ **읽고-고쳐-쓰기를 직렬화한다.** 전경 새로고침과 [VoiceAccessSyncWorker] 는 같은 프로세스의
 * 다른 스레드에서 동시에 돌 수 있다. 둘이 같은 옛 값을 읽고 각자 max 를 계산하면 **늦게 쓴
 * 쪽이 이겨** 표식이 과거로 되돌아가고, 다음 회차가 이미 처리한 교체를 다시 처리한다
 * (그 사이 새 목소리로 만든 알람을 지운다). 값 비교만으로는 못 막는다.
 *
 * 계정별이다. 앞 사람의 표식이 새 계정 판정에 쓰이면 안 된다.
 *
 * ⚠ **로그아웃에서 지우지 말 것.** 로그아웃은 로컬 알람을 지우지 않고 끄기만 한다 — 그 사이
 * 다른 기기에서 교체가 일어나고 같은 계정이 다시 들어오면, 표식이 없는 기기는 첫 조회를
 * '처음 봤다' 로 읽어 **영영 강등하지 않는다.** 그 알람을 다시 켜면 지운 목소리로 운다.
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
    fun changed(userId: String?, profileId: String, invalidatedAt: String?): Boolean =
        synchronized(LOCK) {
            if (userId.isNullOrBlank() || profileId.isBlank()) return@synchronized false
            val key = seenKey(userId, profileId)
            val incoming = invalidatedAt.orEmpty()
            if (!prefs.contains(key)) {
                prefs.edit().putString(key, incoming).commit()
                return@synchronized false
            }
            // 서버 값은 `datetime('now')` 문자열이라 사전순 = 시간순이다. 앞선 값이면 무시한다.
            incoming > prefs.getString(key, "").orEmpty()
        }

    /**
     * **이미 반영한 세대인가.** 푸시 경로 전용 — 늦게 도착한 푸시가 그 사이 사용자가
     * **새 목소리로** 다시 만든 직접 입력 알람까지 지우는 것을 막는다.
     *
     * [changed] 가 조용히 적어 둔 '봤다' 는 여기 걸리지 않는다 — 그건 아직 아무것도 내리지
     * 않았다는 뜻이라, 그걸 반영으로 읽으면 푸시가 통째로 무력해진다.
     */
    fun hasApplied(userId: String?, profileId: String, invalidatedAt: String?): Boolean {
        if (userId.isNullOrBlank() || profileId.isBlank() || invalidatedAt.isNullOrBlank()) return false
        val applied = synchronized(LOCK) { prefs.getString(appliedKey(userId, profileId), null) }
            ?: return false
        // ⚠ **같은 값만 보면 안 된다.** 교체가 두 번 일어난 뒤 **앞선** 세대의 푸시가 늦게
        // 도착하면 '아직 안 본 것' 으로 읽혀, 뒤 세대로 만든 알람을 되돌릴 수 없이 지우고
        // 표식까지 과거로 되돌린다. 이미 그 뒤를 반영했으면 처리 완료다.
        return invalidatedAt <= applied
    }

    /**
     * 강등까지 끝났으니 이 값을 '봤고 반영했다' 로 확정한다.
     *
     * ⚠ **앞선 세대로 되돌리지 않는다.** 늦게 도착한 옛 신호가 표식을 과거로 끌어내리면
     * 이미 처리한 교체를 다시 처리한다.
     */
    fun commit(userId: String?, profileId: String, invalidatedAt: String?) {
        if (userId.isNullOrBlank() || profileId.isBlank()) return
        val value = invalidatedAt.orEmpty()
        val seen = seenKey(userId, profileId)
        val applied = appliedKey(userId, profileId)
        // ⚠ 읽기와 쓰기가 한 덩어리여야 한다 — 값 비교만으로는 동시에 도는 두 회차가 같은
        // 옛 값을 읽고 늦게 쓴 쪽으로 되돌아가는 것을 못 막는다. `commit()`(동기 쓰기)이라
        // 락을 놓기 전에 디스크까지 반영된다.
        synchronized(LOCK) {
            prefs.edit()
                .putString(seen, maxOf(value, prefs.getString(seen, "").orEmpty()))
                .putString(applied, maxOf(value, prefs.getString(applied, "").orEmpty()))
                .commit()
        }
    }

    private fun seenKey(userId: String, profileId: String) = "$SEEN_PREFIX$userId:$profileId"
    private fun appliedKey(userId: String, profileId: String) = "$APPLIED_PREFIX$userId:$profileId"

    private companion object {
        const val SEEN_PREFIX = "seen:"
        const val APPLIED_PREFIX = "applied:"

        /** 저장소 인스턴스는 호출부마다 새로 만들어지므로 락은 **프로세스 단위**여야 한다. */
        val LOCK = Any()
    }
}
