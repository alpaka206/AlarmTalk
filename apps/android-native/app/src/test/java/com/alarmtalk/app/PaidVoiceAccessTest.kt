package com.alarmtalk.app

import com.alarmtalk.app.network.BillingPlan
import com.alarmtalk.app.network.BillingSubscription
import com.alarmtalk.app.network.BillingSubscriptionResponse
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant

/**
 * **유료 목소리 판정의 유일 출처**(`resolvePaidVoiceAccess`) 회귀 테스트.
 *
 * 이 판정이 두 방향으로 틀릴 수 있고, 두 방향의 무게가 다르다:
 *  - **덜 막음**: 무료가 된 사람에게 유료 기능이 잠깐 열린다 → 다음 동기화에서 정리된다.
 *  - **더 막음**: **돈을 내는 사람이 잠긴다** → 스펙이 더 나쁘다고 못박은 방향이다
 *    (`docs/spec/billing-lifecycle.md` 「스토어가 권위다」).
 * 그래서 우선순위와 `Unknown` 의 존재가 규칙이다.
 */
class PaidVoiceAccessTest {

    private val now = Instant.parse("2026-08-31T00:00:00Z").toEpochMilli()

    private fun sub(status: String, expiresAt: String) = BillingSubscriptionResponse(
        subscription = BillingSubscription(
            id = "s1",
            planId = "p1",
            status = status,
            startsAt = "2026-08-01T00:00:00Z",
            expiresAt = expiresAt,
        ),
        plan = BillingPlan(
            id = "p1",
            key = "personal",
            name = "개인",
            planType = "personal",
            periodDays = 30,
            maxMembers = 1,
            priceKrw = 3900,
        ),
    )

    @Test
    fun storeWinsOverExpiredServerSnapshot() {
        // 스토어가 갱신을 확인해 줬는데 서버 스냅샷은 아직 옛 만료시각이다.
        // **여기서 막으면 돈 내는 사용자가 잠긴다** — 이 테스트가 지키는 것이 그 방향이다.
        val access = resolvePaidVoiceAccess(
            subscriptionResponse = sub("active", "2026-08-30T00:00:00Z"),
            familyGroup = null,
            userPlan = "free",
            storeEntitled = true,
            nowMillis = now,
        )
        assertEquals(PaidVoiceAccess.Entitled, access)
    }

    @Test
    fun expiredServerSnapshotWithoutStoreIsNotEntitled() {
        val access = resolvePaidVoiceAccess(
            subscriptionResponse = sub("active", "2026-08-30T00:00:00Z"),
            familyGroup = null,
            userPlan = null,
            storeEntitled = false,
            nowMillis = now,
        )
        assertEquals(PaidVoiceAccess.NotEntitled, access)
    }

    @Test
    fun liveServerSnapshotIsEntitled() {
        val access = resolvePaidVoiceAccess(
            subscriptionResponse = sub("active", "2026-09-30T00:00:00Z"),
            familyGroup = null,
            userPlan = null,
            storeEntitled = false,
            nowMillis = now,
        )
        assertEquals(PaidVoiceAccess.Entitled, access)
    }

    @Test
    fun missingSnapshotIsUnknownNotFree() {
        // ⚠ 응답 전 기본값을 '무료' 로 읽는 사고가 이 저장소에서 반복됐다
        // (`docs/spec/gates-and-overlays.md`). 모름은 무료가 아니다.
        val access = resolvePaidVoiceAccess(
            subscriptionResponse = null,
            familyGroup = null,
            userPlan = null,
            storeEntitled = false,
            nowMillis = now,
        )
        assertEquals(PaidVoiceAccess.Unknown, access)
        assertEquals(true, access.isEntitledOptimistic())
        assertEquals(false, access.isDefinitelyFree())
    }

    @Test
    fun knownFreePlanBeatsMissingSnapshot() {
        // 콜드 스타트·첫 로그인: 구독 스냅샷은 아직 없는데 세션의 plan 은 이미 free 다.
        // 여기서 Unknown 을 돌려주면 낙관 규칙에 걸려 무료 사용자에게 클론 목소리와
        // 유료 전용 컨트롤이 열린다 — 눌러 봐야 서버가 거절한다.
        assertEquals(
            PaidVoiceAccess.NotEntitled,
            resolvePaidVoiceAccess(null, null, "free", false, now),
        )
        // 스토어가 유효하다고 하면 여전히 그게 위다.
        assertEquals(
            PaidVoiceAccess.Entitled,
            resolvePaidVoiceAccess(null, null, "free", true, now),
        )
        // 스냅샷도 없고 plan 도 모르면 그때가 진짜 '모름' 이다.
        assertEquals(
            PaidVoiceAccess.Unknown,
            resolvePaidVoiceAccess(null, null, null, false, now),
        )
    }

    @Test
    fun answeredNoSubscriptionAndNoGroupIsFreeNotUnknown() {
        // '모름' 은 서버에 **한 번도 못 물어본** 상태의 뜻이다(→ missingSnapshotIsUnknownNotFree).
        // 여기는 서버가 "본인 구독 없음" 이라고 **답했고** 그룹도 없다 — 근거가 다 모인 무료다.
        // 모름으로 접으면 낙관 규칙에 걸려 무료 사용자의 유료 목소리가 영영 강등되지 않는다.
        val empty = BillingSubscriptionResponse(subscription = null, plan = null)
        val access = resolvePaidVoiceAccess(empty, null, null, false, now)
        assertEquals(PaidVoiceAccess.NotEntitled, access)
        assertEquals(true, access.isDefinitelyFree())
    }

    @Test
    fun suspendedPlanBeatsRetainedSubscriptionRow() {
        // 결제 보류(ON_HOLD): 서버는 구독 행을 **남긴 채**(status=active, 만료는 아직 미래)
        // `users.plan` 만 free 로 회수한다 — `propagateGroupMemberPlans` 는 멤버의 그룹 연동
        // 구독을 취소하지 않고 재계산에서 제외만 하기 때문이다. 행부터 보면 결제가 밀린
        // 그룹 멤버가 계속 유료로 읽힌다.
        val retained = sub("active", "2026-09-30T00:00:00Z")
        assertEquals(
            PaidVoiceAccess.NotEntitled,
            resolvePaidVoiceAccess(retained, null, "free", false, now),
        )
        // 같은 행이라도 plan 이 살아 있으면 그대로 유료다(정상 구독을 막지 않는다).
        assertEquals(
            PaidVoiceAccess.Entitled,
            resolvePaidVoiceAccess(retained, null, "personal", false, now),
        )
        // 그리고 **스토어는 여전히 위다** — 보류가 풀려 결제가 통과했는데 서버 반영이 늦은
        // 경우, 서버의 free 로 막으면 돈 내는 사용자가 잠긴다.
        assertEquals(
            PaidVoiceAccess.Entitled,
            resolvePaidVoiceAccess(retained, null, "free", true, now),
        )
    }

    @Test
    fun serverSaysNoSubscriptionThenUserPlanDecides() {
        val empty = BillingSubscriptionResponse(subscription = null, plan = null)
        assertEquals(
            PaidVoiceAccess.NotEntitled,
            resolvePaidVoiceAccess(empty, null, "free", false, now),
        )
        assertEquals(
            PaidVoiceAccess.Entitled,
            resolvePaidVoiceAccess(empty, null, "family", false, now),
        )
    }

    @Test
    fun expiredStoreSignalIsIgnored() {
        // ⚠ 스토어 신호에 **기한이 없으면 영구 통행증**이 된다 — 유료였던 기기가 앱을 다시
        // 안 열면 만료 뒤에도 클론 목소리가 계속 울린다. 판정기는 기한이 지난 신호를
        // '확인 못 함'(false)으로 받아 다음 단으로 내려가야 한다.
        val storeStillValid = false // 호출부가 기한을 보고 넘기는 값
        val access = resolvePaidVoiceAccess(
            subscriptionResponse = sub("active", "2026-08-30T00:00:00Z"),
            familyGroup = null,
            userPlan = null,
            storeEntitled = storeStillValid,
            nowMillis = now,
        )
        assertEquals(PaidVoiceAccess.NotEntitled, access)
    }

    @Test
    fun optimisticAndDestructiveRulesDisagreeOnUnknown() {
        // 두 소비 규칙의 차이가 이 타입의 존재 이유다.
        assertEquals(true, PaidVoiceAccess.Unknown.isEntitledOptimistic())
        assertEquals(false, PaidVoiceAccess.Unknown.isDefinitelyFree())
        assertEquals(false, PaidVoiceAccess.NotEntitled.isEntitledOptimistic())
        assertEquals(true, PaidVoiceAccess.NotEntitled.isDefinitelyFree())
    }
}
