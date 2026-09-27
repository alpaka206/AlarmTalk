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
        snapshot.userPlanPromoEndsAt,
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

    // ── 기간 한정 개인 플랜: plan 과 종료 시각은 **한 쌍**이다 ────────────────────────────

    private val promoEndsAt = "2026-10-31T15:00:00Z"
    private val afterPromo = java.time.Instant.parse(promoEndsAt).toEpochMilli() + 60_000

    private fun accessAt(snapshot: AccessSnapshot, at: Long): PaidVoiceAccess = resolvePaidVoiceAccess(
        snapshot.subscriptionResponse,
        snapshot.familyGroup,
        snapshot.userPlan,
        snapshot.storeSignalStillValid(at),
        at,
        snapshot.userPlanPromoEndsAt,
    )

    @Test
    fun preflightPromoPlanCarriesItsEndAndSurvivesSerialization() {
        val fresh = AccessSnapshot().withBillingResponse(response(
            """{"subscription":null,"user_plan":"plus","store_renewal_providers":[],
                "personal_promo":{"ends_at":"$promoEndsAt","notice_from":"2026-10-24T15:00:00Z"}}""",
        ))
        assertEquals("plus", fresh.userPlan)
        assertEquals(promoEndsAt, fresh.userPlanPromoEndsAt)
        assertEquals(promoEndsAt, fresh.subscriptionResponse?.personalPromo?.endsAt)
        // 재시작·울림에서 읽는 것은 직렬화된 캐시다 — 짝이 거기서도 살아 있어야 한다.
        val restored = gson.fromJson(gson.toJson(fresh), AccessSnapshot::class.java)
        assertEquals(promoEndsAt, restored.userPlanPromoEndsAt)
        assertEquals(PaidVoiceAccess.NotEntitled, accessAt(restored, afterPromo))
    }

    @Test
    fun ordinaryResponseKeepsThePlansOwnPromoEnd() {
        // 일상 조회는 plan 을 주지 않는다 — plan 이 그대로면 그 짝도 그대로여야 한다.
        val promo = AccessSnapshot(userPlan = "plus", userPlanPromoEndsAt = promoEndsAt)
        val fresh = promo.withBillingResponse(response(
            """{"subscription":null,"store_renewal_providers":[]}""",
        ))
        assertEquals("plus", fresh.userPlan)
        assertEquals(promoEndsAt, fresh.userPlanPromoEndsAt)
    }

    @Test
    fun freshPaidPlanClearsTheOldPromoEnd() {
        // 기간 중 쿠폰을 등록해 **원시 유료**가 됐다 → 서버는 personal_promo 를 주지 않는다.
        // 옛 종료 시각이 남으면 그 시각에 진짜 유료 사용자가 잠긴다.
        // (서버가 이미 "본인 구독 없음" 이라고 답한 상태 — plan 이 판정을 가르는 자리다.)
        val promo = AccessSnapshot(
            subscriptionResponse = response("""{"subscription":null,"store_renewal_providers":[]}"""),
            userPlan = "plus",
            userPlanPromoEndsAt = promoEndsAt,
        )
        assertEquals(PaidVoiceAccess.NotEntitled, accessAt(promo, afterPromo))
        val viaPreflight = promo.withBillingResponse(response(
            """{"subscription":null,"user_plan":"plus","store_renewal_providers":[]}""",
        ))
        assertNull(viaPreflight.userPlanPromoEndsAt)
        assertEquals(PaidVoiceAccess.Entitled, accessAt(viaPreflight, afterPromo))

        val me = gson.fromJson(
            """{"id":"u1","email":"u1@example.test","plan":"plus"}""",
            com.alarmtalk.app.network.AuthUser::class.java,
        )
        val viaAuthMe = promo.withServerUser(me)
        assertEquals("plus", viaAuthMe.userPlan)
        assertNull(viaAuthMe.userPlanPromoEndsAt)
        assertEquals(PaidVoiceAccess.Entitled, accessAt(viaAuthMe, afterPromo))
    }

    @Test
    fun planAndPromoEndAreReadFromTheSameSource() {
        val sessionUser = gson.fromJson(
            """{"id":"u1","email":"u1@example.test","plan":"plus",
                "personal_promo":{"ends_at":"$promoEndsAt","notice_from":"2026-10-24T15:00:00Z"}}""",
            com.alarmtalk.app.network.AuthUser::class.java,
        )
        // 스냅샷에 plan 이 있으면 스냅샷의 짝(여기서는 원시 유료 = null)을 쓴다 —
        // 세션의 종료 시각을 스냅샷 plan 에 붙이면 안 된다.
        assertEquals(
            "family" to null,
            AccessSnapshot(userPlan = "family").userPlanWithPromo(sessionUser),
        )
        // 스냅샷에 plan 이 없으면(옛 버전 캐시) 세션의 짝을 통째로 쓴다.
        assertEquals("plus" to promoEndsAt, AccessSnapshot().userPlanWithPromo(sessionUser))
    }
}
