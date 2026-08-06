package com.alarmtalk.app

import com.alarmtalk.app.data.AlarmEntity
import com.alarmtalk.app.data.AlarmOrigins
import com.alarmtalk.app.data.AlarmPlayModes
import com.alarmtalk.app.data.AlarmStates
import com.alarmtalk.app.data.AlarmSyncStates
import com.alarmtalk.app.data.CachedAlarmAudio
import com.alarmtalk.app.data.DefaultAlarmSounds
import com.alarmtalk.app.data.SnoozeRepeatLimits
import com.alarmtalk.app.data.VibrationPatterns
import com.alarmtalk.app.data.VoiceSources
import com.alarmtalk.app.data.encodeBucketClipKeys
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

// 버킷 클립 목록 인코딩이 org.json 을 쓴다 — 순수 JVM 에서는 스텁이 던진다.
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class AlarmEditorStateTest {
    @Test
    fun cloneBucketsRequireEveryBackendVariant() {
        assertEquals(9, expectedCloneBucketVariantCount("weather")) // 조건 8 + 미해결 안내 1
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
    fun bucketCategoryMapsBackToItsMessageContext() {
        // clonePrerenderBucketCategoryFor 와 짝. 한쪽만 고치면 옛 알람 복구가 조용히 어긋난다.
        listOf("preset", "love", "medication", "wake_fortune", "wake_weather").forEach { context ->
            assertEquals(context, randomPromptContextForBucket(clonePrerenderBucketCategoryFor(context)))
        }
        assertNull(randomPromptContextForBucket(null))
        assertNull(randomPromptContextForBucket("unknown"))
    }

    @Test
    fun bucketAlarmKeepsItsMessageContextOnSave() {
        // 버킷을 붙이면 voiceRandomPrompt 가 꺼진다. 그때 종류까지 떨어뜨리면 다음 새 알람이
        // '기본 인사말'로 되돌아가고, 이 알람을 다시 열면 '직접 입력'으로 보인다.
        val editor = AlarmEditorState.from(alarm = null, defaultPlayMode = AlarmPlayModes.VOICE_ONLY)
        editor.voiceProfileId = "clone-profile"
        editor.voiceRandomPrompt = true
        editor.voiceRandomContext = "love"

        editor.setBucketAudio(
            audio = CachedAlarmAudio(
                localAudioUri = "file://clip0.mp3",
                rawAudioUri = "r2://clip0.mp3",
                displayName = "clip0",
                durationMillis = null,
                cacheKey = "stock_clip-0",
                messageId = "clip-0",
            ),
            profileId = "clone-profile",
            messageId = "clip-0",
            text = "사랑해",
            bucket = "love",
            language = "ko",
            clipKeys = listOf("stock_clip-0", "stock_clip-1"),
        )

        val draft = editor.toDraft()

        assertFalse(draft.voiceRandomPrompt)
        assertEquals("love", draft.bucketId)
        assertEquals("love", draft.voiceRandomContext)
    }

    @Test
    fun manualAlarmStillDropsItsMessageContextOnSave() {
        // 직접 입력은 종류가 없다 — 버킷 예외가 여기까지 새면 안 된다.
        val editor = AlarmEditorState.from(alarm = null, defaultPlayMode = AlarmPlayModes.VOICE_ONLY)
        editor.voiceProfileId = "clone-profile"
        editor.voiceRandomContext = "love"
        editor.voiceRandomPrompt = false
        editor.voiceText = "일어나"

        assertNull(editor.toDraft().voiceRandomContext)
    }

    @Test
    fun newAlarmOpensWithTheLastManualTextWhenThatWasTheLastChoice() {
        // 문구까지 이어받아야 새 알람이 **바로 저장 가능**하다(빈 직접입력이면 저장이 막힌다).
        val editor = AlarmEditorState.from(
            alarm = null,
            defaultPlayMode = AlarmPlayModes.VOICE_ONLY,
            defaultManualText = "회의 자료 챙겨",
        )

        assertFalse(editor.voiceRandomPrompt)
        assertEquals("회의 자료 챙겨", editor.voiceText)
    }

    @Test
    fun existingAlarmIgnoresTheLastManualText() {
        // 기존 알람을 열기만 해도 문구가 바뀌면 안 된다.
        val editor = AlarmEditorState.from(
            alarm = bucketAlarmEntity(voiceRandomContext = "love", bucketId = "love"),
            defaultManualText = "회의 자료 챙겨",
        )

        assertEquals("클립 문구", editor.voiceText)
    }

    @Test
    fun blankLastManualTextFallsBackToTheGenerativeChoice() {
        val editor = AlarmEditorState.from(
            alarm = null,
            defaultPlayMode = AlarmPlayModes.VOICE_ONLY,
            defaultRandomContext = "love",
            defaultManualText = "   ",
        )

        assertTrue(editor.voiceRandomPrompt)
        assertEquals("love", editor.voiceRandomContext)
    }

    @Test
    fun legacyBucketAlarmRecoversMessageContextFromItsBucket() {
        // 종류를 떨어뜨리던 시절에 저장된 행: bucketId 만 남아 있다.
        val editor = AlarmEditorState.from(
            alarm = bucketAlarmEntity(voiceRandomContext = null, bucketId = "fortune"),
        )

        assertEquals("wake_fortune", editor.voiceRandomContext)
    }

    @Test
    fun savedMessageContextWinsOverBucketDerivedOne() {
        val editor = AlarmEditorState.from(
            alarm = bucketAlarmEntity(voiceRandomContext = "love", bucketId = "fortune"),
        )

        assertEquals("love", editor.voiceRandomContext)
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

    /** 버킷 회전으로 저장된 알람 행. [voiceRandomContext] 만 바꿔 옛 행/새 행을 만든다. */
    private fun bucketAlarmEntity(voiceRandomContext: String?, bucketId: String) = AlarmEntity(
        id = "a",
        label = "bucket",
        hour = 7,
        minute = 0,
        fireAtMillis = 0L,
        repeatDaysMask = 0,
        holidayOff = false,
        snoozeEnabled = true,
        snoozeMinutes = 5,
        snoozeRepeatLimit = SnoozeRepeatLimits.THREE,
        snoozeCount = 0,
        vibrationPattern = VibrationPatterns.DEFAULT,
        playMode = AlarmPlayModes.VOICE_ONLY,
        defaultAlarmSoundId = DefaultAlarmSounds.BUNDLED_DEFAULT,
        localAudioUri = "file://clip0.mp3",
        audioCacheKey = "stock_clip-0",
        rawAudioUri = "r2://clip0.mp3",
        voiceSource = VoiceSources.TTS_PROFILE,
        voiceProfileId = "clone-profile",
        voiceListenerTitle = null,
        voiceText = "클립 문구",
        voiceCategory = "custom",
        voiceLanguage = "ko",
        // 버킷 알람의 특징 — 랜덤 생성은 꺼진 채 버킷 메타만 남는다.
        voiceRandomPrompt = false,
        voiceRandomContext = voiceRandomContext,
        voiceWeatherCountry = null,
        voiceWeatherCity = null,
        voiceFortuneGender = null,
        voiceFortuneBirthDate = null,
        voiceFortuneBirthTime = null,
        dynamicVoicePreparedForFireAtMillis = null,
        voiceRepeat = true,
        voiceVolumePercent = 100,
        ttsMessageId = "clip-0",
        bucketId = bucketId,
        bucketClipKeysJson = encodeBucketClipKeys(listOf("stock_clip-0", "stock_clip-1")),
        remoteAlarmId = null,
        lastSyncedAtMillis = null,
        syncState = AlarmSyncStates.LOCAL_ONLY,
        origin = AlarmOrigins.LOCAL_OWNED,
        alarmVolumePercent = 100,
        alarmSoundUri = null,
        alarmSoundLabel = null,
        enabled = true,
        state = AlarmStates.SCHEDULED,
        createdAtMillis = 0L,
        updatedAtMillis = 0L,
    )

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
