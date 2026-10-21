package com.alarmtalk.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * **신선한 내 목소리 목록이 오면 하는 두 가지**의 배선 — 접근권을 잃은 목소리의 알람 강등(`reconcileInaccessibleVoiceAlarms`)과
 * 받았던 알람의 승격(`promoteFormerReceivedAlarms`, 커플·가족 이용권 폐지의 2단계).
 *
 * 접근권 대조는 예전에 공유 목록까지 신선해야 돌았다. 그 목록 조회를 걷어내면서 가드만 남기면 대조가 **조용히 멈춘다** —
 * 지웠거나 잃은 목소리의 알람이 그 목소리로 계속 운다. 승격은 미나 확정을 되돌릴 수 없어, 이용권은 **이번 실행에서 서버로
 * 받은 답**(구독 + `/auth/me` 의 plan)으로만 판정하고, 그 답·매니페스트가 늦게 오면 그 자리에서 다시 본다.
 *
 * 판정 자체는 `data/FormerReceivedPromotionTest` 가 본다. 뷰모델은 단위 테스트에서 세울 수 없어 배선은 소스로 본다
 * (`SourceWiring.kt` 머리말).
 */
class OwnVoiceListWiringTest {

    private val voiceActions: String by lazy { withoutLineComments(readSource("ui/main/MainViewModelVoiceActions.kt")) }

    @Test
    fun `접근권 대조는 신선한 내 목록 하나로 돈다`() {
        val reconcile = functionBody(voiceActions, "internal fun MainViewModel.reconcileInaccessibleVoiceAlarms(")
        assertTrue(reconcile.contains("if (!voiceProfilesLoadedFresh) return"))
        assertEquals(
            "접근권 대조가 다른 목록의 신선도까지 기다린다 — 그 목록이 오지 않으면 대조가 영영 돌지 않는다.",
            listOf("voiceProfilesLoadedFresh"),
            Regex("""\b\w+LoadedFresh\b""").findAll(reconcile).map { it.value }.distinct().toList(),
        )
    }

    @Test
    fun `내 목록을 받은 자리에서 대조와 승격을 부른다`() {
        val fetch = functionBody(voiceActions, "internal fun MainViewModel.fetchVoiceProfiles(")
        val fresh = fetch.indexOf("voiceProfilesLoadedFresh = true")
        assertTrue("목록을 받고도 신선 표시를 세우지 않는다.", fresh >= 0)
        assertTrue("목록을 받은 뒤 접근권 대조를 부르지 않는다.", fetch.indexOf("reconcileInaccessibleVoiceAlarms(requestOwner)") > fresh)
        assertTrue("목록을 받은 뒤 받았던 알람의 승격을 부르지 않는다.", fetch.indexOf("promoteFormerReceivedAlarms(requestOwner)") > fresh)
    }

    @Test
    fun `승격의 이용권 판정은 이번 실행에서 서버로 받은 답으로만 한다`() {
        val promote = functionBody(voiceActions, "internal fun MainViewModel.promoteFormerReceivedAlarms(")
        assertTrue(
            "승격이 신선한 목록·그 목록의 계정을 확인하지 않는다.",
            promote.contains("if (!voiceProfilesLoadedFresh || authSession?.user?.id != owner) return"),
        )
        assertTrue(promote.contains("val serverAnswered = subscriptionAnsweredThisRun && planAnsweredEntry > 0L"))
        assertTrue("서버 답 전에 이용권을 판정한다 — 저장해 둔 판정으로 미나를 확정하면 되돌릴 수 없다.", promote.contains("!serverAnswered -> null"))
        assertTrue("행 쓰기가 저장소의 락을 지나지 않는다.", promote.contains("repository.settleFormerReceivedAlarm(alarmId, owner)"))
    }

    @Test
    fun `이용권 답과 매니페스트가 늦게 와도 승격을 다시 본다`() {
        val billing = withoutLineComments(readSource("ui/main/MainViewModelBillingActions.kt"))
        val apply = functionBody(billing, "private fun MainViewModel.applySubscriptionResponse(")
        val answered = apply.indexOf("subscriptionAnsweredThisRun = true")
        assertTrue("구독 답을 반영하고도 '이번 실행의 답' 표시를 세우지 않는다.", answered >= 0)
        assertTrue("구독 답을 반영한 뒤 승격을 다시 보지 않는다.", apply.indexOf("promoteFormerReceivedAlarms(ticket.userId)") > answered)

        val auth = withoutLineComments(readSource("ui/main/MainViewModelAuthActions.kt"))
        val refresh = functionBody(auth, "internal suspend fun MainViewModel.refreshAppSessionNow(")
        val applied = refresh.indexOf("personalPromoLedger.recordPlanApplied(accountRequest)")
        assertTrue("`/auth/me` 의 plan 반영 표시를 못 찾았다.", applied >= 0)
        assertTrue("`/auth/me` 의 plan 을 반영한 뒤 승격을 다시 보지 않는다.", refresh.indexOf("promoteFormerReceivedAlarms(id)") > applied)

        val manifest = functionBody(voiceActions, "private fun MainViewModel.afterStockClipManifestApplied(")
        assertTrue("매니페스트를 실은 뒤 승격을 다시 보지 않는다 — 클립을 셀 수 있는 첫 자리다.", manifest.contains("promoteFormerReceivedAlarms("))
    }
}
