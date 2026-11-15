package com.alarmtalk.app.data

import com.alarmtalk.app.network.StockClip
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 응원 다양하게 / 이 문구로 고정 — 스펙 `docs/spec/voice-and-message.md` §5-4.
 * iOS 짝은 `AlarmTalkTests/CheerVarietyTests` — 같은 입력에 같은 답이어야 한다(특히 [cheerSeedIndex]).
 */
class CheerVarietyTest {
    private val ids = (1..14).map { "cheer_v2_%02d".format(it) }
    private fun candidates(list: List<String> = ids) = list.map { CheerCandidate(it, "stock_$it", "문구 $it") }

    @Test
    fun seedIndexIsTheSharedHash() {
        // 두 앱이 같은 값을 내야 한다 — iOS `CheerVarietyTests.test_seedIndexIsTheSharedHash` 와 같은 표.
        assertEquals(3, cheerSeedIndex(1_800_000_000_000L, 7))
        assertEquals(10, cheerSeedIndex(1_800_000_000_000L, 14))
        assertEquals(2, cheerSeedIndex(1_800_086_400_000L, 3))
        assertEquals(2, cheerSeedIndex(1_761_868_800_000L, 14))
        // 같은 회차를 밀리초가 다르게 계산해도 같은 자리다.
        assertEquals(cheerSeedIndex(1_800_000_000_000L, 14), cheerSeedIndex(1_800_000_059_999L, 14))
    }

    @Test
    fun varyExcludesTheLastSevenPreparedLines() {
        val history = ids.take(9) // 01..09 — 최근 7개는 03..09
        val picked = pickCheerContent(ids, history, 1_800_000_000_000L)!!
        assertTrue(picked !in ids.subList(2, 9))
        // 같은 이력·같은 회차는 언제나 같은 답이다.
        assertEquals(picked, pickCheerContent(ids, history, 1_800_000_000_000L))
    }

    @Test
    fun whenTooFewCandidatesTheOldestPreparedLineIsAllowed() {
        val legacy = listOf("cheer_v1_01", "cheer_v1_02", "cheer_v1_03")
        val history = listOf("cheer_v1_02", "cheer_v1_03", "cheer_v1_01")
        assertEquals("cheer_v1_02", pickCheerContent(legacy, history, 1L))
        // 고른 적 없는 것이 가장 오래됐다 — 다만 그건 최근 7개 밖이라 위 갈래가 먼저 집는다.
        assertEquals("cheer_v1_03", pickCheerContent(legacy, listOf("cheer_v1_01", "cheer_v1_02"), 1L))
        assertNull(pickCheerContent(emptyList(), history, 1L))
    }

    @Test
    fun historyMovesRepeatsToTheEndAndIsCapped() {
        assertEquals(listOf("b", "a"), appendCheerHistory(listOf("a", "b"), "a"))
        val long = (1..40).map { "id$it" }.fold(emptyList<String>()) { acc, id -> appendCheerHistory(acc, id) }
        assertEquals(CHEER_HISTORY_LIMIT, long.size)
        assertEquals("id40", long.last())
    }

    @Test
    fun sameOccurrenceReusesTheSelectionWithoutAddingHistory() {
        val first = cheerAlarm().preparedCheer(OCCURRENCE, candidates(), explicitChange = true)
        val selection = first.cheerSelection()!!
        assertEquals(OCCURRENCE, selection.occurrence)
        assertEquals(listOf(selection.contentId), decodeCheerHistory(first.cheerHistoryJson))

        // 앱 복귀·재시도·설정을 안 바꾼 저장 — 같은 회차는 같은 문구, 이력 그대로.
        val again = first.preparedCheer(OCCURRENCE, candidates(), explicitChange = false)
        assertSame(first, again)
    }

    @Test
    fun aNewOccurrencePicksAgainAndRecordsIt() {
        val first = cheerAlarm().preparedCheer(OCCURRENCE, candidates(), explicitChange = true)
        val next = first.preparedCheer(OCCURRENCE + DAY, candidates(), explicitChange = false)
        val firstId = first.cheerSelection()!!.contentId
        val nextId = next.cheerSelection()!!.contentId
        assertNotEquals(firstId, nextId)
        assertEquals(listOf(firstId, nextId), decodeCheerHistory(next.cheerHistoryJson))
        // 이어지는 여덟 회차 동안 같은 문구가 다시 나오지 않는다(최근 7개 제외).
        var alarm = next
        val seen = mutableListOf(firstId, nextId)
        for (day in 2..7) {
            alarm = alarm.preparedCheer(OCCURRENCE + day * DAY, candidates(), explicitChange = false)
            seen += alarm.cheerSelection()!!.contentId
        }
        assertEquals(seen.size, seen.toSet().size)
    }

    @Test
    fun pinnedUsesTheChosenLineAndFallsBackWithoutClearingIt() {
        val pinned = cheerAlarm(mode = CheerModes.PINNED, pinned = "cheer_v2_05")
        assertEquals("cheer_v2_05", pinned.preparedCheer(OCCURRENCE, candidates(), true).cheerSelection()!!.contentId)

        // 그 목소리·언어에 아직 없다 — 이번 회차는 다양하게로 고르고 고정값은 그대로 둔다.
        val missing = pinned.preparedCheer(OCCURRENCE, candidates(ids - "cheer_v2_05"), true)
        assertNotEquals("cheer_v2_05", missing.cheerSelection()!!.contentId)
        assertEquals("cheer_v2_05", missing.cheerPinnedContentId)
    }

    @Test
    fun explicitChangePicksAgainForTheSameOccurrence() {
        val vary = cheerAlarm().preparedCheer(OCCURRENCE, candidates(), explicitChange = true)
        val repinned = vary.copy(cheerMode = CheerModes.PINNED, cheerPinnedContentId = "cheer_v2_14")
            .preparedCheer(OCCURRENCE, candidates(), explicitChange = true)
        assertEquals("cheer_v2_14", repinned.cheerSelection()!!.contentId)
        assertTrue(cheerSettingsChanged(vary, CheerModes.PINNED, "cheer_v2_14"))
        assertTrue(!cheerSettingsChanged(vary, CheerModes.VARY, null))
    }

    @Test
    fun withoutCandidatesNothingIsChosenAndTheBoundRotationPlays() {
        val first = cheerAlarm().preparedCheer(OCCURRENCE, candidates(), explicitChange = true)
        val none = first.preparedCheer(OCCURRENCE + DAY, emptyList(), explicitChange = false)
        assertNull(none.cheerSelectionJson)
        assertEquals(first.cheerHistoryJson, none.cheerHistoryJson)
        // 응원이 아니게 된 알람의 선택은 지운다.
        assertNull(first.copy(bucketId = "medication").preparedCheer(OCCURRENCE, candidates(), true).cheerSelectionJson)
    }

    @Test
    fun selectionPlaysOnlyForTheLanguageItWasPreparedIn() {
        val prepared = cheerAlarm().preparedCheer(OCCURRENCE, candidates(), explicitChange = true)
        assertEquals("ko", prepared.activeCheerSelection()!!.language)
        assertNull(prepared.copy(voiceLanguage = "en").activeCheerSelection())
    }

    @Test
    fun downgradedAlarmDoesNotPlayTheOldVoiceSelection() {
        // 클론으로 고른 회차 — 구독 만료로 기본 목소리로 강등된다. 강등은 선택 칸을 그대로 두고 목소리만 바꾼다.
        val prepared = cheerAlarm().preparedCheer(OCCURRENCE, candidates(), explicitChange = true)
        val locked = prepared.lockedToDefaultVoice(TEST_SYSTEM_VOICE_ID, null, null, null, nowMillis = 5_000L)
        assertEquals(prepared.cheerSelectionJson, locked.cheerSelectionJson)
        // 울릴 때 옛 클론 클립을 쓰지 않는다 — 묶어 둔 회전(기본 목소리)이 운다.
        assertNull(locked.activeCheerSelection())

        // 같은 회차를 다시 준비하면 기본 목소리의 클립으로 고른다.
        val defaultCandidates = ids.map { CheerCandidate(it, "stock_default_$it", "문구 $it") }
        val rebound = locked.preparedCheer(OCCURRENCE, defaultCandidates, explicitChange = false)
        val selection = rebound.activeCheerSelection()!!
        assertEquals(TEST_SYSTEM_VOICE_ID, selection.voiceProfileId)
        assertTrue(selection.cacheKey.startsWith("stock_default_"))
    }

    @Test
    fun editingTheVoiceForTheSameOccurrencePicksTheNewVoiceClip() {
        val prepared = cheerAlarm().preparedCheer(OCCURRENCE, candidates(), explicitChange = true)
        // 문구 ID 는 목소리끼리 같다(cheer_v2_05) — ID 만 보면 옛 목소리 클립이 남는다.
        val otherCandidates = ids.map { CheerCandidate(it, "stock_other_$it", "문구 $it") }
        val edited = prepared.copy(voiceProfileId = OTHER_VOICE)
            .preparedCheer(OCCURRENCE, otherCandidates, explicitChange = false)
        val selection = edited.activeCheerSelection()!!
        assertEquals(OTHER_VOICE, selection.voiceProfileId)
        assertTrue(selection.cacheKey.startsWith("stock_other_"))
    }

    @Test
    fun aSelectionWithoutVoiceIsNotUsed() {
        val legacy = cheerAlarm().copy(
            cheerSelectionJson = "{\"o\":$OCCURRENCE,\"id\":\"cheer_v2_05\",\"key\":\"stock_x\",\"text\":\"t\",\"lang\":\"ko\"}",
        )
        assertNull(legacy.activeCheerSelection())
    }

    @Test
    fun candidatesComeFromTheManifestThemeAndOnlySelectableCachedLines() {
        val clips = listOf(
            clip("m-legacy", "cheer", 0, contentId = "cheer_v1_01", selectable = false),
            clip("m-01", "cheer_v2", 0, contentId = "cheer_v2_01"),
            clip("m-02", "cheer_v2", 1, contentId = "cheer_v2_02"),
            clip("m-en", "cheer_v2", 0, contentId = "cheer_v2_01", language = "en"),
            clip("m-other", "cheer_v2", 0, contentId = "cheer_v2_01", voice = "other"),
            clip("m-weather", "weather", 0),
            // 옛 서버(표지 없음) — 후보가 아니다.
            clip("m-old", "cheer", 1, theme = null, contentId = null, selectable = null),
        )
        val cached = setOf("stock_m-01", "stock_m-legacy", "stock_m-old")
        val result = cheerCandidatesFrom(clips, VOICE, "ko") { key, _ -> key in cached }
        assertEquals(listOf("cheer_v2_01"), result.map { it.contentId })
        // 고정 목록(화면)은 매니페스트에 있는 것 전부 — 받기는 선다운로드가 한다.
        assertEquals(listOf("cheer_v2_01", "cheer_v2_02"), cheerPhrasesFrom(clips, VOICE, "ko").map { it.second.contentId })
    }

    private fun clip(
        id: String,
        category: String,
        variant: Int,
        language: String = "ko",
        voice: String = VOICE,
        theme: String? = if (category.startsWith("cheer")) "cheer" else category,
        contentId: String? = null,
        selectable: Boolean? = true,
    ) = StockClip(
        messageId = id,
        voiceProfileId = voice,
        category = category,
        language = language,
        variant = variant,
        text = "$category $variant",
        audioUrl = "r2://x/$id.mp3",
        theme = theme,
        contentId = contentId,
        selectable = selectable,
    )

    private fun cheerAlarm(mode: String? = null, pinned: String? = null): AlarmEntity =
        AlarmEntity(
            id = "alarm",
            label = "",
            hour = 7,
            minute = 0,
            fireAtMillis = OCCURRENCE,
            repeatDaysMask = 0b1111111,
            holidayOff = false,
            snoozeEnabled = true,
            snoozeMinutes = 5,
            snoozeRepeatLimit = 3,
            snoozeCount = 0,
            vibrationPattern = VibrationPatterns.DEFAULT,
            playMode = AlarmPlayModes.VOICE_ONLY,
            defaultAlarmSoundId = DefaultAlarmSounds.BUNDLED_DEFAULT,
            localAudioUri = null,
            audioCacheKey = null,
            rawAudioUri = null,
            voiceSource = VoiceSources.TTS_PROFILE,
            voiceProfileId = VOICE,
            voiceListenerTitle = null,
            voiceText = null,
            voiceCategory = null,
            voiceLanguage = "ko",
            voiceRandomPrompt = false,
            voiceRandomContext = "cheer",
            voiceWeatherCountry = null,
            voiceWeatherCity = null,
            voiceFortuneGender = null,
            voiceFortuneBirthDate = null,
            voiceFortuneBirthTime = null,
            dynamicVoicePreparedForFireAtMillis = null,
            voiceRepeat = true,
            voiceVolumePercent = 100,
            ttsMessageId = null,
            bucketId = CHEER_BUCKET_ID,
            remoteAlarmId = null,
            lastSyncedAtMillis = null,
            syncState = AlarmSyncStates.LOCAL_ONLY,
            origin = AlarmOrigins.LOCAL_OWNED,
            alarmVolumePercent = 100,
            alarmSoundUri = null,
            alarmSoundLabel = null,
            enabled = true,
            state = AlarmStates.SCHEDULED,
            createdAtMillis = 1L,
            updatedAtMillis = 1L,
            cheerMode = mode,
            cheerPinnedContentId = pinned,
        )

    private companion object {
        const val VOICE = "70000000-0000-4000-9000-000000000102"
        const val OTHER_VOICE = "70000000-0000-4000-9000-000000000103"
        const val OCCURRENCE = 1_800_000_000_000L
        const val DAY = 86_400_000L
    }
}
