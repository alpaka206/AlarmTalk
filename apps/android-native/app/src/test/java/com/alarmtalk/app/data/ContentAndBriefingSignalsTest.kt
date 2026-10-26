package com.alarmtalk.app.data

import com.google.gson.JsonParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * 사용 기록 2판의 콘텐츠·소식 종류(`docs/spec/usage-events.md` §7.1) — 싣는 칸이 정해진 칸 하나뿐이고, 문구 ID·링크·
 * 제목 같은 원문이 끼어들 자리가 없는가. 배선(저장 성공 때만·링크를 넘기지 않음)은 `ContentAndBriefingSignalWiringTest`.
 */
class ContentAndBriefingSignalsTest {
    @Test
    fun `응원 고정은 fixed, 다양하게는 varied 다`() {
        assertEquals("fixed", contentSelectionProps(CHEER_BUCKET_ID, CheerModes.PINNED)!!.contentMode)
        assertEquals("varied", contentSelectionProps(CHEER_BUCKET_ID, CheerModes.VARY)!!.contentMode)
        // 모르는 저장값은 다양하게로 읽는다(`CheerModes.normalize` 와 같다).
        assertEquals("varied", contentSelectionProps(CHEER_BUCKET_ID, "something")!!.contentMode)
    }

    @Test
    fun `응원 알람이 아니거나 모드를 저장하지 않았으면 적지 않는다`() {
        assertNull(contentSelectionProps("weather", CheerModes.PINNED))
        assertNull(contentSelectionProps(null, CheerModes.VARY))
        assertNull(contentSelectionProps(CHEER_BUCKET_ID, null))
    }

    @Test
    fun `응원 기록은 content_mode 하나만 싣는다 — 고정한 문구 ID 는 싣지 않는다`() {
        val json = JsonParser.parseString(contentSelectionProps(CHEER_BUCKET_ID, CheerModes.PINNED)!!.sanitized().toJson())
            .asJsonObject
        assertEquals(setOf("content_mode"), json.keySet())
        assertEquals("fixed", json.get("content_mode").asString)
    }

    @Test
    fun `소식 기록은 원천 종류 하나만 싣고 서버 모양을 지난다`() {
        BriefingSource.entries.forEach { source ->
            val props = BriefingSignals.sourceProps(source)
            // 다듬어도 그대로다 — 서버 `CodeSchema` 모양 안이다.
            assertEquals(props, props.sanitized())
            val json = JsonParser.parseString(props.toJson()).asJsonObject
            assertEquals(setOf("surface"), json.keySet())
        }
        assertEquals("disclosure", BriefingSource.DISCLOSURE.code)
        assertEquals("policy_news", BriefingSource.POLICY_NEWS.code)
    }
}
