package com.alarmtalk.app

import com.alarmtalk.app.network.BillingSubscriptionResponse
import com.google.gson.Gson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class BillingPreflightSnapshotTest {
    private val gson = Gson()
    private val now = java.time.Instant.parse("2026-09-13T00:00:00Z").toEpochMilli()

    private fun cachedPaidSnapshot() = AccessSnapshot(
        userPlan = "family",
        storePlanKey = "personal",
        storeEntitlementUntilMillis = now + STORE_ENTITLEMENT_TTL_MILLIS,
    )

    private fun access(snapshot: AccessSnapshot): PaidVoiceAccess = resolvePaidVoiceAccess(
        snapshot.subscriptionResponse,
        snapshot.familyGroup,
        snapshot.userPlan,
        snapshot.storeSignalStillValid(now),
        now,
    )

    private fun response(json: String): BillingSubscriptionResponse =
        gson.fromJson(json, BillingSubscriptionResponse::class.java)

    @Test
    fun expiredPreflightReplacesPaidPlanAndSurvivesSnapshotSerialization() {
        val old = cachedPaidSnapshot()
        assertEquals(PaidVoiceAccess.Entitled, access(old))
        val fresh = old.withBillingResponse(response(
            """{"subscription":null,"user_plan":"free","store_renewal_providers":[]}""",
        ))
        assertNull(fresh.storePlanKey)
        assertNull(fresh.storeEntitlementUntilMillis)
        assertEquals(PaidVoiceAccess.NotEntitled, access(fresh))
        val restored = gson.fromJson(gson.toJson(fresh), AccessSnapshot::class.java)
        assertEquals("free", restored.userPlan)
        assertNull(restored.subscriptionResponse?.subscription)
        assertEquals(emptyList<String>(), restored.subscriptionResponse?.storeRenewalProviders)
        assertNull(restored.storePlanKey)
        assertNull(restored.storeEntitlementUntilMillis)
        // 푸시·다음 BillingClient 조회 없이도 재시작/울림에서 옛 TTL로 되돌아가지 않는다.
        assertEquals(PaidVoiceAccess.NotEntitled, access(restored))
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
    fun ordinaryBillingRefreshPreservesIndependentStoreEvidence() {
        val old = cachedPaidSnapshot().copy(userPlan = "free")
        val fresh = old.withBillingResponse(response(
            """{"subscription":null,"store_renewal_providers":[]}""",
        ))
        assertEquals("free", fresh.userPlan)
        assertEquals("personal", fresh.storePlanKey)
        assertEquals(old.storeEntitlementUntilMillis, fresh.storeEntitlementUntilMillis)
        assertEquals(PaidVoiceAccess.Entitled, access(fresh))
    }

    @Test
    fun paidPreflightPreservesIndependentStoreEvidence() {
        val old = cachedPaidSnapshot()
        val fresh = old.withBillingResponse(response(
            """{"subscription":null,"user_plan":"personal","store_renewal_providers":["google"]}""",
        ))
        assertEquals("personal", fresh.userPlan)
        assertEquals(old.storePlanKey, fresh.storePlanKey)
        assertEquals(old.storeEntitlementUntilMillis, fresh.storeEntitlementUntilMillis)
        assertEquals(PaidVoiceAccess.Entitled, access(fresh))
    }

    @Test
    fun missingResponseDoesNotRevokeStoreEvidence() {
        val old = cachedPaidSnapshot()
        val fresh = old.withBillingResponse(null)
        assertEquals(old.userPlan, fresh.userPlan)
        assertEquals(old.storePlanKey, fresh.storePlanKey)
        assertEquals(old.storeEntitlementUntilMillis, fresh.storeEntitlementUntilMillis)
        assertEquals(PaidVoiceAccess.Entitled, access(fresh))
    }

    @Test
    fun freePreflightInvalidatesStoreEvidenceEvenWhenSuspendedRowRemains() {
        val fresh = cachedPaidSnapshot().withBillingResponse(response(
            """{
                "subscription": {
                    "id":"retained", "plan_id":"family", "status":"active",
                    "starts_at":"2026-09-01T00:00:00Z", "expires_at":"2026-10-01T00:00:00Z"
                },
                "plan": {"id":"family", "key":"family", "plan_type":"family"},
                "user_plan":"free", "store_renewal_providers":["google"]
            }""",
        ))
        assertEquals("retained", fresh.subscriptionResponse?.subscription?.id)
        assertEquals(true, hasPaidVoiceAccess(fresh.subscriptionResponse))
        assertNull(fresh.storePlanKey)
        assertNull(fresh.storeEntitlementUntilMillis)
        assertEquals(PaidVoiceAccess.NotEntitled, access(fresh))
    }

    @Test
    fun lateOrdinaryResponseCannotRestoreInvalidatedStoreEvidence() {
        val free = cachedPaidSnapshot().withBillingResponse(response(
            """{"subscription":null,"user_plan":"free","store_renewal_providers":[]}""",
        ))
        val late = free.withBillingResponse(response(
            """{"subscription":null,"store_renewal_providers":[]}""",
        ))
        assertEquals("free", late.userPlan)
        assertNull(late.storePlanKey)
        assertNull(late.storeEntitlementUntilMillis)
        assertEquals(PaidVoiceAccess.NotEntitled, access(late))
    }

    @Test
    fun newlyConfirmedStorePurchaseCanRestoreAccessAfterFreePreflight() {
        val free = cachedPaidSnapshot().withBillingResponse(response(
            """{"subscription":null,"user_plan":"free","store_renewal_providers":[]}""",
        ))
        val purchased = free.copy(
            storePlanKey = "personal",
            storeEntitlementUntilMillis = now + STORE_ENTITLEMENT_TTL_MILLIS,
        )
        assertEquals(PaidVoiceAccess.Entitled, access(purchased))
    }
}
