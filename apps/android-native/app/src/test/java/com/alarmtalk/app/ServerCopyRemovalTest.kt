package com.alarmtalk.app

import com.alarmtalk.app.data.AlarmEntity
import com.alarmtalk.app.data.AlarmPlayModes
import com.alarmtalk.app.data.CHEER_BUCKET_ID
import com.alarmtalk.app.data.DefaultAlarmSounds
import com.alarmtalk.app.data.VibrationPatterns
import com.alarmtalk.app.data.VoiceSources
import com.alarmtalk.app.data.messageKindForUsage
import com.alarmtalk.app.data.needsCloneCheerSupplement
import com.alarmtalk.app.network.LegacyBucketHint
import com.alarmtalk.app.network.StockClip
import com.alarmtalk.app.network.StockClipListResponse
import com.alarmtalk.app.sync.legacyBucketHintsOf
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * **서버 알람 사본을 없앤 뒤(2026-10-29) 앱이 대신 맡는 것들.**
 *
 * 사본이 하던 일 중 앱으로 옮긴 셋 — 응원 보충 신호(`needsCloneCheerSupplement`), 버킷 없는 옛 알람의 테마 힌트
 * (`legacyBucketHintsOf`), 관리자 '알람 문구 종류' 가 읽는 저장 기록의 종류(`messageKindForUsage`) — 과, 올리기 경로가
 * 정말 없어졌는지(배선)를 본다.
 */
class ServerCopyRemovalTest {

    private val clone = "11111111-1111-4111-8111-111111111111"

    @Test
    fun `내 클론으로 응원을 새로 고르면 보충을 알린다`() {
        val saved = alarm(bucketId = CHEER_BUCKET_ID, voiceProfileId = clone)
        assertTrue(needsCloneCheerSupplement(saved, previous = null))
        assertTrue("다른 테마에서 응원으로 바꿨다", needsCloneCheerSupplement(saved, previous = saved.copy(bucketId = "weather")))
        assertTrue("다른 목소리에서 이 클론으로 바꿨다", needsCloneCheerSupplement(saved, previous = saved.copy(voiceProfileId = "other")))
    }

    @Test
    fun `켜고 끄기·시각만 고친 저장, 기본 목소리, 알람음·녹음은 알리지 않는다`() {
        val saved = alarm(bucketId = CHEER_BUCKET_ID, voiceProfileId = clone)
        assertFalse(needsCloneCheerSupplement(saved.copy(enabled = false, hour = 9), previous = saved))
        assertFalse(needsCloneCheerSupplement(saved.copy(voiceProfileId = SYSTEM_VOICE), previous = null))
        assertFalse(needsCloneCheerSupplement(saved.copy(playMode = AlarmPlayModes.ALARM_ONLY), previous = null))
        assertFalse(needsCloneCheerSupplement(saved.copy(voiceSource = VoiceSources.LOCAL_AUDIO), previous = null))
        assertFalse(needsCloneCheerSupplement(saved.copy(bucketId = "weather"), previous = null))
    }

    @Test
    fun `옛 알람 힌트는 서버의 은퇴 힌트에 지금 목록의 기본 목소리 클립을 더한다`() {
        val manifest = StockClipListResponse(
            clips = listOf(
                StockClip(messageId = "m-live", voiceProfileId = SYSTEM_VOICE, category = "weather"),
                StockClip(messageId = "m-clone", voiceProfileId = clone, category = "cheer"),
                StockClip(messageId = "m-none", voiceProfileId = SYSTEM_VOICE, category = null),
            ),
            legacyBucketHints = listOf(LegacyBucketHint(messageId = "m-retired", category = "medication")),
        )
        assertEquals(mapOf("m-live" to "weather", "m-retired" to "medication"), legacyBucketHintsOf(manifest))
    }

    @Test
    fun `저장 기록의 문구 종류는 원문이 아니라 종류만이다`() {
        assertEquals("alarm_only", alarm(playMode = AlarmPlayModes.ALARM_ONLY).messageKindForUsage())
        assertEquals("recording", alarm(voiceSource = VoiceSources.LOCAL_AUDIO).messageKindForUsage())
        assertEquals("cheer", alarm(bucketId = CHEER_BUCKET_ID).messageKindForUsage())
        assertEquals("wake_weather", alarm(randomContext = "wake_weather").messageKindForUsage())
        assertEquals("manual", alarm(voiceText = "일어나").messageKindForUsage())
    }

    @Test
    fun `알람을 서버로 올리는 길이 없다`() {
        val app = withoutLineComments(readSource("ui/app/AlarmTalkApp.kt"))
        val auth = withoutLineComments(readSource("ui/main/MainViewModelAuthActions.kt"))
        assertFalse(app.contains("syncNow("))
        assertFalse(auth.contains("syncNow("))
        assertFalse(withoutLineComments(readSource("network/AlarmTalkApi.kt")).contains("RemoteAlarmApi"))
    }

    @Test
    fun `알람 저장 성공이 응원 보충을 알린다`() {
        val actions = withoutLineComments(readSource("ui/main/MainViewModelAlarmActions.kt"))
        listOf("internal fun MainViewModel.createAlarm(", "internal fun MainViewModel.updateAlarm(").forEach { signature ->
            assertTrue("$signature 성공이 보충을 알리지 않는다", functionBody(actions, signature).contains("requestCloneCheerSupplementIfNeeded(saved,"))
        }
    }

    private fun alarm(
        playMode: String = AlarmPlayModes.VOICE_ONLY,
        voiceSource: String = VoiceSources.TTS_PROFILE,
        bucketId: String? = null,
        voiceProfileId: String? = clone,
        randomContext: String? = null,
        voiceText: String? = null,
    ) = AlarmEntity(
        id = "a-1",
        label = "",
        hour = 7,
        minute = 30,
        fireAtMillis = 0L,
        repeatDaysMask = 0,
        holidayOff = false,
        snoozeEnabled = true,
        snoozeMinutes = 5,
        snoozeRepeatLimit = 3,
        snoozeCount = 0,
        vibrationPattern = VibrationPatterns.DEFAULT,
        playMode = playMode,
        defaultAlarmSoundId = DefaultAlarmSounds.BUNDLED_DEFAULT,
        localAudioUri = null,
        audioCacheKey = null,
        rawAudioUri = null,
        voiceSource = voiceSource,
        voiceProfileId = voiceProfileId,
        voiceListenerTitle = null,
        voiceText = voiceText,
        voiceCategory = null,
        voiceLanguage = null,
        voiceRandomPrompt = randomContext != null,
        voiceRandomContext = randomContext,
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
        syncState = "local_only",
        origin = "local_owned",
        alarmVolumePercent = 100,
        alarmSoundUri = null,
        alarmSoundLabel = null,
        enabled = true,
        state = "scheduled",
        createdAtMillis = 0L,
        updatedAtMillis = 0L,
        bucketId = bucketId,
    )

    private companion object {
        const val SYSTEM_VOICE = "70000000-0000-4000-9000-000000000102"
    }
}
