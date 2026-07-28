package com.alarmtalk.app

import com.alarmtalk.app.data.AlarmEntity
import com.alarmtalk.app.data.AlarmOrigins
import com.alarmtalk.app.data.AlarmPlayModes
import com.alarmtalk.app.data.AlarmStates
import com.alarmtalk.app.data.AlarmSyncStates
import com.alarmtalk.app.data.DefaultAlarmSounds
import com.alarmtalk.app.data.SnoozeRepeatLimits
import com.alarmtalk.app.data.VibrationPatterns
import com.alarmtalk.app.data.VoiceSources
import com.alarmtalk.app.data.weatherVariantNeedsRefresh
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 날씨 조건 갱신 대상 판정 회귀 가드.
 *
 * 평시 갱신이 하루 한 번(22시)이 되면서, 예전의 '마지막 갱신 12시간 이내면 신선'만으로는
 * 구멍이 생긴다: 오늘 낮에 해결된 알람은 22시 실행에서 신선하다고 건너뛰고, 다음 실행은
 * 내일 22시라 내일 아침 알람이 어제 조건으로 울린다. 그래서 임박(24h) 알람은 신선도와
 * 무관하게 다시 받는다.
 */
class WeatherVariantRefreshTest {

    private val hour = 60 * 60 * 1000L
    private val now = 1_700_000_000_000L

    private fun alarm(
        fireInMillis: Long,
        index: Int? = 3,
        resolvedAgoMillis: Long? = 2 * hour,
    ) = AlarmEntity(
        id = "a",
        label = "weather",
        hour = 7,
        minute = 0,
        fireAtMillis = now + fireInMillis,
        repeatDaysMask = 0,
        holidayOff = false,
        snoozeEnabled = true,
        snoozeMinutes = 5,
        snoozeRepeatLimit = SnoozeRepeatLimits.THREE,
        snoozeCount = 0,
        vibrationPattern = VibrationPatterns.DEFAULT,
        playMode = AlarmPlayModes.ALARM_ONLY,
        defaultAlarmSoundId = DefaultAlarmSounds.BUNDLED_DEFAULT,
        localAudioUri = null,
        audioCacheKey = null,
        rawAudioUri = null,
        voiceSource = VoiceSources.LOCAL_AUDIO,
        voiceProfileId = "vp",
        voiceListenerTitle = null,
        voiceText = null,
        voiceCategory = null,
        voiceLanguage = null,
        voiceRandomPrompt = false,
        voiceRandomContext = null,
        voiceWeatherCountry = null,
        voiceWeatherCity = null,
        voiceFortuneGender = null,
        voiceFortuneBirthDate = null,
        voiceFortuneBirthTime = null,
        dynamicVoicePreparedForFireAtMillis = null,
        voiceRepeat = true,
        voiceVolumePercent = 100,
        ttsMessageId = null,
        remoteAlarmId = null,
        lastSyncedAtMillis = null,
        syncState = AlarmSyncStates.LOCAL_ONLY,
        origin = AlarmOrigins.LOCAL_OWNED,
        bucketId = "weather",
        contextVariantIndex = index,
        contextResolvedAtMillis = resolvedAgoMillis?.let { now - it },
        alarmVolumePercent = 100,
        alarmSoundUri = null,
        alarmSoundLabel = null,
        enabled = true,
        state = AlarmStates.SCHEDULED,
        createdAtMillis = now,
        updatedAtMillis = now,
    )

    @Test
    fun 이_발사분_것이_아니면_다시_받는다() {
        // 어제 받은 값으로 오늘 울리고 내일로 넘어간 반복 알람 — 발사 24시간 밖에서 받은 값.
        assertTrue(
            weatherVariantNeedsRefresh(
                alarm(fireInMillis = 23 * hour, resolvedAgoMillis = 26 * hour),
                now,
            ),
        )
    }

    @Test
    fun 이_발사분_것이면_다시_받지_않는다() {
        // 오늘 22시에 내일 아침 것을 받아 둔 상태 — 한 번 받았으면 끝이다.
        assertFalse(
            weatherVariantNeedsRefresh(
                alarm(fireInMillis = 9 * hour, resolvedAgoMillis = 1_000L),
                now,
            ),
        )
    }

    @Test
    fun 아직_여유가_있으면_받아둔_값을_그대로_둔다() {
        assertFalse(
            weatherVariantNeedsRefresh(alarm(fireInMillis = 30 * hour, resolvedAgoMillis = 2 * hour), now),
        )
    }

    @Test
    fun 미해결이면_받는다() {
        assertTrue(
            weatherVariantNeedsRefresh(
                alarm(fireInMillis = 30 * hour, index = null, resolvedAgoMillis = null),
                now,
            ),
        )
    }

    @Test
    fun 준비창_밖_먼_알람은_대상이_아니다() {
        // 며칠 뒤 예보로 조건을 굳히면 엉뚱해진다.
        assertFalse(
            weatherVariantNeedsRefresh(
                alarm(fireInMillis = 72 * hour, index = null, resolvedAgoMillis = null),
                now,
            ),
        )
    }

    @Test
    fun 임박한_알람을_받아낸_뒤에는_재시도_대상이_아니다() {
        // 재시도 판정도 같은 술어를 쓰므로, 성공하면 시간당 재시도가 이어지지 않는다.
        val justResolved = alarm(fireInMillis = 2 * hour, resolvedAgoMillis = 1_000L)
        assertFalse(weatherVariantNeedsRefresh(justResolved, now))
    }
}
