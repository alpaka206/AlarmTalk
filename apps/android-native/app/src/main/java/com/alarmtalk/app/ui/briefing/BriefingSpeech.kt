package com.alarmtalk.app

import com.alarmtalk.app.network.BriefingDisclosure
import com.alarmtalk.app.network.BriefingPolicyNews
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/**
 * 아침 소식 항목 → 목소리로 만들 **한 문단**(200자 이하 — 직접 입력 문구 상한과 같다). 서버 `lib/briefing/speech.ts` 의
 * `composeBriefingSpeech` 와 **같은 문장**을 만든다(`docs/spec/morning-briefing.md` §6·§8). iOS 짝은 `BriefingSpeech.swift`.
 *
 * ⚠ 원천이 준 사실만 말한다 — 확인한 **날짜**, 기업명·보고서명·제목, 원문을 보라는 말. "최신"·"새로운"·전망·평가·매수/매도를
 *   넣지 않는다. 시각은 말하지 않는다(공시는 접수일만 있다).
 * ⚠ 문장은 언제나 한국어다 — 낭독 입력(`language: ko`)이고 원천 글이 한국어라 화면 언어로 옮기지 않는다.
 */
internal object BriefingSpeech {
    /** 직접 입력 상한과 같다(서버 `routes/tts.ts`). UTF-16 길이로 센다. */
    const val MAX_LENGTH = 200

    private val KST: ZoneId = ZoneId.of("Asia/Seoul")
    private const val CLOSING = "자세한 내용은 원문에서 확인해주세요."

    /** ISO 시각 → 한국 날짜(`YYYY-MM-DD`). 읽지 못하면 null. */
    fun kstDate(isoInstant: String?): String? {
        if (isoInstant.isNullOrBlank()) return null
        return runCatching { Instant.parse(isoInstant).atZone(KST).toLocalDate().toString() }
            .recoverCatching { java.time.OffsetDateTime.parse(isoInstant).atZoneSameInstant(KST).toLocalDate().toString() }
            .getOrNull()
    }

    fun todayKst(now: Instant = Instant.now()): String = now.atZone(KST).toLocalDate().toString()

    /** `YYYY-MM-DD` → "10월 26일". */
    private fun monthDay(ymd: String): String {
        val date = LocalDate.parse(ymd)
        return "${date.monthValue}월 ${date.dayOfMonth}일"
    }

    /**
     * 공시. [checkedDate] 는 **확인한 날**(한국 날짜) — 그 항목의 `fetched_at` 이다(다시 확인만 해서는 문장이 바뀌지 않는다).
     */
    fun disclosure(item: BriefingDisclosure, checkedDate: String): String {
        val corp = truncate(speakable(item.corpName), 40)
        val withdrawn = if (item.flags?.withdrawn == true) " 이 공시는 철회되었습니다." else ""
        return fit(
            "${monthDay(checkedDate)} 확인한 ${corp}의 공시입니다.$withdrawn 보고서명은 ",
            speakable(item.reportName),
            "입니다. $CLOSING",
        )
    }

    fun policyNews(item: BriefingPolicyNews, checkedDate: String): String = fit(
        "${monthDay(checkedDate)} 확인한 정책브리핑 정책뉴스입니다. 제목은 ",
        speakable(item.title),
        "입니다. $CLOSING",
    )

    /** 항목의 `fetched_at` 으로 확인한 날을 정한다. 읽지 못하면 오늘(한국 날짜). */
    fun disclosure(item: BriefingDisclosure): String = disclosure(item, kstDate(item.fetchedAt) ?: todayKst())

    fun policyNews(item: BriefingPolicyNews): String = policyNews(item, kstDate(item.fetchedAt) ?: todayKst())

    /** `[기재정정]사업보고서` → `기재정정 사업보고서`. */
    internal fun speakable(text: String): String = cleanText(text.replace(BRACKETS, " \$1 "))

    /** 서버 `cleanText` 와 같다 — 줄바꿈·탭은 공백, 제어·제로폭·양방향 제어문자는 지우고, 공백을 하나로. */
    internal fun cleanText(text: String): String = text
        .replace(LINE_BREAKS, " ")
        .replace(CONTROLS, "")
        .replace(INVISIBLES, "")
        .replace(SPACES, " ")
        .trim()

    /**
     * 서버 `truncateText` 와 같다 — 넘치면 `max - 1` 자 안에서 **코드 포인트 단위로** 자르고 '…' 를 붙인다(서러게이트 쌍을
     * 가르지 않는다).
     */
    internal fun truncate(text: String, max: Int): String {
        if (text.length <= max) return text
        val out = StringBuilder()
        var index = 0
        while (index < text.length) {
            val codePoint = text.codePointAt(index)
            val size = Character.charCount(codePoint)
            if (out.length + size > max - 1) break
            out.appendCodePoint(codePoint)
            index += size
        }
        return "${out.toString().trimEnd()}…"
    }

    private fun fit(head: String, slot: String, tail: String): String {
        val room = MAX_LENGTH - head.length - tail.length
        return "$head${truncate(slot, maxOf(room, 1))}$tail"
    }

    private val BRACKETS = Regex("\\[([^\\]]*)]")
    private val LINE_BREAKS = Regex("[\\t\\n\\r\\u000c\\u000b]")
    private val CONTROLS = Regex("[\\u0000-\\u001f\\u007f-\\u009f]")
    private val INVISIBLES = Regex("[\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u2069\\ufeff]")

    // JS `\s` 와 같은 범위(유니코드 공백 포함).
    private val SPACES = Regex("[\\s\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+")
}
