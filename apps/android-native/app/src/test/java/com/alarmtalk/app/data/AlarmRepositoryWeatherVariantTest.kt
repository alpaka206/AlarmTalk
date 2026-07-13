package com.alarmtalk.app.data

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AlarmRepositoryWeatherVariantTest {
    @Test
    fun `unrelated edit keeps latest persisted weather variant instead of draft snapshot`() {
        val state = nextWeatherVariantState(
            nextBucketId = "weather",
            resetWeatherVariant = false,
            currentIndex = 4,
            draftIndex = 1,
            currentResolvedAtMillis = 1234L,
        )

        assertTrue(state.index == 4)
        assertTrue(state.resolvedAtMillis == 1234L)
    }

    @Test
    fun `weather context change clears variant and resolution time`() {
        val state = nextWeatherVariantState(
            nextBucketId = "weather",
            resetWeatherVariant = true,
            currentIndex = 4,
            draftIndex = 1,
            currentResolvedAtMillis = 1234L,
        )

        assertTrue(state.index == null)
        assertTrue(state.resolvedAtMillis == null)
    }

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
