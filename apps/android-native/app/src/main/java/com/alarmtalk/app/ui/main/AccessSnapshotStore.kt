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
