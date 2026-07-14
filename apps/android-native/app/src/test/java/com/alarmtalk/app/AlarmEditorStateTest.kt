package com.alarmtalk.app

import com.alarmtalk.app.data.CachedAlarmAudio
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AlarmEditorStateTest {
    @Test
    fun cloneBucketsRequireEveryBackendVariant() {
        assertEquals(8, expectedCloneBucketVariantCount("weather"))
        assertEquals(5, expectedCloneBucketVariantCount("fortune"))
        assertEquals(3, expectedCloneBucketVariantCount("love"))
        assertEquals(3, expectedCloneBucketVariantCount("medication"))
        assertEquals(1, expectedCloneBucketVariantCount("greeting"))
        assertNull(expectedCloneBucketVariantCount("unknown"))
    }

    @Test
    fun defaultPresetContextUsesGreetingPrerenderBucket() {
        assertEquals("greeting", clonePrerenderBucketCategoryFor("preset"))
    }

    @Test
    fun selectVoiceProfileClearsStaleListenerTitleWhenVoiceChanges() {
        val editor = AlarmEditorState.from(alarm = null)
        editor.voiceProfileId = "old-profile"
        editor.voiceListenerTitleOverride = "old-listener"
        editor.ttsMessageId = "old-message"

        editor.selectVoiceProfile("new-profile")

        assertEquals("new-profile", editor.voiceProfileId)
        assertEquals("", editor.voiceListenerTitleOverride)
        assertNull(editor.ttsMessageId)
    }

    @Test
    fun stockClipAudioIsTrackedWithoutListenerTitle() {
        val editor = AlarmEditorState.from(alarm = null)
        editor.voiceListenerTitleOverride = "old-listener"

        editor.setStockClipAudio(
            audio = CachedAlarmAudio(
                localAudioUri = "file://stock.mp3",
                rawAudioUri = "r2://stock.mp3",
                displayName = "stock clip",
                durationMillis = null,
                cacheKey = "stock_message-1",
                messageId = "message-1",
            ),
            profileId = "system-profile",
            messageId = "message-1",
            text = "wake up",
        )

        assertEquals("", editor.voiceListenerTitleOverride)
        assertTrue(editor.hasSelectedStockClipAudio("system-profile", "wake up"))
        assertTrue(editor.hasFreshTtsAudio("system-profile", "wake up"))
    }

    @Test
    fun freshTtsAudioFallsBackToStoredListenerTitle() {
        val editor = AlarmEditorState.from(alarm = null)
        editor.voiceRandomPrompt = false
        editor.voiceCategory = "custom"
        editor.voiceLanguage = "ko"
        editor.voiceListenerTitleOverride = "kiddo"

        editor.setGeneratedTtsAudio(
            audio = CachedAlarmAudio(
                localAudioUri = "file://tts.mp3",
                rawAudioUri = "r2://tts.mp3",
                displayName = "tts",
                durationMillis = null,
                cacheKey = "tts-cache",
                messageId = "message-2",
            ),
            profileId = "profile-1",
            text = "wake up",
            messageId = "message-2",
            rawAudioUri = "r2://tts.mp3",
            listenerTitle = "kiddo",
        )

        assertTrue(editor.hasFreshTtsAudio("profile-1", "wake up"))
    }

    @Test
    fun activeVoiceLanguageFollowsSupportedAppLanguageWithoutTranslationToggle() {
        val editor = AlarmEditorState.from(alarm = null)
        editor.voiceRandomPrompt = false
        editor.voiceTranslationEnabled = false

        editor.voiceLanguage = "ja"

        assertEquals("ja", editor.activeVoiceLanguage())
        assertTrue(editor.shouldTranslateVoiceText())

        editor.voiceLanguage = "fr"

        assertEquals("ko", editor.activeVoiceLanguage())
    }
}
