package com.alarmtalk.app

import com.alarmtalk.app.alarm.storedVoiceFallbackUri
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RingingServiceFallbackTest {
    @Test
    fun representativeVoiceIsUsedWhenBucketManifestIsEmpty() {
        assertEquals("file://representative.mp3", storedVoiceFallbackUri("file://representative.mp3", "weather", 0, false))
    }

    @Test
    fun representativeVoiceIsUsedWhenBucketSelectionIsUnavailable() {
        assertEquals("file://representative.mp3", storedVoiceFallbackUri("file://representative.mp3", "weather", 1, false))
    }

    @Test
    fun selectedBucketClipTakesPriorityOverRepresentativeVoice() {
        assertNull(storedVoiceFallbackUri("file://representative.mp3", "weather", 1, true))
    }
}
