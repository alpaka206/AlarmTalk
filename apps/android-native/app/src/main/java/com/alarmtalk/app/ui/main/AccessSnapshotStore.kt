package com.alarmtalk.app

import android.content.Context
import android.util.Log
import com.google.gson.Gson
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import com.alarmtalk.app.network.BillingSubscriptionResponse
import com.alarmtalk.app.network.FamilyGroupCurrentResponse

internal data class AccessSnapshot(
    val subscriptionResponse: BillingSubscriptionResponse? = null,
    val familyGroup: FamilyGroupCurrentResponse? = null,
    /**
     * 스토어가 확인해 준 등급(plan key). null = 무료가 아니라 **확인 못 함**.
     *
     * 울림 시점 게이트(`RingingService`)는 네트워크도 BillingClient 도 붙이지 않고 이 캐시만
     * 읽는다. 그래서 「스토어가 권위다」를 그 경로에서도 지키려면 값을 여기 적어 둬야 한다 —
     * 앱이 전경에서 스토어에 물을 때마다 갱신된다.
     */
    val storePlanKey: String? = null,
    /**
     * 위 값의 **유효기한**(epoch millis). 지나면 없는 것으로 본다.
     *
     * ⚠ **기한 없이 저장하면 영구 통행증이 된다**(2026-08-31 리뷰). 유료 사용자가 앱을 한 번
     * 열고 다시 안 열면, 구독이 만료돼도 이 키가 남아 **울림 게이트가 서버 만료를 무시하고**
     * 클론 목소리를 계속 재생한다 — 로컬 유료 게이트의 존재 이유가 사라진다.
     *
     * Play `Purchase` 에는 **만료 시각이 없다**(AAR 메서드 목록 확인 — `isAutoRenewing` 은
     * 있어도 만료는 없다). 그래서 안드로이드는 **확인 시각 + 보수적 상한**으로 둔다.
     * 상한은 자동갱신 주기(최소 월 단위)보다 훨씬 짧아야 하고, 앱을 며칠 안 열어도 결제 중인
     * 사용자가 잠기지 않을 만큼은 길어야 한다 — 그 사이 값이 [STORE_ENTITLEMENT_TTL_MILLIS] 다.
     * iOS 는 StoreKit 이 실제 만료를 주므로 그 값을 그대로 쓴다.
     */
    val storeEntitlementUntilMillis: Long? = null,
    /**
     * 서버가 말한 `users.plan`. **그룹 접근보다 먼저 본다.**
     *
     * ⚠ 없으면 울림 경로가 `Unknown` 으로 떨어지고, 낙관 규칙상 **통과**한다 — 강등된
     * 사용자의 클론 목소리가 계속 울린다(2026-08-31 리뷰). 결제 보류는 그룹을 남긴 채
     * 이 값만 회수하므로, 그룹만 봐서도 안 된다.
     */
    val userPlan: String? = null,
)

/**
 * 스토어 신호의 신선도 상한 — **40일**.
 *
 * ⚠ **짧게 잡으면 안 된다**(2026-08-31 리뷰 2차 정정). 처음엔 3일로 뒀는데, 그러면
 * **앱을 안 여는 사이 자동갱신된 유료 사용자가 잘린다**: 스토어 신호는 3일 만에 만료되고
 * 서버 스냅샷은 갱신 전 `expires_at` 을 그대로 들고 있다(RTDN 은 서버만 갱신한다) —
 * 울림 게이트가 결제 중인 사용자를 무권한으로 보고 기본 톤으로 바꾼다. 알람 앱은 원래
 * 며칠씩 안 열고 쓰는 물건이라 흔한 경로다.
 *
 * ⚠ **단, 해지 예약(자동갱신 꺼짐)에는 이 상한을 그대로 쓰지 않는다**(2026-09-01 리뷰).
 * 이 기한은 '언제 물어봤는가' 에서 시작하므로, 기간 말 해지를 만료 하루 전에 확인하면 그
 * 뒤 39일을 유료로 통과시킨다. 쓰는 쪽(`refreshStoreEntitlement`)이 `isAutoRenewing == false`
 * 이면 서버가 아는 기간 말로 상한을 낮춘다.
 *
 * 그래서 상한은 **월 구독 주기보다 넉넉히 길게** 둔다. 이 값의 역할은 '만료 감지' 가 아니라
 * **영구 통행증 방지**다 — 만료 감지는 서버 스냅샷의 `expires_at` 이 하고, 그쪽은 앱이
 * 열릴 때마다 갱신된다. 스토어 신호는 "이 기기가 마지막으로 확인했을 때 유효했다" 는
 * 증거이고, 그 증거가 한 결제 주기를 넘겨 살아 있으면 안 되는 정도의 의미다.
 */
internal const val STORE_ENTITLEMENT_TTL_MILLIS: Long = 40L * 24 * 60 * 60 * 1000

internal class AccessSnapshotStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    private val gson = Gson()

    fun read(userId: String): AccessSnapshot =
        prefs.getString(key(userId), null)
            ?.let { raw ->
                runCatching {
                    gson.fromJson(raw, AccessSnapshot::class.java)
                }.onFailure { error ->
                    Log.w(TAG, "Failed to read access snapshot user=$userId", error)
                }.getOrNull()
            }
            ?: AccessSnapshot()

    /**
     * ⚠ **이걸 직접 부르지 말 것 — [EntitlementWriter] 만 부른다.**
     *
     * 이 함수에는 **소유권·신선도 판단이 없다.** 지금 계정이 누구인지, 이 결과가 아직
     * 최신인지 모르는 채 그냥 쓴다. 그 판단은 전부 [EntitlementWriter.apply] 안에 있고,
     * 그래서 쓰는 문이 하나여야 한다.
     *
     * 우회를 막는 장치가 둘이다: 이 이름(눈에 띄게 길다)과
     * `scripts/check-entitlement-writer.py`(CI lint 잡). 새 경로를 만들면 그 검사가 막는다.
     */
    fun patchWithoutOwnershipCheck(userId: String, transform: (AccessSnapshot) -> AccessSnapshot) =
        mutate(userId, transform)

    fun clear(userId: String) {
        synchronized(LOCK) { prefs.edit().remove(key(userId)).apply() }
    }

    /**
     * 읽고-고치고-쓰기를 **직렬화한다**(2026-09-01 리뷰).
     *
     * ⚠ 이 스냅샷은 필드마다 다른 곳에서 갱신된다 — 전경 결제/스토어 갱신과
     * `PlanChangeSyncWorker` 가 **다른 스레드에서 동시에** 들어온다. 잠그지 않으면 둘이 같은
     * 옛 값을 읽고 각자 자기 필드만 얹어 저장해, 나중 쓰기가 상대의 필드를 **지운다**
     * (워커의 구독 갱신이 방금 확인한 `storePlanKey` 를 날리거나, 스토어 갱신이 방금 받은
     * free `userPlan` 을 날린다). 그 결과를 `RingingService` 가 울림 시점에 읽는다.
     *
     * 잠금은 **companion 에 둔다** — 호출부가 `AccessSnapshotStore(context)` 를 그때그때
     * 새로 만들기 때문에 인스턴스 잠금은 아무것도 막지 못한다.
     */
    private fun mutate(userId: String, transform: (AccessSnapshot) -> AccessSnapshot) {
        synchronized(LOCK) { save(userId, transform(read(userId))) }
    }

    private fun save(userId: String, snapshot: AccessSnapshot) {
        prefs.edit().putString(key(userId), gson.toJson(snapshot)).apply()
    }

    private fun key(userId: String): String = "access_snapshot_${userId.ifBlank { "unknown" }}"

    private companion object {
        const val PREFS_NAME = "voice_alarm_access_snapshots"

        /** 프로세스 전체에서 하나 — 위 [mutate] 주석 참조. */
        val LOCK = Any()
    }
}
