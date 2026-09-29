package com.alarmtalk.app.data

import com.alarmtalk.app.network.ExpectedVariantCounts
import com.alarmtalk.app.network.StockClip
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * 유료 목소리를 못 쓰게 된 알람의 **기본 목소리 대체** — 고르기·묶기·잠금·복원
 * (`docs/spec/billing-lifecycle.md` 「목소리를 못 쓰게 되면」).
 *
 * 로보렉트릭인 이유: 클립 키 목록이 `org.json` 으로 직렬화된다(JVM 단위 테스트에서는 스텁이다).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class DefaultVoiceFallbackTest {

    private fun stockClip(voice: String, category: String, variant: Int, language: String = "ko") = StockClip(
        messageId = "$voice-$category-$language-$variant",
        voiceProfileId = voice,
        category = category,
        language = language,
        variant = variant,
        text = "$category $variant",
        audioUrl = "https://cdn.example/$voice/$category/$variant.mp3",
    )

    private fun cachedAll(key: String, url: String?) = CachedAlarmAudio(
        localAudioUri = "file:///audio/$key.mp3",
        rawAudioUri = url,
        displayName = key,
        durationMillis = 3_000L,
        cacheKey = key,
    )

    // ------------------------------------------------------------ 어느 목소리

    @Test
    fun keepsTheAlarmsOwnSystemVoice() {
        // 시우 알람은 시우 그대로다 — 미나로 바꿀 이유가 없다(제자리 교체로 낡은 것은 오디오뿐이다).
        assertEquals(TEST_SYSTEM_VOICE_ID, pickDefaultSystemVoiceId(alarmVoiceId = TEST_SYSTEM_VOICE_ID))
    }

    /** 대체 목소리는 **미나 하나**다(2026-09-29 "미나로 통일도 해") — 마지막에 쓴 기본 목소리를 보지 않는다. */
    @Test
    fun everyOtherAlarmGetsMina() {
        assertEquals("미나", bundledSystemVoiceProfiles().first { it.id == SUBSTITUTE_SYSTEM_VOICE_ID }.name)
        assertEquals(SUBSTITUTE_SYSTEM_VOICE_ID, pickDefaultSystemVoiceId(alarmVoiceId = TEST_CLONE_VOICE_ID))
        assertEquals(SUBSTITUTE_SYSTEM_VOICE_ID, pickDefaultSystemVoiceId(alarmVoiceId = null))
    }

    // ------------------------------------------------------------ 어느 테마

    @Test
    fun bucketFollowsTheAlarmsTheme() {
        assertEquals("weather", defaultVoiceBucketFor("weather", "wake_weather"))
        assertEquals("cheer", defaultVoiceBucketFor("love", null))
        assertEquals("medication", defaultVoiceBucketFor(null, "medication"))
        assertEquals("fortune", defaultVoiceBucketFor(null, "wake_fortune"))
    }

    @Test
    fun greetingAndManualKindsHaveNoDefaultVoiceTheme() {
        // 기본 목소리의 greeting 은 미리듣기용 자기소개라 테마가 아니다(voice-and-message.md §2).
        assertNull(defaultVoiceBucketFor("greeting", "preset"))
        assertNull(defaultVoiceBucketFor(null, "preset"))
        assertNull(defaultVoiceBucketFor(null, "manual"))
        assertNull(defaultVoiceBucketFor(null, null))
    }

    // ------------------------------------------------------------ 묶기

    @Test
    fun clipSetIsOrderedByVariantAndDeduplicated() {
        val clips = listOf(
            stockClip(TEST_SYSTEM_VOICE_ID, "weather", 2),
            stockClip(TEST_SYSTEM_VOICE_ID, "weather", 0),
            stockClip(TEST_SYSTEM_VOICE_ID, "weather", 1),
            stockClip(TEST_SYSTEM_VOICE_ID, "weather", 1).copy(messageId = "dup"),
            stockClip(TEST_SYSTEM_VOICE_ID, "weather", 0, language = "en"),
            stockClip(TEST_SECOND_SYSTEM_VOICE_ID, "weather", 0),
        )

        val set = defaultVoiceClipSet(clips, TEST_SYSTEM_VOICE_ID, "weather", "ko", null, ::cachedAll)

        assertEquals(listOf(0, 1, 2), set!!.map { it.text.substringAfter(' ').toInt() })
        assertEquals("stock_$TEST_SYSTEM_VOICE_ID-weather-ko-0", set.first().cacheKey)
    }

    @Test
    fun aSingleMissingClipMeansNoBinding() {
        // 날씨는 자리 번호가 곧 조건이다 — 빠진 것을 건너뛰어 묶으면 맑은 날에 우산 얘기를 한다.
        val clips = (0..2).map { stockClip(TEST_SYSTEM_VOICE_ID, "weather", it) }
        val set = defaultVoiceClipSet(clips, TEST_SYSTEM_VOICE_ID, "weather", "ko", null) { key, url ->
            if (key.endsWith("-1")) null else cachedAll(key, url)
        }

        assertNull(set)
    }

    /**
     * 매니페스트 자체가 모자란 경우(Codex #820) — 가운데 variant 가 빠진 목록을 순서대로 묶으면
     * 뒤 자리가 밀려 **다른 날씨 조건의 문구**를 튼다. 캐시가 다 있어도 묶지 않는다.
     */
    @Test
    fun aManifestMissingAMiddleVariantIsNeverBound() {
        val gap = listOf(0, 1, 3).map { stockClip(TEST_SYSTEM_VOICE_ID, "weather", it) }

        assertNull("개수를 몰라도 빈틈은 안다", defaultVoiceClipSet(gap, TEST_SYSTEM_VOICE_ID, "weather", "ko", null, ::cachedAll))
        assertNull(
            defaultVoiceClipSet(gap, TEST_SYSTEM_VOICE_ID, "weather", "ko", ExpectedVariantCounts(system = mapOf("weather" to 4)), ::cachedAll),
        )
    }

    @Test
    fun theServersExpectedCountDecidesWhetherTheSetIsComplete() {
        val three = (0..2).map { stockClip(TEST_SYSTEM_VOICE_ID, "weather", it) }
        val nine = ExpectedVariantCounts(system = mapOf("weather" to 9), clone = mapOf("weather" to 3))

        // 꼬리가 잘린 세트 — 서버가 9개라고 하니 모자란다(클론 개수와 헷갈리지 않는다).
        assertNull(defaultVoiceClipSet(three, TEST_SYSTEM_VOICE_ID, "weather", "ko", nine, ::cachedAll))
        assertEquals(
            3,
            defaultVoiceClipSet(three, TEST_SYSTEM_VOICE_ID, "weather", "ko", ExpectedVariantCounts(system = mapOf("weather" to 3)), ::cachedAll)?.size,
        )
        assertEquals(
            listOf(0, 1, 2),
            completeDefaultVoiceClips(three, TEST_SYSTEM_VOICE_ID, "weather", "ko", null)?.map { it.variant },
        )
    }

    // ------------------------------------------------------------ 잠금 · 복원

    private fun boundClips(): List<DefaultVoiceClip> =
        defaultVoiceClipSet(
            (0..8).map { stockClip(TEST_SYSTEM_VOICE_ID, "weather", it) },
            TEST_SYSTEM_VOICE_ID,
            "weather",
            "ko",
            null,
            ::cachedAll,
        )!!

    @Test
    fun lockingKeepsVoiceModeAndBindsTheDefaultVoiceTheme() {
        val original = rehearsalCloneAlarm()

        val locked = original.lockedToDefaultVoice(TEST_SYSTEM_VOICE_ID, "weather", "ko", boundClips(), nowMillis = 5_000L)

        // '그냥 기본 알람' 이 되지 않는다 — 리허설의 지적.
        assertEquals(AlarmPlayModes.VOICE_ONLY, locked.playMode)
        assertEquals(TEST_SYSTEM_VOICE_ID, locked.voiceProfileId)
        assertEquals(VoiceSources.TTS_PROFILE, locked.voiceSource)
        assertEquals("weather", locked.bucketId)
        assertEquals(9, locked.bucketClipKeys().size)
        assertEquals("$TEST_SYSTEM_VOICE_ID-weather-ko-0", locked.ttsMessageId)
        assertEquals("wake_weather", locked.voiceRandomContext)
        assertNull("호칭은 클론 문구의 것이다", locked.voiceListenerTitle)
        // 날씨 조건 인덱스는 variant 축이 같아 그대로 간다.
        assertEquals(1, locked.contextVariantIndex)
        // 잠금 표시와 보관본.
        assertEquals(AlarmPlayModes.VOICE_ONLY, locked.preLockPlayMode)
        assertTrue(locked.hasLockedPaidVoice())
        // 이제 무료로 쓸 수 있는 기본 목소리 알람이다 — 울릴 때 강등·다음 잠금의 대상이 아니다.
        assertTrue(locked.usesFreeSystemVoiceAlarm())
        // 진동·알람음 설정·동기 상태는 건드리지 않는다.
        assertEquals(original.vibrationPattern, locked.vibrationPattern)
        assertEquals(original.alarmSoundEnabled, locked.alarmSoundEnabled)
        assertEquals(original.syncState, locked.syncState)
    }

    @Test
    fun lockingWithoutClipsLeavesAnAudiolessDefaultVoiceAlarm() {
        val original = rehearsalCloneAlarm(bucketId = "greeting", voiceRandomContext = "preset")

        val locked = original.lockedToDefaultVoice(TEST_SYSTEM_VOICE_ID, bucket = null, language = null, clips = null, nowMillis = 5_000L)

        assertEquals(AlarmPlayModes.VOICE_ONLY, locked.playMode)
        assertEquals(TEST_SYSTEM_VOICE_ID, locked.voiceProfileId)
        assertNull(locked.bucketId)
        assertNull(locked.localAudioUri)
        assertNull(locked.audioCacheKey)
        assertNull(locked.ttsMessageId)
        assertEquals("preset", locked.voiceRandomContext)
        assertNull("클론이 읽던 문장을 잠금화면에 남기지 않는다", locked.voiceText)
        assertTrue(locked.usesFreeSystemVoiceAlarm())
    }

    /**
     * 기본 목소리 테마가 있는 종류인데 클립을 다 받아 두지 못했다(Codex #820) — 오디오 없이 두되
     * **테마는 남긴다.** 비우면 편집기가 종류를 잃어 시각만 고쳐 저장해도 문구가 바뀌고, 날씨
     * 조건 갱신이 멈춰 울릴 때 대체 클립이 낡은 조건을 고른다.
     */
    @Test
    fun lockingAThemeWithoutClipsKeepsTheTheme() {
        val original = rehearsalCloneAlarm()

        val locked = original.lockedToDefaultVoice(TEST_SYSTEM_VOICE_ID, bucket = null, language = null, clips = null, nowMillis = 5_000L)

        assertEquals("weather", locked.bucketId)
        assertEquals("wake_weather", locked.voiceRandomContext)
        assertNull(locked.bucketClipKeysJson)
        assertNull(locked.localAudioUri)
        assertNull(locked.ttsMessageId)
        assertEquals("날씨 조건 자리는 그대로", original.contextVariantIndex, locked.contextVariantIndex)
        assertFalse("직접 입력으로 읽히지 않는다", locked.usesCustomMessageVoice())
        assertTrue(locked.usesFreeSystemVoiceAlarm())
        // 옛 이름은 새 이름으로 접는다.
        assertEquals(
            "cheer",
            rehearsalCloneAlarm(bucketId = "love", voiceRandomContext = null)
                .lockedToDefaultVoice(TEST_SYSTEM_VOICE_ID, null, null, null, 5_000L)
                .bucketId,
        )
    }

    @Test
    fun lockingAManualTextAlarmKeepsTheTypedText() {
        val manual = rehearsalCloneAlarm(bucketId = null, voiceRandomContext = null, audioCacheKey = "hash-abc")

        val locked = manual.lockedToDefaultVoice(TEST_SYSTEM_VOICE_ID, null, null, null, nowMillis = 5_000L)

        assertEquals("비 온대, 우산 챙겨", locked.voiceText)
        assertNull("직접 입력은 기본 목소리 테마가 없다", locked.bucketId)
    }

    @Test
    fun oldShapeLocksAreMovedBackToVoiceMode() {
        val legacy = rehearsalCloneAlarm(playMode = AlarmPlayModes.ALARM_ONLY, preLockPlayMode = AlarmPlayModes.VOICE_ONLY)
        assertTrue(legacy.isLegacyPlanLock())

        val locked = legacy.lockedToDefaultVoice(TEST_SYSTEM_VOICE_ID, "weather", "ko", boundClips(), nowMillis = 5_000L)

        assertEquals(AlarmPlayModes.VOICE_ONLY, locked.playMode)
        assertFalse(locked.isLegacyPlanLock())
        assertFalse(locked.wasVoiceAlarmConvertedBySystem())
    }

    @Test
    fun lockingTwiceKeepsTheOriginalSnapshot() {
        val once = rehearsalCloneAlarm().lockedToDefaultVoice(TEST_SYSTEM_VOICE_ID, "weather", "ko", boundClips(), 5_000L)
        val twice = once.lockedToDefaultVoice(TEST_SECOND_SYSTEM_VOICE_ID, null, null, null, 6_000L)

        assertEquals(once.preLockVoiceJson, twice.preLockVoiceJson)
        assertEquals(TEST_CLONE_VOICE_ID, twice.lockedPaidVoice()?.voiceProfileId)
    }

    @Test
    fun restoringBringsTheWholePaidVoiceBackAndQueuesASync() {
        val original = rehearsalCloneAlarm(
            bucketClipKeysJson = encodeBucketClipKeys(listOf("stock_clone-weather-0", "stock_clone-weather-1")),
        )
        val locked = original.lockedToDefaultVoice(TEST_SYSTEM_VOICE_ID, "weather", "ko", boundClips(), 5_000L)

        val restored = locked.restoredFromLock(nowMillis = 7_000L)

        assertEquals(AlarmPlayModes.VOICE_ONLY, restored.playMode)
        assertNull(restored.preLockPlayMode)
        assertNull(restored.preLockVoiceJson)
        assertEquals(original.voiceProfileId, restored.voiceProfileId)
        assertEquals(original.voiceListenerTitle, restored.voiceListenerTitle)
        assertEquals(original.voiceText, restored.voiceText)
        assertEquals(original.localAudioUri, restored.localAudioUri)
        assertEquals(original.audioCacheKey, restored.audioCacheKey)
        assertEquals(original.ttsMessageId, restored.ttsMessageId)
        assertEquals(original.bucketId, restored.bucketId)
        assertEquals(original.bucketClipKeysJson, restored.bucketClipKeysJson)
        assertEquals(original.contextVariantIndex, restored.contextVariantIndex)
        // 잠긴 동안 토글이 기본 목소리를 서버에 올렸을 수 있다 — 되돌린 것을 다시 올린다.
        assertEquals(AlarmSyncStates.DIRTY, restored.syncState)
    }

    @Test
    fun restoringAnOldShapeLockOnlyRestoresThePlayMode() {
        val legacy = rehearsalCloneAlarm(playMode = AlarmPlayModes.ALARM_ONLY, preLockPlayMode = AlarmPlayModes.VOICE_ONLY)

        val restored = legacy.restoredFromLock(nowMillis = 7_000L)

        assertEquals(AlarmPlayModes.VOICE_ONLY, restored.playMode)
        assertNull(restored.preLockPlayMode)
        assertEquals(legacy.syncState, restored.syncState)
    }

    @Test
    fun finalizingKeepsTheDefaultVoice() {
        val locked = rehearsalCloneAlarm().lockedToDefaultVoice(TEST_SYSTEM_VOICE_ID, "weather", "ko", boundClips(), 5_000L)

        val finalized = locked.finalizedLock(nowMillis = 8_000L)

        assertEquals(AlarmPlayModes.VOICE_ONLY, finalized.playMode)
        assertEquals(TEST_SYSTEM_VOICE_ID, finalized.voiceProfileId)
        assertNull(finalized.preLockPlayMode)
        assertFalse(finalized.hasLockedPaidVoice())
    }

    @Test
    fun snapshotSurvivesAMalformedValue() {
        assertNull(rehearsalCloneAlarm().copy(preLockVoiceJson = "{not json").lockedPaidVoice())
        assertNotNull(
            rehearsalCloneAlarm()
                .lockedToDefaultVoice(TEST_SYSTEM_VOICE_ID, null, null, null, 5_000L)
                .lockedPaidVoice(),
        )
    }

    /**
     * 보관본은 Room 에 남아 **앱 업데이트를 건너서** 읽힌다. release 는 R8 이 필드 이름을 줄이므로
     * 키를 `@SerializedName` 으로 못 박지 않으면 매핑이 바뀐 빌드가 보관본을 잃거나 엉뚱한 필드로
     * 읽는다. 로보렉트릭은 R8 을 거치지 않으니 **애너테이션이 있는지**를 직접 본다 — 새 필드를
     * 더하면서 빠뜨리면 여기서 걸린다.
     */
    @Test
    fun snapshotKeysArePinnedAgainstObfuscation() {
        val fields = LockedPaidVoice::class.java.declaredFields
            .filter { !java.lang.reflect.Modifier.isStatic(it.modifiers) && !it.isSynthetic }
        assertTrue(fields.isNotEmpty())
        fields.forEach { field ->
            assertEquals(
                "${field.name} 의 JSON 키가 고정돼 있지 않다",
                field.name,
                field.getAnnotation(com.google.gson.annotations.SerializedName::class.java)?.value,
            )
        }
        // 이미 잠긴 행이 들고 있는 모양 그대로 읽혀야 한다.
        val stored = """{"voiceProfileId":"clone-a","audioCacheKey":"stock_clone-weather-0","bucketId":"weather"}"""
        val decoded = rehearsalCloneAlarm().copy(preLockVoiceJson = stored).lockedPaidVoice()
        assertEquals("clone-a", decoded?.voiceProfileId)
        assertEquals("stock_clone-weather-0", decoded?.audioCacheKey)
        assertEquals("weather", decoded?.bucketId)
    }

    @Test
    fun ringTimeVariantFollowsTheAlarmsWeatherCondition() {
        val keys = (0..8).map { "stock_$TEST_SYSTEM_VOICE_ID-weather-ko-$it" }

        assertEquals(1, rehearsalCloneAlarm().defaultVoiceVariantIndex("weather", keys))
        // 조건을 못 받았으면 마지막(안내) 클립 — 클론 날씨와 같은 규칙.
        assertEquals(8, rehearsalCloneAlarm().copy(contextVariantIndex = null).defaultVoiceVariantIndex("weather", keys))
    }
}
