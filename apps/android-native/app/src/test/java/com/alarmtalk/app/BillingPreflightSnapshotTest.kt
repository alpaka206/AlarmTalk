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
        snapshot.userPlanPromoStamp(),
    )

    /** 이 테스트의 '지금' 받은 응답으로 적는다. */
    private fun AccessSnapshot.withBillingResponseNow(response: BillingSubscriptionResponse?) =
        withBillingResponse(response, now)

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
        val fresh = AccessSnapshot(userPlan = "family").withBillingResponseNow(response(
            """{"subscription":null,"store_renewal_providers":[]}""",
        ))
        assertEquals("family", fresh.userPlan)
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

    // ── 기간 한정 개인 플랜: plan · 종료 시각 · 받은 시각은 **한 벌**이다 ──────────────────

    private val promoEndsAt = "2026-10-31T15:00:00Z"
    private val promoEnd = java.time.Instant.parse(promoEndsAt).toEpochMilli()
    private val beforePromoEnd = promoEnd - 60 * 60_000L
    private val afterPromo = promoEnd + 60_000

    private fun accessAt(snapshot: AccessSnapshot, at: Long): PaidVoiceAccess = resolvePaidVoiceAccess(
        snapshot.subscriptionResponse,
        snapshot.familyGroup,
        snapshot.userPlan,
        snapshot.storeSignalStillValid(at),
        at,
        snapshot.userPlanPromoStamp(),
    )

    private fun promoUser(): com.alarmtalk.app.network.AuthUser = gson.fromJson(
        """{"id":"u1","email":"u1@example.test","plan":"plus",
            "personal_promo":{"ends_at":"$promoEndsAt","notice_from":"2026-10-24T15:00:00Z"}}""",
        com.alarmtalk.app.network.AuthUser::class.java,
    )

    @Test
    fun preflightPromoPlanCarriesItsEndAndFetchTimeThroughSerialization() {
        val fresh = AccessSnapshot().withBillingResponse(
            response(
                """{"subscription":null,"user_plan":"plus","store_renewal_providers":[],
                    "personal_promo":{"ends_at":"$promoEndsAt","notice_from":"2026-10-24T15:00:00Z"}}""",
            ),
            beforePromoEnd,
        )
        assertEquals("plus", fresh.userPlan)
        assertEquals(promoEndsAt, fresh.userPlanPromoEndsAt)
        assertEquals(beforePromoEnd, fresh.userPlanFetchedAtMillis)
        assertEquals(promoEndsAt, fresh.subscriptionResponse?.personalPromo?.endsAt)
        // 재시작·울림에서 읽는 것은 직렬화된 캐시다 — 한 벌이 거기서도 살아 있어야 한다.
        val restored = gson.fromJson(gson.toJson(fresh), AccessSnapshot::class.java)
        assertEquals(promoEndsAt, restored.userPlanPromoEndsAt)
        assertEquals(beforePromoEnd, restored.userPlanFetchedAtMillis)
        assertEquals(promoEndsAt, restored.subscriptionResponse?.personalPromo?.endsAt)
        // 종료 전에 받은 답을 종료 뒤에 읽는다 = 낡은 캐시 → 무료.
        assertEquals(PaidVoiceAccess.NotEntitled, accessAt(restored, afterPromo))
    }

    @Test
    fun ordinaryResponseKeepsThePlansOwnPromoStamp() {
        // 일상 조회는 plan 을 주지 않는다 — plan 이 그대로면 그 짝(종료·받은 시각)도 그대로여야 한다.
        val promo = AccessSnapshot(userPlan = "plus", userPlanPromoEndsAt = promoEndsAt, userPlanFetchedAtMillis = 42L)
        val fresh = promo.withBillingResponse(
            response("""{"subscription":null,"store_renewal_providers":[]}"""),
            afterPromo,
        )
        assertEquals("plus", fresh.userPlan)
        assertEquals(promoEndsAt, fresh.userPlanPromoEndsAt)
        assertEquals(42L, fresh.userPlanFetchedAtMillis)
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
            userPlanFetchedAtMillis = beforePromoEnd,
        )
        assertEquals(PaidVoiceAccess.NotEntitled, accessAt(promo, afterPromo))
        val viaPreflight = promo.withBillingResponse(
            response("""{"subscription":null,"user_plan":"plus","store_renewal_providers":[]}"""),
            beforePromoEnd,
        )
        assertNull(viaPreflight.userPlanPromoEndsAt)
        assertEquals(PaidVoiceAccess.Entitled, accessAt(viaPreflight, afterPromo))

        val me = gson.fromJson(
            """{"id":"u1","email":"u1@example.test","plan":"plus"}""",
            com.alarmtalk.app.network.AuthUser::class.java,
        )
        val viaAuthMe = promo.withServerUser(me, beforePromoEnd)
        assertEquals("plus", viaAuthMe.userPlan)
        assertNull(viaAuthMe.userPlanPromoEndsAt)
        assertEquals(PaidVoiceAccess.Entitled, accessAt(viaAuthMe, afterPromo))
    }

    @Test
    fun anAnswerFetchedAfterTheEndIsAuthoritative() {
        // 기기 시계가 서버보다 빨라 종료 **뒤**(기기 기준)에 받았는데 서버는 아직 plus 라고 계산했다.
        // 그 답은 서버가 이미 계산한 것이다 — 기기 시계로 자르지 않는다.
        val lateFetch = AccessSnapshot(
            subscriptionResponse = response("""{"subscription":null,"store_renewal_providers":[]}"""),
        ).withServerUser(promoUser(), receivedAtMillis = afterPromo)
        assertEquals(PaidVoiceAccess.Entitled, accessAt(lateFetch, afterPromo + 60_000))
        // 같은 답을 종료 전에 받았다면 그 캐시는 종료 뒤에 무료로 읽힌다.
        val earlyFetch = lateFetch.withServerUser(promoUser(), receivedAtMillis = beforePromoEnd)
        assertEquals(PaidVoiceAccess.NotEntitled, accessAt(earlyFetch, afterPromo))
        // 받은 시각을 모르는 옛 캐시는 종료 전에 받은 것으로 본다.
        val legacy = earlyFetch.copy(userPlanFetchedAtMillis = null)
        assertEquals(PaidVoiceAccess.NotEntitled, accessAt(legacy, afterPromo))
    }

    // ── D7 — 답의 시각은 서버가 계산한 시각이다 ─────────────────────────────────────────

    private val computedJustBeforeEnd = "2026-10-31T14:59:30Z"
    private val computedJustBeforeEndMillis = java.time.Instant.parse(computedJustBeforeEnd).toEpochMilli()

    private fun promoUserComputedAt(computedAt: String): com.alarmtalk.app.network.AuthUser = gson.fromJson(
        """{"id":"u1","email":"u1@example.test","plan":"plus",
            "personal_promo":{"ends_at":"$promoEndsAt","notice_from":"2026-10-24T15:00:00Z",
            "computed_at":"$computedAt"}}""",
        com.alarmtalk.app.network.AuthUser::class.java,
    )

    @Test
    fun theServersComputedAtIsTheAnswerTimeNotTheDeviceClock() {
        // 기기 시계가 서버보다 빠르다 — 서버가 종료 30초 전에 계산한 plus 를, 기기 기준 종료 1분 뒤에 받았다.
        // 기기 시계로 찍으면 '종료 뒤에 받은 답' 이 되어 **기한 없이** 권위가 된다(울림 경로가 다음
        // `/auth/me` 까지 클론 목소리를 쓴다). 서버 시계로 찍으면 종료 전의 답 — 낡은 캐시로 잘린다.
        val snapshot = AccessSnapshot(
            subscriptionResponse = response("""{"subscription":null,"store_renewal_providers":[]}"""),
        ).withServerUser(promoUserComputedAt(computedJustBeforeEnd), receivedAtMillis = afterPromo)
        assertEquals(computedJustBeforeEndMillis, snapshot.userPlanFetchedAtMillis)
        assertEquals(PaidVoiceAccess.NotEntitled, accessAt(snapshot, afterPromo + 60_000))
        // 기간 안에 읽으면 그대로 유료다.
        assertEquals(PaidVoiceAccess.Entitled, accessAt(snapshot, promoEnd - 1))

        // 결제 전 조회(구독 응답의 user_plan)도 같은 문을 지난다.
        val viaPreflight = AccessSnapshot().withBillingResponse(
            response(
                """{"subscription":null,"user_plan":"plus","store_renewal_providers":[],
                    "personal_promo":{"ends_at":"$promoEndsAt","computed_at":"$computedJustBeforeEnd"}}""",
            ),
            receivedAtMillis = afterPromo,
        )
        assertEquals(computedJustBeforeEndMillis, viaPreflight.userPlanFetchedAtMillis)
        // 직렬화(재시작·울림이 읽는 캐시)를 지나도 그 시각이다.
        val restored = gson.fromJson(gson.toJson(viaPreflight), AccessSnapshot::class.java)
        assertEquals(computedJustBeforeEndMillis, restored.userPlanFetchedAtMillis)
    }

    @Test
    fun withoutAReadableComputedAtTheDeviceReceiptStands() {
        // 이 키를 모르는 서버(옛 서버·테스트)면 예전처럼 기기가 받은 시각이다.
        val legacy = AccessSnapshot().withServerUser(promoUser(), receivedAtMillis = beforePromoEnd)
        assertEquals(beforePromoEnd, legacy.userPlanFetchedAtMillis)
        // 못 읽는 값도 없는 것이다.
        val garbled = AccessSnapshot().withServerUser(promoUserComputedAt("soon"), receivedAtMillis = beforePromoEnd)
        assertEquals(beforePromoEnd, garbled.userPlanFetchedAtMillis)
        assertEquals(beforePromoEnd, planAnswerStampMillis(null, beforePromoEnd))
    }

    @Test
    fun aFreshAnswerStillNeverLocksOnTheDeviceClockEvenWithComputedAt() {
        // 되돌릴 수 없는 경로(`PlanChangeSyncWorker`)는 계산 시각이 있어도 '방금 받은 답' 으로 판정한다(D1).
        val user = promoUserComputedAt(computedJustBeforeEnd)
        val deviceNow = afterPromo
        assertEquals(
            PaidVoiceAccess.Entitled,
            resolvePaidVoiceAccess(
                response("""{"subscription":null,"store_renewal_providers":[]}"""),
                null,
                user.plan,
                false,
                deviceNow,
                freshPlanPromoStamp(user, deviceNow),
            ),
        )
    }

    @Test
    fun activeSubscriptionRowWinsOverALapsedPromoCache() {
        // 결제 보류(ON_HOLD) 소유자: 원시 free 라 기간 중 plus 로 계산되고, 활성 구독 행은 남아 있다.
        // 양 앱 공통 순서 — 활성 행이 끝난 프로모 캐시보다 언제나 위다.
        val onHold = AccessSnapshot(
            subscriptionResponse = response(
                """{
                    "subscription": {
                        "id":"retained", "plan_id":"family", "status":"active",
                        "starts_at":"2026-10-01T00:00:00Z", "expires_at":"2026-12-01T00:00:00Z"
                    },
                    "plan": {"id":"family", "key":"family", "plan_type":"family"},
                    "store_renewal_providers":["google"]
                }""",
            ),
        ).withServerUser(promoUser(), receivedAtMillis = beforePromoEnd)
        assertEquals(PaidVoiceAccess.Entitled, accessAt(onHold, afterPromo))
    }

    @Test
    fun planAndPromoStampAreReadFromTheSameSource() {
        val session = com.alarmtalk.app.network.AuthSession(
            token = "t",
            provider = com.alarmtalk.app.network.AuthSessionStore.PROVIDER_APP,
            user = promoUser(),
            userFetchedAtMillis = beforePromoEnd,
        )
        // 스냅샷에 plan 이 있으면 스냅샷의 짝(여기서는 원시 유료 = null)을 쓴다 —
        // 세션의 표지를 스냅샷 plan 에 붙이면 안 된다.
        assertEquals(
            "family" to null,
            AccessSnapshot(userPlan = "family").userPlanWithPromo(session),
        )
        // 스냅샷에 plan 이 없으면(옛 버전 캐시) 세션의 짝을 통째로 쓴다 — 받은 시각까지.
        assertEquals(
            "plus" to PlanPromoStamp(promoEndsAt, beforePromoEnd),
            AccessSnapshot().userPlanWithPromo(session),
        )
    }
}
