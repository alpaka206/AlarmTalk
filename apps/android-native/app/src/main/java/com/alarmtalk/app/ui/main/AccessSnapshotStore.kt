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
)

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

    fun updateStorePlanKey(userId: String, planKey: String?) {
        val current = read(userId)
        save(userId, current.copy(storePlanKey = planKey))
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
