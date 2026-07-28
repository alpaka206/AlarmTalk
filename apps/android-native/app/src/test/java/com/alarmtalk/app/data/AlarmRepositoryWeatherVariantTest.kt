package com.alarmtalk.app.data

import java.time.ZoneOffset
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AlarmRepositoryWeatherVariantTest {
    // 테스트 결정성을 위해 고정 존(UTC)으로 날짜 경계를 계산한다.
    private val utc = ZoneOffset.UTC
    private val day0 = 0L // 1970-01-01T00:00Z
    private val day0Noon = 12 * 60 * 60 * 1000L // 같은 날(1970-01-01) 12:00Z
    private val day1 = 25 * 60 * 60 * 1000L // 다음 날(1970-01-02) 01:00Z

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
                currentFireAtMillis = day0,
                nextFireAtMillis = day0,
                zone = utc,
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
                currentFireAtMillis = day0,
                nextFireAtMillis = day0,
                zone = utc,
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
                currentFireAtMillis = day0,
                nextFireAtMillis = day0,
                zone = utc,
            ),
        )
    }

    @Test
    fun `weather fire date change resets resolved variant`() {
        // 보이스·위치·버킷 동일, 다음 발사 날짜만 이튿날로 바뀜 → 이전 날짜 조건이 굳는 것을 막으려 무효화.
        assertTrue(
            shouldResetWeatherVariant(
                currentBucketId = "weather",
                nextBucketId = "weather",
                currentVoiceProfileId = "voice-1",
                nextVoiceProfileId = "voice-1",
                currentCountry = "KR",
                nextCountry = "KR",
                currentCity = "Seoul",
                nextCity = "Seoul",
                currentFireAtMillis = day0,
                nextFireAtMillis = day1,
                zone = utc,
            ),
        )
    }

    @Test
    fun `weather fire time change within same day preserves resolved variant`() {
        // 같은 날 안에서 발사 시각만 바뀜 → 타깃 날짜 동일 → 유지.
        assertFalse(
            shouldResetWeatherVariant(
                currentBucketId = "weather",
                nextBucketId = "weather",
                currentVoiceProfileId = "voice-1",
                nextVoiceProfileId = "voice-1",
                currentCountry = "KR",
                nextCountry = "KR",
                currentCity = "Seoul",
                nextCity = "Seoul",
                currentFireAtMillis = day0,
                nextFireAtMillis = day0Noon,
                zone = utc,
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
                currentFireAtMillis = day0,
                nextFireAtMillis = day0,
                zone = utc,
            ),
        )
    }

    @Test
    fun `freshly resolved draft index wins so an edited alarm is saved already resolved`() {
        // 저장 직전에 새 날짜·지역으로 받아 온 값은 저장된 옛 값보다 우선한다.
        // 이게 없으면 편집한 알람이 미해결로 저장돼, 워커가 돌기 전에 울리면
        // '오늘 날씨를 못 받았어요' 클립이 나간다.
        val state = nextWeatherVariantState(
            nextBucketId = "weather",
            resetWeatherVariant = false,
            currentIndex = 4,
            draftIndex = 1,
            currentResolvedAtMillis = 1234L,
            draftResolvedNow = true,
        )

        assertTrue(state.index == 1)
        assertTrue((state.resolvedAtMillis ?: 0L) > 1234L)
    }

    @Test
    fun `context change keeps the index resolved for the new context`() {
        // 날짜·지역·목소리를 바꾼 편집이야말로 reset 이 켜지는 경우다. 저장 전에 새 조건으로
        // 받아 왔다면 그 값을 써야 한다 — 버리면 워커가 돌기 전까지 미해결이라
        // 먼저 울리는 알람이 '못 받았어요' 클립을 낸다.
        val state = nextWeatherVariantState(
            nextBucketId = "weather",
            resetWeatherVariant = true,
            currentIndex = 4,
            draftIndex = 7,
            currentResolvedAtMillis = 1234L,
            draftResolvedNow = true,
        )

        assertTrue(state.index == 7)
        assertTrue((state.resolvedAtMillis ?: 0L) > 1234L)
    }
}
