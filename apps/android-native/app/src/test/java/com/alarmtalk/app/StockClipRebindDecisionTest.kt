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
import com.alarmtalk.app.data.encodeBucketClipKeys
import com.alarmtalk.app.network.ExpectedVariantCounts
import com.alarmtalk.app.network.StockClip
import com.alarmtalk.app.sync.StockClipLanguageRebinder
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * **다시 묶어야 하는 알람을 가리는 규칙** 회귀 가드.
 *
 * 발사는 저장된 `stock_<id>` 키와 로컬 파일만 보고 **서버를 묻지 않는다** — 그래야
 * 비행기모드에서도 울린다. 그 대가로, 문구·목소리를 통째로 갈아 프리셋을 새로 구우면
 * (message id 가 새로 난다) **기기에 있던 알람은 지워진 대사를 옛 목소리로 영원히
 * 재생한다.** 2026-09-03 리뷰가 잡은 P1 이다.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class StockClipRebindDecisionTest {

    private val live = setOf("stock_new-0", "stock_new-1", "stock_new-2")

    @Test
    fun 언어가_바뀌면_다시_묶는다() {
        assertTrue(StockClipLanguageRebinder.needsRebind(alarmWith(language = "en"), "ko", live))
    }

    @Test
    fun 같은_언어라도_묶인_클립이_전부_사라졌으면_다시_묶는다() {
        // 문구·목소리 교체로 서버가 프리셋을 새로 구운 상황.
        assertTrue(
            StockClipLanguageRebinder.needsRebind(
                alarmWith(clipKeys = listOf("stock_old-0", "stock_old-1")), "ko", live,
            ),
        )
    }

    @Test
    fun 클립이_살아_있으면_건드리지_않는다() {
        assertFalse(
            StockClipLanguageRebinder.needsRebind(
                alarmWith(clipKeys = listOf("stock_new-0", "stock_new-1")), "ko", live,
            ),
        )
    }

    /**
     * ⚠ **부분 세트는 정상이다 — 다시 묶지 않는다.** 시딩이 도는 중이거나 클립이 늘어난
     * 직후에는 일부만 매니페스트에 있다. 그때 갈아타면 매 회차 재바인딩이 돌고, 조건형
     * (날씨·운세)은 **아직 안 구워진 자리로 인덱스가 밀린다.**
     */
    @Test
    fun 일부만_살아_있으면_그대로_둔다() {
        assertFalse(
            StockClipLanguageRebinder.needsRebind(
                alarmWith(clipKeys = listOf("stock_new-0", "stock_old-9")), "ko", live,
            ),
        )
    }

    /**
     * ⚠ **갈아탈 세트가 완전할 때만 갈아탄다**(2026-09-03 리뷰 3차).
     *
     * `needsRebind` 만으로는 **스스로 함정을 판다.** 옛 클립이 다 지워진 직후, 시딩이
     * **첫 variant 만** 올린 순간에 갈아타면 그 하나짜리 세트가 알람에 박히고 — **그 키는
     * 살아 있으므로 다음 회차부터 stale 로도 안 잡힌다.** 시딩이 끝나도 그 알람은 영원히
     * 첫 클립만 갖는다. 날씨·운세는 절대 인덱스로 조건을 고르니 그게 곧 엉뚱한 조건이다.
     */
    @Test
    fun 시딩이_도는_중이면_갈아타지_않는다() {
        // ⚠ 이 알람의 목소리는 클론이므로 `clone` 쪽을 본다 — 기본 목소리와 클론은
        //   개수가 다르다(`countFor(isSystemVoice)`).
        val expected = ExpectedVariantCounts(system = emptyMap(), clone = mapOf("weather" to 9))
        val alarm = alarmWith(bucketId = "weather")
        // 첫 variant 만 올라온 상태 — 갈아타면 그 하나가 영구히 박힌다.
        val partial = (0..2).map { clip("weather", it) }
        assertFalse(
            StockClipLanguageRebinder.replacementIsComplete(alarm, partial, "ko", expected),
        )
        // 9개가 다 차면 그때 갈아탄다.
        val complete = (0..8).map { clip("weather", it) }
        assertTrue(
            StockClipLanguageRebinder.replacementIsComplete(alarm, complete, "ko", expected),
        )
    }

    /** 매니페스트가 개수를 모르면(옛 서버) 막지 않는다 — 못 물어본 것이 근거가 되면 안 된다. */
    @Test
    fun 개수를_모르면_막지_않는다() {
        val alarm = alarmWith(bucketId = "weather")
        val partial = listOf(clip("weather", 0))
        assertTrue(StockClipLanguageRebinder.replacementIsComplete(alarm, partial, "ko", null))
    }

    @Test
    fun 버킷_알람이_아니면_건드리지_않는다() {
        assertFalse(StockClipLanguageRebinder.needsRebind(alarmWith(bucketId = null), "ko", live))
        assertFalse(
            StockClipLanguageRebinder.needsRebind(
                alarmWith(playMode = AlarmPlayModes.ALARM_ONLY), "ko", live,
            ),
        )
        // 녹음 알람에는 문구 개념이 없다.
        assertFalse(
            StockClipLanguageRebinder.needsRebind(
                alarmWith(voiceSource = VoiceSources.LOCAL_AUDIO, language = "en"), "ko", live,
            ),
        )
    }

    private fun clip(category: String, variant: Int) = StockClip(
        messageId = "new-$variant",
        voiceProfileId = "clone-profile",
        category = category,
        language = "ko",
        variant = variant,
        text = "t",
        audioUrl = "r2://x",
    )

    private fun alarmWith(
        language: String = "ko",
        clipKeys: List<String> = listOf("stock_old-0", "stock_old-1"),
        playMode: String = AlarmPlayModes.VOICE_ONLY,
        voiceSource: String = VoiceSources.TTS_PROFILE,
        bucketId: String? = "weather",
    ) = AlarmEntity(
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
        playMode = playMode,
        defaultAlarmSoundId = DefaultAlarmSounds.BUNDLED_DEFAULT,
        localAudioUri = "file://clip0.mp3",
        audioCacheKey = "stock_clip-0",
        rawAudioUri = "r2://clip0.mp3",
        voiceSource = voiceSource,
        voiceProfileId = "clone-profile",
        voiceListenerTitle = null,
        voiceText = "클립 문구",
        voiceCategory = "custom",
        voiceLanguage = language,
        // 버킷 알람의 특징 — 랜덤 생성은 꺼진 채 버킷 메타만 남는다.
        voiceRandomPrompt = false,
        voiceRandomContext = "wake_weather",
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
        bucketClipKeysJson = encodeBucketClipKeys(clipKeys),
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
}
