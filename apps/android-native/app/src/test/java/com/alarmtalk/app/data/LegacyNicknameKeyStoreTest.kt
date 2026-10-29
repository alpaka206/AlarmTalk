package com.alarmtalk.app.data

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * 닉네임을 지운 뒤에도 **예전 키로 저장한 폰 안 음성을 다시 찾는다**(`LegacyNicknameKeyStore`, 2026-10-29). 처음 본 닉네임을
 * 얼려 두고, 서버가 닉네임을 더 싣지 않게 돼도 그 값을 쓴다 — 키가 바뀌면 직전 문구로 저장할 때 한도가 한 번 더 깎인다.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class LegacyNicknameKeyStoreTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    @After
    fun clear() {
        context.getSharedPreferences("legacy_nickname_cache_key", Context.MODE_PRIVATE).edit().clear().commit()
    }

    @Test
    fun 처음_본_닉네임을_얼리고_세션에서_사라져도_그_값을_쓴다() {
        val store = LegacyNicknameKeyStore(context)
        assertEquals("규원", store.titleFor("u1", " 규원 "))
        assertEquals("서버가 이름을 더 싣지 않아도 얼린 값", "규원", store.titleFor("u1", null))
        assertEquals("다른 이름이 와도 바꾸지 않는다", "규원", store.titleFor("u1", "다른 이름"))
    }

    @Test
    fun 세션의_이름이_이미_비었으면_기본_목소리_알람에_남은_호칭으로_얼린다() {
        // 옛 앱(1.2.16)은 서버가 빈 이름을 준 뒤로 세션의 이름을 빈 값으로 덮었다 — 닉네임은 알람 행에만 남는다(코덱스 #976).
        val store = LegacyNicknameKeyStore(context)
        assertEquals("규원", store.titleFor("u3", "", savedAlarmTitle = "규원"))
        assertEquals("세션 이름이 있으면 그것이 먼저다", "세션", store.titleFor("u4", "세션", savedAlarmTitle = "알람"))
    }

    @Test
    fun 알람에_남은_호칭은_기본_목소리_알람_중_가장_최근에_저장한_것이다() {
        val clone = "11111111-1111-4111-8111-111111111111"
        val system = "70000000-0000-4000-9000-000000000102"
        val alarms = listOf(
            alarm("a-old", system, "옛 이름", updatedAt = 1L),
            alarm("a-new", system, " 규원 ", updatedAt = 3L),
            alarm("a-clone", clone, "엄마", updatedAt = 9L),
            alarm("a-blank", system, null, updatedAt = 10L),
        )
        assertEquals("규원", legacyNicknameFromAlarms(alarms))
        assertNull(legacyNicknameFromAlarms(alarms.filter { it.voiceProfileId == clone }))
    }

    private fun alarm(id: String, voiceProfileId: String, title: String?, updatedAt: Long) = AlarmEntity(
        id = id, label = "", hour = 7, minute = 0, fireAtMillis = 0L, repeatDaysMask = 0, holidayOff = false,
        snoozeEnabled = true, snoozeMinutes = 5, snoozeRepeatLimit = 3, snoozeCount = 0,
        vibrationPattern = VibrationPatterns.DEFAULT, playMode = AlarmPlayModes.VOICE_ONLY,
        defaultAlarmSoundId = DefaultAlarmSounds.BUNDLED_DEFAULT, localAudioUri = null, audioCacheKey = null,
        rawAudioUri = null, voiceSource = VoiceSources.TTS_PROFILE, voiceProfileId = voiceProfileId,
        voiceListenerTitle = title, voiceText = "일어나", voiceCategory = null, voiceLanguage = null,
        voiceRandomPrompt = false, voiceRandomContext = null, voiceWeatherCountry = null, voiceWeatherCity = null,
        voiceFortuneGender = null, voiceFortuneBirthDate = null, voiceFortuneBirthTime = null,
        dynamicVoicePreparedForFireAtMillis = null, voiceRepeat = true, voiceVolumePercent = 100, ttsMessageId = null,
        remoteAlarmId = null, lastSyncedAtMillis = null, syncState = "local_only", origin = "local_owned",
        alarmVolumePercent = 100, alarmSoundUri = null, alarmSoundLabel = null, enabled = true, state = "scheduled",
        createdAtMillis = 0L, updatedAtMillis = updatedAt,
    )

    @Test
    fun 닉네임이_없는_계정은_빈_값으로_얼어_키에_아무것도_넣지_않는다() {
        val store = LegacyNicknameKeyStore(context)
        assertNull(store.titleFor("u2", ""))
        assertNull("나중에 이름이 생겨도 키는 그대로다", store.titleFor("u2", "새 이름"))
    }
}
