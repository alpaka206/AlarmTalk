package com.alarmtalk.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 동의 화면에 뜨는 법무 문서 전문 렌더러. 여기서 깨지면 사용자가 **동의하는 그 화면**의
 * 본문이 망가지므로, 문서들이 실제로 쓰는 문법을 고정해 둔다.
 */
class LegalMarkdownRenderTest {

    @Test
    fun `표 구분선은 본문에 남지 않는다`() {
        // 처리방침의 위탁·국외이전 표 형태. 구분선이 데이터 행으로 새면 '항목: ---' 같은
        // 가짜 항목이 법무 문서 본문에 찍힌다.
        val rendered = renderLegalMarkdown(
            """
            | 수탁사 | 목적 |
            | --- | --- |
            | ElevenLabs | 음성 합성 |
            """.trimIndent(),
        ).text

        assertFalse("구분선이 데이터 행으로 렌더됐다: $rendered", rendered.contains("---"))
        assertTrue(rendered.contains("수탁사: ElevenLabs"))
        assertTrue(rendered.contains("목적: 음성 합성"))
    }

    @Test
    fun `공백 없는 구분선도 인식한다`() {
        val rendered = renderLegalMarkdown("|A|B|\n|---|---|\n|1|2|").text
        assertFalse(rendered.contains("---"))
        assertEquals("A: 1\nB: 2", rendered)
    }

    @Test
    fun `정렬 지정 구분선도 인식한다`() {
        val rendered = renderLegalMarkdown("| A | B |\n|:---|---:|\n| 1 | 2 |").text
        assertFalse(rendered.contains("---"))
        assertEquals("A: 1\nB: 2", rendered)
    }

    @Test
    fun `굵게와 불릿은 텍스트로 살아남는다`() {
        val rendered = renderLegalMarkdown("## 제1조\n- **필수** 항목입니다").text
        assertEquals("제1조\n\n• 필수 항목입니다", rendered)
    }
}
