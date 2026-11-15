package com.alarmtalk.app.data

import com.google.gson.JsonParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * 사용 기록 2판의 콘텐츠 종류(`docs/spec/usage-events.md` §7.1) — 싣는 칸이 정해진 칸 하나뿐이고, 문구 ID·제목
 * 같은 원문이 끼어들 자리가 없는가. 배선(저장 성공 때만)은 `ContentSignalWiringTest`.
 */
class ContentSignalsTest {
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
    fun `팩 목소리로 운 알람은 pack_id 하나만 싣는다`() {
        val packVoice = VOICE_PACK_VOICE_ID_PREFIX + "0000000000aa"
        val held = listOf(
            HeldVoicePack(packId = "first-pack", voiceId = packVoice, speakerName = "화자", language = "ko", ready = true),
        )
        val saved = rehearsalCloneAlarm(voiceProfileId = packVoice)
        val json = JsonParser.parseString(packSelectionProps(saved, held)!!.sanitized().toJson()).asJsonObject
        assertEquals("문구·클립 id 같은 원문이 끼어들 칸이 없다", setOf("pack_id"), json.keySet())
        assertEquals("first-pack", json.get("pack_id").asString)
        // 팩 목소리가 아니거나, 그 목소리로 울지 않거나, 그 계정이 받은 팩이 아니면 적지 않는다.
        assertNull(packSelectionProps(rehearsalCloneAlarm(), held))
        assertNull(packSelectionProps(rehearsalCloneAlarm(voiceProfileId = packVoice, playMode = AlarmPlayModes.ALARM_ONLY), held))
        assertNull(packSelectionProps(saved.copy(voiceSource = VoiceSources.LOCAL_AUDIO), held))
        assertNull(packSelectionProps(saved, emptyList()))
    }
}
