package com.alarmtalk.app

import com.alarmtalk.app.network.BriefingCompanyStatus
import com.alarmtalk.app.network.BriefingDisclosure
import com.alarmtalk.app.network.BriefingDisclosureFlags
import com.alarmtalk.app.network.BriefingPolicyNews
import com.alarmtalk.app.network.BriefingSourceError
import com.alarmtalk.app.network.BriefingTodayResponse
import com.alarmtalk.app.network.BriefingWindow
import com.alarmtalk.app.network.VoiceProfile
import com.alarmtalk.app.network.apiErrorMessageRes
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** `docs/spec/morning-briefing.md` §8 「상태별 표시」·「문구 표」. iOS 짝은 `BriefingPresentationTests`. */
class BriefingPresentationTest {
    private val samsung = "00126380"
    private val kakao = "00258801"

    private fun disclosure(corpCode: String, id: String = "20261026000123") = BriefingDisclosure(
        id = id,
        corpCode = corpCode,
        corpName = "삼성전자",
        reportName = "주요사항보고서",
        receiptDate = "2026-10-26",
        flags = BriefingDisclosureFlags(),
        url = "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=$id",
        fetchedAt = "2026-10-25T22:05:00.000Z",
    )

    private fun news(id: String = "148000001") = BriefingPolicyNews(
        id = id,
        title = "청년 주거 지원",
        publishedDate = "2026-10-26",
        url = "https://www.korea.kr/news/policyNewsView.do?newsId=$id",
        fetchedAt = "2026-10-25T22:05:00.000Z",
    )

    @Test
    fun noDisclosuresIsSaidOnlyWhenTheCompanyWasCheckedAndTheResponseIsComplete() {
        val ok = BriefingCompanyState.OK
        assertEquals(BriefingCompanyNote.NO_DISCLOSURES, BriefingPresentation.companyNote(ok, complete = true, hasDisclosures = false))
        // ⚠ complete 가 거짓이면 "없어요" 라고 하지 않는다.
        assertEquals(BriefingCompanyNote.NOT_CONCLUSIVE, BriefingPresentation.companyNote(ok, complete = false, hasDisclosures = false))
        assertEquals(BriefingCompanyNote.NONE, BriefingPresentation.companyNote(ok, complete = false, hasDisclosures = true))
        // stale·unavailable 은 비었어도 "없어요" 가 아니다.
        listOf(true, false).forEach { complete ->
            listOf(true, false).forEach { has ->
                assertEquals(BriefingCompanyNote.STALE, BriefingPresentation.companyNote(BriefingCompanyState.STALE, complete, has))
                assertEquals(
                    BriefingCompanyNote.UNAVAILABLE,
                    BriefingPresentation.companyNote(BriefingCompanyState.UNAVAILABLE, complete, has),
                )
            }
        }
    }

    @Test
    fun unknownStatusIsReadAsUnavailableNotAsChecked() {
        assertEquals(BriefingCompanyState.OK, BriefingPresentation.companyState("ok"))
        assertEquals(BriefingCompanyState.STALE, BriefingPresentation.companyState("stale"))
        assertEquals(BriefingCompanyState.UNAVAILABLE, BriefingPresentation.companyState("unavailable"))
        assertEquals(BriefingCompanyState.UNAVAILABLE, BriefingPresentation.companyState("something_new"))
        assertEquals(BriefingCompanyState.UNAVAILABLE, BriefingPresentation.companyState(null))
    }

    @Test
    fun viewSplitsDisclosuresByCompanyAndPicksEachCompanysError() {
        val response = BriefingTodayResponse(
            window = BriefingWindow(from = "2026-10-20", to = "2026-10-26"),
            companies = listOf(
                BriefingCompanyStatus(corpCode = samsung, corpName = "삼성전자", status = "ok", fetchedAt = "2026-10-25T22:05:00.000Z"),
                BriefingCompanyStatus(corpCode = kakao, corpName = "카카오", status = "stale", fetchedAt = "2026-10-25T21:40:00.000Z"),
            ),
            disclosures = listOf(disclosure(samsung), disclosure(kakao, id = "20261025000999")),
            policyNews = listOf(news()),
            fetchedAt = "2026-10-25T21:40:00.000Z",
            stale = true,
            complete = false,
            errors = listOf(
                BriefingSourceError(source = "opendart", code = "BRIEFING_SOURCE_RATE_LIMITED", corpCode = kakao, retryAfterSeconds = 900),
            ),
        )
        val view = BriefingPresentation.view(response)

        assertEquals("2026-10-20" to "2026-10-26", view.window)
        assertFalse(view.complete)
        assertTrue(view.stale)
        assertEquals(900, view.retryAfterSeconds)
        val (first, second) = view.companies
        assertEquals(listOf("20261026000123"), first.disclosures.map { it.id })
        assertEquals(BriefingCompanyNote.NONE, first.note)
        assertNull(first.errorCode)
        assertEquals(listOf("20261025000999"), second.disclosures.map { it.id })
        assertEquals(BriefingCompanyNote.STALE, second.note)
        assertEquals("2026-10-25T21:40:00.000Z", second.fetchedAt)
        assertEquals("BRIEFING_SOURCE_RATE_LIMITED", second.errorCode)
        assertEquals(BriefingNewsNote.NONE, view.news.note)
    }

    @Test
    fun companyErrorFallsBackToTheSourceWideOpendartError() {
        val errors = listOf(
            BriefingSourceError(source = "policy_news", code = "BRIEFING_SOURCE_FAILED"),
            BriefingSourceError(source = "opendart", code = "BRIEFING_SOURCE_NOT_CONFIGURED"),
        )
        assertEquals("BRIEFING_SOURCE_NOT_CONFIGURED", BriefingPresentation.companyErrorCode(errors, samsung))
        val own = errors + BriefingSourceError(source = "opendart", code = "BRIEFING_SOURCE_MAINTENANCE", corpCode = samsung)
        assertEquals("BRIEFING_SOURCE_MAINTENANCE", BriefingPresentation.companyErrorCode(own, samsung))
    }

    @Test
    fun policyNewsSaysNoneOnlyWhenTheSourceDidNotFail() {
        assertEquals(BriefingNewsNote.NO_NEWS, BriefingPresentation.newsSection(emptyList(), emptyList()).note)
        assertEquals(BriefingNewsNote.NONE, BriefingPresentation.newsSection(listOf(news()), emptyList()).note)
        val failed = listOf(BriefingSourceError(source = "policy_news", code = "BRIEFING_SOURCE_FAILED"))
        assertEquals(BriefingNewsNote.UNAVAILABLE, BriefingPresentation.newsSection(emptyList(), failed).note)
        val stale = BriefingPresentation.newsSection(listOf(news()), failed)
        assertEquals(BriefingNewsNote.STALE, stale.note)
        assertEquals("BRIEFING_SOURCE_FAILED", stale.errorCode)
        // 공시 쪽 오류는 정책뉴스를 실패로 만들지 않는다.
        val dartOnly = listOf(BriefingSourceError(source = "opendart", code = "BRIEFING_SOURCE_FAILED"))
        assertEquals(BriefingNewsNote.NO_NEWS, BriefingPresentation.newsSection(emptyList(), dartOnly).note)
    }

    @Test
    fun retryAfterIsTheLongestWait() {
        assertNull(BriefingPresentation.retryAfterSeconds(emptyList()))
        val errors = listOf(
            BriefingSourceError(source = "opendart", code = "BRIEFING_SOURCE_RATE_LIMITED", corpCode = samsung, retryAfterSeconds = 300),
            BriefingSourceError(source = "policy_news", code = "BRIEFING_SOURCE_RATE_LIMITED", retryAfterSeconds = 900),
            BriefingSourceError(source = "opendart", code = "BRIEFING_SOURCE_FAILED", corpCode = kakao),
        )
        assertEquals(900, BriefingPresentation.retryAfterSeconds(errors))
    }

    @Test
    fun sourceErrorCodesMapToTheSpecTable() {
        assertEquals(R.string.briefing_source_not_configured, BriefingPresentation.sourceErrorMessageRes("BRIEFING_SOURCE_NOT_CONFIGURED"))
        assertEquals(R.string.briefing_source_rate_limited, BriefingPresentation.sourceErrorMessageRes("BRIEFING_SOURCE_RATE_LIMITED"))
        assertEquals(R.string.briefing_source_maintenance, BriefingPresentation.sourceErrorMessageRes("BRIEFING_SOURCE_MAINTENANCE"))
        // 키 오류는 우리 설정 문제라 일반 실패와 같은 말이다. 모르는 코드도 그렇다.
        assertEquals(R.string.briefing_source_failed, BriefingPresentation.sourceErrorMessageRes("BRIEFING_SOURCE_KEY_INVALID"))
        assertEquals(R.string.briefing_source_failed, BriefingPresentation.sourceErrorMessageRes("BRIEFING_SOURCE_FAILED"))
        assertEquals(R.string.briefing_source_failed, BriefingPresentation.sourceErrorMessageRes("SOMETHING_NEW"))
        assertEquals(R.string.briefing_source_failed, BriefingPresentation.sourceErrorMessageRes(null))
    }

    @Test
    fun httpBriefingCodesHaveSharedTableCopy() {
        assertEquals(R.string.briefing_not_configured, apiErrorMessageRes("BRIEFING_NOT_CONFIGURED"))
        assertEquals(R.string.api_error_briefing_corp_codes_not_ready, apiErrorMessageRes("BRIEFING_CORP_CODES_NOT_READY"))
        assertEquals(R.string.api_error_briefing_invalid_query, apiErrorMessageRes("BRIEFING_INVALID_QUERY"))
        assertEquals(R.string.api_error_briefing_invalid_interests, apiErrorMessageRes("BRIEFING_INVALID_INTERESTS"))
        assertEquals(R.string.api_error_briefing_corp_not_found, apiErrorMessageRes("BRIEFING_CORP_NOT_FOUND"))
    }

    @Test
    fun interestsStopAtThree() {
        assertEquals(3, BriefingInterestRules.MAX_INTERESTS)
        val two = listOf("00000001", "00000002")
        assertTrue(BriefingInterestRules.canAdd(two))
        val three = BriefingInterestRules.adding(two, "00000003")
        assertEquals(listOf("00000001", "00000002", "00000003"), three)
        assertFalse(BriefingInterestRules.canAdd(three!!))
        assertNull(BriefingInterestRules.adding(three, "00000004"))
        // 이미 있는 기업은 상한이어도 그대로(다시 넣지 않는다).
        assertEquals(three, BriefingInterestRules.adding(three, "00000002"))
        assertEquals(listOf("00000001", "00000003"), BriefingInterestRules.removing(three, "00000002"))
    }

    @Test
    fun freeAccountsOnlyGetSystemVoices() {
        val mina = "70000000-0000-4000-9000-000000000102"
        val siwoo = "70000000-0000-4000-9000-000000000101"
        val profiles = listOf(
            VoiceProfile(id = siwoo, name = "시우", status = "ready", isSystem = true),
            VoiceProfile(id = mina, name = "미나", status = "ready", isSystem = true),
            VoiceProfile(id = "clone-ready", name = "엄마", status = "ready"),
            VoiceProfile(id = "clone-draft", name = "초안", status = "ready", isDraft = true),
            VoiceProfile(id = "clone-pending", name = "만드는 중", status = "processing"),
        )
        assertEquals(listOf(siwoo, mina), BriefingVoiceRules.allowedVoices(profiles, paidVoiceEntitled = false).map { it.id })
        assertEquals(
            listOf(siwoo, mina, "clone-ready"),
            BriefingVoiceRules.allowedVoices(profiles, paidVoiceEntitled = true).map { it.id },
        )
        // 처음 고른 목소리: 쓸 수 있는 마지막 목소리 → 미나 → 첫 목소리.
        assertEquals(siwoo, BriefingVoiceRules.initialVoiceId(listOf(siwoo, mina), siwoo))
        assertEquals(mina, BriefingVoiceRules.initialVoiceId(listOf(siwoo, mina), "clone-ready"))
        assertEquals(siwoo, BriefingVoiceRules.initialVoiceId(listOf(siwoo), null))
        assertNull(BriefingVoiceRules.initialVoiceId(emptyList(), null))
    }
}
