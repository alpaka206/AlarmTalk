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
 * 스토어 신호의 신선도 상한 — **3일**.
 *
 * 근거: 유료 사용자가 앱을 사흘 안 여는 일은 흔하지만 그보다 오래 안 열면서 갱신도 되는
 * 경우는 드물고, 그때는 다음 실행이 곧바로 다시 확인한다. 반대로 이 값이 길면 만료된
 * 구독의 통행증이 그만큼 오래 살아 남는다.
 */
internal const val STORE_ENTITLEMENT_TTL_MILLIS: Long = 3L * 24 * 60 * 60 * 1000

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

    fun updateStorePlanKey(userId: String, planKey: String?, untilMillis: Long?) {
        val current = read(userId)
        save(userId, current.copy(storePlanKey = planKey, storeEntitlementUntilMillis = untilMillis))
    }

    fun updateUserPlan(userId: String, plan: String?) {
        val current = read(userId)
        save(userId, current.copy(userPlan = plan))
    }

    fun updateSubscription(userId: String, response: BillingSubscriptionResponse?) {
        val current = read(userId)
        save(userId, current.copy(subscriptionResponse = response))
    }

    fun updateFamilyGroup(userId: String, response: FamilyGroupCurrentResponse?) {
        val current = read(userId)
        save(userId, current.copy(familyGroup = response))
    }

    fun clear(userId: String) {
        prefs.edit().remove(key(userId)).apply()
    }

    private fun save(userId: String, snapshot: AccessSnapshot) {
        prefs.edit().putString(key(userId), gson.toJson(snapshot)).apply()
    }

    private fun key(userId: String): String = "access_snapshot_${userId.ifBlank { "unknown" }}"

    private companion object {
        const val PREFS_NAME = "voice_alarm_access_snapshots"
    }
}
