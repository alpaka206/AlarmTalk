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
        userPlan = "plus",
        storePlanKey = "personal",
        storeEntitlementUntilMillis = now + STORE_ENTITLEMENT_TTL_MILLIS,
    )

    private fun access(snapshot: AccessSnapshot): PaidVoiceAccess = resolvePaidVoiceAccess(
        snapshot.subscriptionResponse,
        snapshot.userPlan,
        snapshot.storeSignalStillValid(now),
        now,
    )

    private fun AccessSnapshot.withBillingResponseNow(response: BillingSubscriptionResponse?) =
        withBillingResponse(response)

    private fun response(json: String): BillingSubscriptionResponse =
        gson.fromJson(json, BillingSubscriptionResponse::class.java)

    @Test
    fun expiredPreflightReplacesPaidPlanAndSurvivesSnapshotSerialization() {
        val old = cachedPaidSnapshot()
        assertEquals(PaidVoiceAccess.Entitled, access(old))
        val fresh = old.withBillingResponseNow(response(
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
        val fresh = AccessSnapshot(userPlan = "plus").withBillingResponseNow(response(
            """{"subscription":null,"store_renewal_providers":[]}""",
        ))
        assertEquals("plus", fresh.userPlan)
        assertNull(fresh.subscriptionResponse?.userPlan)
    }

    @Test
    fun ordinaryBillingRefreshPreservesIndependentStoreEvidence() {
        val old = cachedPaidSnapshot().copy(userPlan = "free")
        val fresh = old.withBillingResponseNow(response(
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
        val fresh = old.withBillingResponseNow(response(
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
        val fresh = old.withBillingResponseNow(null)
        assertEquals(old.userPlan, fresh.userPlan)
        assertEquals(old.storePlanKey, fresh.storePlanKey)
        assertEquals(old.storeEntitlementUntilMillis, fresh.storeEntitlementUntilMillis)
        assertEquals(PaidVoiceAccess.Entitled, access(fresh))
    }

    @Test
    fun freePreflightInvalidatesStoreEvidenceEvenWhenSuspendedRowRemains() {
        val fresh = cachedPaidSnapshot().withBillingResponseNow(response(
            """{
                "subscription": {
                    "id":"retained", "plan_id":"personal", "status":"active",
                    "starts_at":"2026-09-01T00:00:00Z", "expires_at":"2026-10-01T00:00:00Z"
                },
                "plan": {"id":"personal", "key":"personal", "plan_type":"personal"},
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
        val free = cachedPaidSnapshot().withBillingResponseNow(response(
            """{"subscription":null,"user_plan":"free","store_renewal_providers":[]}""",
        ))
        val late = free.withBillingResponseNow(response(
            """{"subscription":null,"store_renewal_providers":[]}""",
        ))
        assertEquals("free", late.userPlan)
        assertNull(late.storePlanKey)
        assertNull(late.storeEntitlementUntilMillis)
        assertEquals(PaidVoiceAccess.NotEntitled, access(late))
    }

    @Test
    fun newlyConfirmedStorePurchaseCanRestoreAccessAfterFreePreflight() {
        val free = cachedPaidSnapshot().withBillingResponseNow(response(
            """{"subscription":null,"user_plan":"free","store_renewal_providers":[]}""",
        ))
        val purchased = free.copy(
            storePlanKey = "personal",
            storeEntitlementUntilMillis = now + STORE_ENTITLEMENT_TTL_MILLIS,
        )
        assertEquals(PaidVoiceAccess.Entitled, access(purchased))
    }

    // ── plan 의 출처 · 옛 빌드가 쓴 스냅샷 ─────────────────────────────────────────────

    @Test
    fun authMeAnswerWritesItsPlan() {
        val me = gson.fromJson(
            """{"id":"u1","email":"u1@example.test","plan":"plus"}""",
            com.alarmtalk.app.network.AuthUser::class.java,
        )
        val fresh = AccessSnapshot(userPlan = "free").withServerUser(me)
        assertEquals("plus", fresh.userPlan)
        val restored = gson.fromJson(gson.toJson(fresh), AccessSnapshot::class.java)
        assertEquals("plus", restored.userPlan)
    }

    @Test
    fun planIsReadFromTheSnapshotThenTheSession() {
        val session = com.alarmtalk.app.network.AuthSession(
            token = "t",
            provider = com.alarmtalk.app.network.AuthSessionStore.PROVIDER_APP,
            user = com.alarmtalk.app.network.AuthUser(id = "u1", email = "u1@example.test", plan = "free"),
        )
        // 스냅샷에 plan 이 있으면 그것이다(방금 `/auth/me` 를 받은 경로만 적는다 — 세션보다 새롭거나 같다).
        assertEquals("plus", AccessSnapshot(userPlan = "plus").userPlanOr(session))
        // 없으면(옛 버전이 쓴 스냅샷) 세션의 plan 으로 메운다 — null 로 두면 울림 경로가 '모름' 으로 통과한다.
        assertEquals("free", AccessSnapshot().userPlanOr(session))
        assertNull(AccessSnapshot().userPlanOr(null))
    }

    /**
     * **옛 빌드가 쓴 스냅샷도 그대로 읽힌다.** 기간 한정 개인 플랜·관리자 기간 지급을 걷어내며(2026-11-23) 스냅샷의 두 칸
     * (`userPlanPromoEndsAt`·`userPlanFetchedAtMillis`)과 구독 응답의 두 칸을 지웠다. 기기에 남은 옛 JSON 에는 그 키가 그대로
     * 있다 — Gson 은 모르는 키를 건너뛰므로 나머지 칸(plan·스토어 신호·구독 행)은 잃지 않는다. 못 읽으면 스냅샷이 통째로
     * 빈 값이 되어 울림 경로가 '모름' 으로 클론 목소리를 통과시킨다.
     */
    @Test
    fun aSnapshotWrittenByAnOlderBuildStillLoads() {
        val until = now + STORE_ENTITLEMENT_TTL_MILLIS
        val legacy = """{
            "subscriptionResponse": {
                "subscription": null,
                "plan": null,
                "store_renewal_providers": ["google"],
                "user_plan": "plus",
                "retired_field": {"ends_at": "2026-10-31T15:00:00Z", "computed_at": "2026-10-31T14:59:30Z"}
            },
            "storePlanKey": "personal",
            "storeEntitlementUntilMillis": $until,
            "userPlan": "plus",
            "userPlanPromoEndsAt": "2026-10-31T15:00:00Z",
            "userPlanFetchedAtMillis": 42
        }"""
        val restored = gson.fromJson(legacy, AccessSnapshot::class.java)
        assertEquals("plus", restored.userPlan)
        assertEquals("personal", restored.storePlanKey)
        assertEquals(until, restored.storeEntitlementUntilMillis)
        assertEquals("plus", restored.subscriptionResponse?.userPlan)
        assertEquals(listOf("google"), restored.subscriptionResponse?.storeRenewalProviders)
        assertEquals(PaidVoiceAccess.Entitled, access(restored))
    }
}
