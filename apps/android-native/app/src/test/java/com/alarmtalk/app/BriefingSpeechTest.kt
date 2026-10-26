package com.alarmtalk.app

import com.alarmtalk.app.network.BriefingDisclosure
import com.alarmtalk.app.network.BriefingDisclosureFlags
import com.alarmtalk.app.network.BriefingPolicyNews
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 낭독 문단은 서버 `composeBriefingSpeech`(`packages/backend/test/briefing-sources.test.ts`)와 **같은 문장**이다
 * (`docs/spec/morning-briefing.md` §6·§8). iOS 짝은 `BriefingSpeechTests`.
 */
class BriefingSpeechTest {
    private val disclosure = BriefingDisclosure(
        id = "20261026000123",
        corpCode = "00126380",
        corpName = "삼성전자",
        reportName = "[기재정정]사업보고서 (2025.12)",
        receiptDate = "2026-10-26",
        flags = BriefingDisclosureFlags(amendedReport = true),
        url = "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20261026000123",
        // 한국 시각 10/26 07:05 — UTC 로는 10/25.
        fetchedAt = "2026-10-25T22:05:00.000Z",
    )
    private val news = BriefingPolicyNews(
        id = "148000001",
        title = "청년 주거 지원 & 전세 대출 기준 완화",
        publishedDate = "2026-10-26",
        url = "https://www.korea.kr/news/policyNewsView.do?newsId=148000001",
        fetchedAt = "2026-10-25T22:05:00.000Z",
    )

    @Test
    fun disclosureSentenceMatchesTheServer() {
        assertEquals(
            "10월 26일 확인한 삼성전자의 공시입니다. 보고서명은 기재정정 사업보고서 (2025.12)입니다. 자세한 내용은 원문에서 확인해주세요.",
            BriefingSpeech.disclosure(disclosure, "2026-10-26"),
        )
    }

    @Test
    fun checkedDateIsTheItemsFetchedAtInKoreanTime() {
        // fetched_at(UTC 10/25 22:05) 은 한국 날짜로 10/26 이다.
        assertEquals("2026-10-26", BriefingSpeech.kstDate(disclosure.fetchedAt))
        assertTrue(BriefingSpeech.disclosure(disclosure).startsWith("10월 26일 확인한 "))
        assertEquals("2026-10-26", BriefingSpeech.todayKst(Instant.parse("2026-10-25T15:30:00Z")))
        assertEquals(null, BriefingSpeech.kstDate("not-a-date"))
    }

    @Test
    fun withdrawnDisclosureSaysSo() {
        val withdrawn = disclosure.copy(flags = BriefingDisclosureFlags(withdrawn = true))
        assertTrue(BriefingSpeech.disclosure(withdrawn, "2026-10-26").contains("이 공시는 철회되었습니다."))
    }

    @Test
    fun policyNewsSentenceMatchesTheServer() {
        assertEquals(
            "10월 26일 확인한 정책브리핑 정책뉴스입니다. 제목은 청년 주거 지원 & 전세 대출 기준 완화입니다. 자세한 내용은 원문에서 확인해주세요.",
            BriefingSpeech.policyNews(news, "2026-10-26"),
        )
    }

    @Test
    fun alwaysWithinTwoHundredCharactersKeepsTheClosingAndNeverSplitsSurrogatePairs() {
        val long = disclosure.copy(corpName = "가".repeat(80), reportName = "나".repeat(300))
        val longNews = news.copy(title = "다".repeat(250) + "😀")
        val emojiEdge = news.copy(title = "라".repeat(140) + "😀".repeat(20))
        for (text in listOf(
            BriefingSpeech.disclosure(long, "2026-10-26"),
            BriefingSpeech.policyNews(longNews, "2026-10-26"),
            BriefingSpeech.policyNews(emojiEdge, "2026-10-26"),
        )) {
            assertTrue(text.length <= BriefingSpeech.MAX_LENGTH)
            assertTrue(text.endsWith("자세한 내용은 원문에서 확인해주세요."))
            assertFalse(Regex("최신|새로운|전망|예상|추천|매수|매도|주가").containsMatchIn(text))
            text.forEachIndexed { index, ch ->
                if (Character.isHighSurrogate(ch)) assertTrue(index + 1 < text.length && Character.isLowSurrogate(text[index + 1]))
                if (Character.isLowSurrogate(ch)) assertTrue(index > 0 && Character.isHighSurrogate(text[index - 1]))
            }
        }
    }

    @Test
    fun cleanTextDropsControlAndInvisibleCharacters() {
        assertEquals("삼성 전자", BriefingSpeech.cleanText(" 삼성\n​전자\u0007 "))
        assertEquals("기재정정 사업보고서", BriefingSpeech.speakable("[기재정정]사업보고서"))
    }
}
