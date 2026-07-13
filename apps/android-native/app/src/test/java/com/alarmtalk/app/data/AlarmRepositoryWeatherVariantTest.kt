package com.alarmtalk.app.data

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AlarmRepositoryWeatherVariantTest {
    @Test
    fun `weather location change resets resolved variant`() {
        assertTrue(
            shouldResetWeatherVariant(
                currentBucketId = "weather",
                nextBucketId = "weather",
                currentVoiceProfileId = "voice-1",
                nextVoiceProfileId = "voice-1",
                currentCountry = "KR",
                nextCountry = "KR",
                currentCity = "Seoul",
                nextCity = "Busan",
            ),
        )
    }

    @Test
    fun `weather profile or bucket change resets resolved variant`() {
        assertTrue(
            shouldResetWeatherVariant(
                currentBucketId = "weather",
                nextBucketId = "weather",
                currentVoiceProfileId = "voice-1",
                nextVoiceProfileId = "voice-2",
                currentCountry = "KR",
                nextCountry = "KR",
                currentCity = "Seoul",
                nextCity = "Seoul",
            ),
        )
        assertTrue(
            shouldResetWeatherVariant(
                currentBucketId = "weather",
                nextBucketId = "love",
                currentVoiceProfileId = "voice-1",
                nextVoiceProfileId = "voice-1",
                currentCountry = "KR",
                nextCountry = "KR",
                currentCity = "Seoul",
                nextCity = "Seoul",
            ),
        )
    }

    @Test
    fun `unrelated weather alarm edit preserves resolved variant`() {
        assertFalse(
            shouldResetWeatherVariant(
                currentBucketId = "weather",
                nextBucketId = "weather",
                currentVoiceProfileId = "voice-1",
                nextVoiceProfileId = "voice-1",
                currentCountry = " KR ",
                nextCountry = "KR",
                currentCity = " Seoul ",
                nextCity = "Seoul",
            ),
        )
    }
}
