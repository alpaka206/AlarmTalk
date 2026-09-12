package com.alarmtalk.app

import com.alarmtalk.app.network.BillingSubscriptionResponse
import com.google.gson.Gson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class BillingPreflightSnapshotTest {
    private val gson = Gson()

    private fun response(json: String): BillingSubscriptionResponse =
        gson.fromJson(json, BillingSubscriptionResponse::class.java)

    @Test
    fun expiredPreflightReplacesPaidPlanAndSurvivesSnapshotSerialization() {
        val old = AccessSnapshot(userPlan = "family")
        val fresh = old.withBillingResponse(response(
            """{"subscription":null,"user_plan":"free","store_renewal_providers":[]}""",
        ))
        val restored = gson.fromJson(gson.toJson(fresh), AccessSnapshot::class.java)
        assertEquals("free", restored.userPlan)
        assertNull(restored.subscriptionResponse?.subscription)
        assertEquals(emptyList<String>(), restored.subscriptionResponse?.storeRenewalProviders)
    }

    @Test
    fun ordinaryResponseDoesNotInventAFreePlan() {
        val fresh = AccessSnapshot(userPlan = "family").withBillingResponse(response(
            """{"subscription":null,"store_renewal_providers":[]}""",
        ))
        assertEquals("family", fresh.userPlan)
        assertNull(fresh.subscriptionResponse?.userPlan)
    }

    @Test
    fun billingRefreshPreservesIndependentStoreEvidence() {
        val old = AccessSnapshot(storePlanKey = "personal", storeEntitlementUntilMillis = 123L)
        val fresh = old.withBillingResponse(response(
            """{"subscription":null,"user_plan":"free","store_renewal_providers":[]}""",
        ))
        assertEquals("free", fresh.userPlan)
        assertEquals("personal", fresh.storePlanKey)
        assertEquals(123L, fresh.storeEntitlementUntilMillis)
    }
}
