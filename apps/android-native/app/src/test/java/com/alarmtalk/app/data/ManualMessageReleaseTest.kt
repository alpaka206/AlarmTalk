package com.alarmtalk.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * 알람을 **고쳐서** 직접 입력 문구를 놓았을 때 '비사용중' 을 적는 판정.
 *
 * 안 적으면 그 문구가 서버 보관함에서 영원히 '사용중' 으로 남는다(해제를 적는 곳이
 * 삭제 경로 하나뿐이었다). 반대로 너무 많이 적으면 더 나쁘다 — 붙어 있는 문구가
 * 비사용중으로 뒤집힌다. 그 경계를 여기서 고정한다.
 */
class ManualMessageReleaseTest {

    @Test
    fun `문구를 바꾸면 앞 문구를 놓아 준다`() {
        val released = manualMessageReleasedByEdit(alarm(messageId = "m-old"), alarm(messageId = "m-new"))
        assertEquals("m-old", released)
    }

    @Test
    fun `알람 전용이나 랜덤 문구로 바꿔 문구가 사라져도 놓아 준다`() {
        val released = manualMessageReleasedByEdit(alarm(messageId = "m-old"), alarm(messageId = null))
        assertEquals("m-old", released)
    }

    @Test
    fun `같은 문구면 오디오를 다시 만들어도 놓지 않는다`() {
        // ⚠ 여기서 해제를 적으면 해제와 붙임이 **같은 밀리초**에 찍힐 수 있고, 업로드
        // 정렬은 시각 하나뿐이라 순서가 뒤집힌다. 서버는 `in_use_updated_at <= ?` 로
        // 늦게 온 해제를 받아들여, **붙어 있는 문구를 비사용중으로** 만든다.
        val released = manualMessageReleasedByEdit(
            alarm(messageId = "m-same", cacheKey = "key-old"),
            alarm(messageId = "m-same", cacheKey = "key-new"),
        )
        assertNull(released)
    }

    @Test
    fun `직접 입력 문구가 없던 알람은 놓을 것도 없다`() {
        assertNull(manualMessageReleasedByEdit(alarm(messageId = null), alarm(messageId = "m-new")))
        assertNull(manualMessageReleasedByEdit(alarm(messageId = ""), alarm(messageId = "m-new")))
    }

    private fun alarm(
        messageId: String?,
        cacheKey: String? = "cache-key",
        bucketId: String? = null,
        randomPrompt: Boolean = false,
    ) = AlarmEntity(
        id = "alarm-1",
        label = "voice alarm",
        hour = 7,
        minute = 30,
        fireAtMillis = 1_000L,
        repeatDaysMask = 0x7f,
        holidayOff = false,
        snoozeEnabled = true,
        snoozeMinutes = 5,
        snoozeRepeatLimit = SnoozeRepeatLimits.THREE,
        snoozeCount = 0,
        vibrationPattern = VibrationPatterns.DEFAULT,
        playMode = AlarmPlayModes.VOICE_ONLY,
        defaultAlarmSoundId = DefaultAlarmSounds.BUNDLED_DEFAULT,
        localAudioUri = null,
        audioCacheKey = cacheKey,
        rawAudioUri = null,
        voiceSource = VoiceSources.TTS_PROFILE,
        voiceProfileId = "voice-1",
        voiceListenerTitle = null,
        voiceText = "좋은 아침",
        voiceCategory = "custom",
        voiceLanguage = null,
        voiceRandomPrompt = randomPrompt,
        voiceRandomContext = null,
        voiceWeatherCountry = null,
        voiceWeatherCity = null,
        voiceFortuneGender = null,
        voiceFortuneBirthDate = null,
        voiceFortuneBirthTime = null,
        dynamicVoicePreparedForFireAtMillis = null,
        voiceRepeat = true,
        voiceVolumePercent = 100,
        ttsMessageId = messageId,
        remoteAlarmId = null,
        lastSyncedAtMillis = null,
        syncState = AlarmSyncStates.SYNCED,
        origin = AlarmOrigins.LOCAL_OWNED,
        alarmVolumePercent = 100,
        alarmSoundUri = null,
        alarmSoundLabel = null,
        enabled = true,
        state = AlarmStates.SCHEDULED,
        createdAtMillis = 1_000L,
        updatedAtMillis = 1_000L,
        ownerUserId = "user-a",
        bucketId = bucketId,
    )

    @Test
    fun `테마 알람은 놓아 줄 직접 입력 문구가 없다`() {
        // ⚠ 테마 알람도 `ttsMessageId`·`audioCacheKey` 를 **둘 다** 들고 있다 — 그 둘만
        // 보면 갈리지 않아서, 테마를 바꾸기만 해도 '문구를 놓았다' 고 적고 있었다.
        val released = manualMessageReleasedByEdit(
            alarm(messageId = "stock-a", bucketId = "weather"),
            alarm(messageId = "stock-b", bucketId = "medication"),
        )
        assertNull(released)
    }

    @Test
    fun `생성형 알람도 놓지 않는다`() {
        val released = manualMessageReleasedByEdit(
            alarm(messageId = "m-old", randomPrompt = true),
            alarm(messageId = null, randomPrompt = true),
        )
        assertNull(released)
    }

    @Test
    fun `직접 입력에서 테마로 바꾸면 앞 문구를 놓아 준다`() {
        // ⚠ 판정을 **바뀐 뒤**(updated)로 하면 이 갈래가 죽는다 — 앞 문구가 영영
        // '사용중' 으로 남는다. 놓는 쪽(current)으로 판정해야 한다.
        val released = manualMessageReleasedByEdit(
            alarm(messageId = "m-old"),
            alarm(messageId = "stock-a", bucketId = "weather"),
        )
        assertEquals("m-old", released)
    }

    @Test
    fun `직접 입력 판정은 붙임과 놓음이 같은 선이다`() {
        assertEquals(true, alarm(messageId = "m-1").isManualMessageAlarm())
        assertEquals(false, alarm(messageId = "stock-a", bucketId = "weather").isManualMessageAlarm())
        assertEquals(false, alarm(messageId = "m-1", randomPrompt = true).isManualMessageAlarm())
        assertEquals(false, alarm(messageId = null).isManualMessageAlarm())
        // ⚠ **버킷 없이 프리셋 클립 하나만 문 옛 행.** 세 값이 직접 입력과 똑같아 보이고,
        // 갈리는 것은 캐시 키의 `stock_` 접두 하나뿐이다 — 그 항이 빠져 있었다(리뷰 35차).
        assertEquals(
            false,
            alarm(messageId = "m-legacy", cacheKey = "stock_m-legacy").isManualMessageAlarm(),
        )
    }

    @Test
    fun `프리셋 클립을 문 옛 행은 편집해도 놓아 줄 문구가 없다`() {
        val released = manualMessageReleasedByEdit(
            alarm(messageId = "m-legacy", cacheKey = "stock_m-legacy"),
            alarm(messageId = "m-new"),
        )
        assertNull(released)
    }
}
