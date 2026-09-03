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
import com.alarmtalk.app.data.nextLocalSyncState
import com.alarmtalk.app.network.ExpectedVariantCounts
import com.alarmtalk.app.network.StockClip
import com.alarmtalk.app.sync.StockClipLanguageRebinder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
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

    /**
     * ⚠ **언어가 바뀐 갈래에도 완전성이 필요하다**(2026-09-03 리뷰 5차).
     *
     * iOS 가 이 지점을 놓쳤다 — 언어 불일치에서 먼저 true 를 돌려주고 완전성 검사를
     * 건너뛰었다. 시딩이 도는 중에 언어를 바꾸면 **부분 세트가 박히고, 그 키는 살아
     * 있으니 다시는 stale 로 안 잡힌다.** 두 술어를 손으로 조립하던 것을
     * [StockClipLanguageRebinder.shouldRebind] 한 이름으로 묶은 이유다.
     */
    @Test
    fun 언어가_바뀌어도_세트가_모자라면_갈아타지_않는다() {
        val expected = ExpectedVariantCounts(system = emptyMap(), clone = mapOf("weather" to 9))
        val alarm = alarmWith(language = "en", bucketId = "weather")
        val partial = (0..2).map { clip("weather", it) }
        // 다시 묶어야 하는 것은 맞다 — 언어가 어긋났다.
        assertTrue(StockClipLanguageRebinder.needsRebind(alarm, "ko", live))
        // 그래도 세트가 모자라면 갈아타지 않는다.
        assertFalse(StockClipLanguageRebinder.shouldRebind(alarm, "ko", live, partial, expected))
        val complete = (0..8).map { clip("weather", it) }
        assertTrue(StockClipLanguageRebinder.shouldRebind(alarm, "ko", live, complete, expected))
    }

    /**
     * ⚠ **저장된 옛 이름(`love`)은 접어서 새 매니페스트(`cheer`)와 맞춘다.**
     *
     * 접지 않으면 variant 가 0개로 잡혀 [StockClipLanguageRebinder.replacementIsComplete]
     * 가 **영원히 false** 라 그 알람은 갈아탈 방법이 사라진다(리뷰 4차). 그리고 접기를
     * 판정에만 쓰면 `bindBucket` 이 옛 이름으로 매니페스트를 뒤져 역시 영원히 건너뛴다
     * (리뷰 5차) — 그래서 **묶는 자리도 같은 값을 쓴다.**
     */
    @Test
    fun 옛_이름으로_저장된_알람도_새_이름_클립으로_갈아탄다() {
        assertEquals("cheer", StockClipLanguageRebinder.normalizedBucketId("love"))
        // 접지 않는 이름은 그대로 둔다.
        assertEquals("weather", StockClipLanguageRebinder.normalizedBucketId("weather"))

        val expected = ExpectedVariantCounts(system = emptyMap(), clone = mapOf("cheer" to 3))
        val alarm = alarmWith(bucketId = "love")
        val clips = (0..2).map { clip("cheer", it) }
        assertTrue(StockClipLanguageRebinder.shouldRebind(alarm, "ko", live, clips, expected))
    }

    /**
     * ⚠ **로컬만 되살리면 절반만 고친 것이다**(2026-09-03 리뷰 6차).
     *
     * #110 은 지운 프리셋을 가리키던 **서버** 알람을 `mode='sound-only'`,
     * `message_id=NULL` 로 깎는다. 재바인딩이 Room 만 고치고 `SYNCED` 를 그대로 두면
     * 업로드 대상(`AlarmSyncService` 의 LOCAL_ONLY·DIRTY·FAILED)에 안 들어가 **영영 안
     * 올라간다** — 다른 기기·재설치는 깎인 알람을 계속 받는다.
     *
     * 규칙은 `AlarmRepository` 에만 private 로 있었고 재바인더는 **아예 하지 않았다.**
     * 그래서 규칙을 [nextLocalSyncState] 하나로 옮기고 이 테스트로 고정한다.
     */
    @Test
    fun 재바인딩한_원격_알람은_다시_올라간다() {
        val synced = alarmWith(
            remoteAlarmId = "remote-1",
            syncState = AlarmSyncStates.SYNCED,
        )
        assertEquals(AlarmSyncStates.DIRTY, synced.nextLocalSyncState())
    }

    /** 서버에 없던 알람은 새로 올린다. */
    @Test
    fun 서버에_없는_알람은_LOCAL_ONLY() {
        assertEquals(
            AlarmSyncStates.LOCAL_ONLY,
            alarmWith(remoteAlarmId = null, syncState = AlarmSyncStates.SYNCED).nextLocalSyncState(),
        )
    }

    /**
     * **받은 알람은 올리지 않는다.** 서버 행은 전달 수단일 뿐이고, 수신자가 고친 것을
     * 되올리면 보낸 사람의 행을 덮는다(`docs/spec/family-alarm.md`).
     */
    @Test
    fun 받은_알람은_그대로_둔다() {
        assertEquals(
            AlarmSyncStates.SYNCED,
            alarmWith(
                origin = AlarmOrigins.RECEIVED_REMOTE,
                remoteAlarmId = "remote-1",
                syncState = AlarmSyncStates.SYNCED,
            ).nextLocalSyncState(),
        )
    }

    /**
     * ⚠ **다운로드가 도는 동안 사용자가 문구를 직접 쳐 넣으면 덮지 않는다**(2026-09-03 리뷰 9차).
     *
     * 이 워커는 알람을 스냅샷으로 읽고 **여러 번 중단되며** 돌아온다. 그 사이의 편집을
     * 덮지 않으려고 8차에서 가드를 넣었는데, **목소리·테마·소스만** 비교해서 정작 가장
     * 파괴적인 편집을 통과시켰다: 옛 라이브 행을 직접 입력으로 바꾸면 그 셋이 전부
     * 같고(`bucketId` 도 여전히 null) 통과해, 방금 친 문구를 덮어쓴 뒤 테마 알람으로
     * 되돌린다.
     *
     * 판정 축은 「이 알람이 **어떤 종류의 문구**를 쓰는가」 전부여야 한다.
     */
    @Test
    fun 다운로드_중_직접입력으로_바꾼_알람은_덮지_않는다() {
        // 옛 라이브 생성 행(랜덤 켜짐·버킷 없음)을 스냅샷으로 잡았다.
        val snapshot = alarmWith(bucketId = null, randomPrompt = true, randomContext = "wake_weather")
        // 그 사이 사용자가 **같은 목소리로** 직접 입력을 골라 문구를 쳤다.
        val edited = snapshot.copy(voiceRandomPrompt = false, voiceRandomContext = null)
        assertFalse(StockClipLanguageRebinder.canApplyClipFields(snapshot, edited))
    }

    @Test
    fun 문구_종류만_바뀌어도_덮지_않는다() {
        val snapshot = alarmWith(bucketId = null, randomPrompt = true, randomContext = "wake_weather")
        assertFalse(
            StockClipLanguageRebinder.canApplyClipFields(
                snapshot, snapshot.copy(voiceRandomContext = "wake_medication"),
            ),
        )
    }

    /** 시각·on/off 만 바뀐 것은 **얹어도 된다** — 그 값들은 갓 읽은 행의 것이 그대로 남는다. */
    @Test
    fun 시각만_바뀐_알람에는_클립을_얹는다() {
        val snapshot = alarmWith()
        val edited = snapshot.copy(hour = 9, enabled = false, updatedAtMillis = 999L)
        assertTrue(StockClipLanguageRebinder.canApplyClipFields(snapshot, edited))
    }

    @Test
    fun 목소리나_테마가_바뀌면_덮지_않는다() {
        val snapshot = alarmWith()
        assertFalse(
            StockClipLanguageRebinder.canApplyClipFields(
                snapshot, snapshot.copy(voiceProfileId = "other-voice"),
            ),
        )
        assertFalse(
            StockClipLanguageRebinder.canApplyClipFields(
                snapshot, snapshot.copy(bucketId = "fortune"),
            ),
        )
        assertFalse(
            StockClipLanguageRebinder.canApplyClipFields(
                snapshot, snapshot.copy(voiceSource = VoiceSources.LOCAL_AUDIO),
            ),
        )
    }

    /**
     * ⚠ **테마는 아는데 클립 목록이 없는 알람**(2026-09-03 리뷰 11차).
     *
     * 받은 가족 알람이 그 모양이다 — 동기가 `bucketId` 와 대표 클립 하나만 적고
     * `bucketClipKeysJson` 은 비운다. `voiceLanguage` 도 null 이라 한국어 기기에서는
     * 언어 판정에도 안 걸리고, 목록이 비어 사망 판정에도 안 걸린다. 그래서 프리셋을
     * 갈아도 **어디에도 안 걸려 옛 대사를 영원히 재생**했다.
     */
    @Test
    fun 클립_목록이_없어도_대표_클립이_사라졌으면_다시_묶는다() {
        val received = alarmWith(
            bucketId = "medication",  // 회전형 — 조건 인덱스가 필요 없다.
            clipKeys = emptyList(),
            ttsMessageId = "old-0",
            language = null,          // 받은 알람은 언어를 안 적는다 → ko 로 읽힌다.
        )
        assertTrue(StockClipLanguageRebinder.needsRebind(received, "ko", live))
    }

    @Test
    fun 대표_클립이_살아_있으면_그대로_둔다() {
        val received = alarmWith(
            bucketId = "medication", clipKeys = emptyList(), ttsMessageId = "new-0", language = null,
        )
        assertFalse(StockClipLanguageRebinder.needsRebind(received, "ko", live))
    }

    /**
     * ⚠ **조건형 버킷(날씨·운세)도 갈아탄다 — 조건은 받는 사람 것으로 채운다**
     * (2026-09-03 사용자 지시로 12·13차 결정을 뒤집었다).
     *
     * 12차에는 여기서 비켜 갔다. 받은 알람에 `contextVariantIndex` 도 사주도 없어서, 값 없이
     * 전체 세트를 묶으면 날씨가 마지막 '못 알아봤어요' 클립으로 떨어졌기 때문이다.
     * 그런데 그러면 그 알람은 **영원히 옛 대사·옛 목소리**로 남는다(이름만 새 이름).
     * 조건은 이 기기에 있는 **받는 사람 자신의 지역·사주**로 채울 수 있으므로, 갈아탄 뒤
     * `DynamicVoiceRefreshScheduler` 로 즉시 해석한다(편집기 저장 경로와 같다).
     */
    @Test
    fun 조건형_버킷도_대표_클립이_죽었으면_갈아탄다() {
        for (bucket in listOf("weather", "fortune", "medication")) {
            assertTrue(
                "$bucket 을 갈아타지 않았다",
                StockClipLanguageRebinder.needsRebind(
                    alarmWith(
                        bucketId = bucket, clipKeys = emptyList(),
                        ttsMessageId = "old-0", language = null,
                    ),
                    "ko", live,
                ),
            )
            // 언어가 어긋난 기기에서도 같다 — 받은 알람은 `voiceLanguage` 가 null 이라
            // 영어 기기에서는 언어 검사가 먼저 true 를 돌려준다.
            assertTrue(
                "영어 기기에서 $bucket 을 갈아타지 않았다",
                StockClipLanguageRebinder.needsRebind(
                    alarmWith(
                        bucketId = bucket, clipKeys = emptyList(),
                        ttsMessageId = "old-0", language = null,
                    ),
                    "en", live,
                ),
            )
        }
    }

    /**
     * **버킷 없이 클립 하나만 물린 옛 알람**은 서버 힌트로 테마를 알아낸다.
     *
     * `bucket_id` 를 행에 적기 전에 만들어진 알람이다. 힌트가 없으면 재바인더 두 갈래
     * 어디에도 안 걸려 영원히 옛 소리로 운다 — 힌트가 오면 평소대로 갈아탄다.
     */
    @Test
    fun 버킷_없는_옛_알람은_서버_힌트로_갈아탄다() {
        val legacy = alarmWith(
            bucketId = null, clipKeys = emptyList(), ttsMessageId = "old-0", language = null,
        )
        assertFalse(
            "힌트가 없는데 갈아탔다",
            StockClipLanguageRebinder.needsRebind(legacy, "ko", live),
        )
        assertTrue(
            "힌트가 있는데 안 갈아탔다",
            StockClipLanguageRebinder.needsRebind(
                legacy, "ko", live, mapOf("old-0" to "medication"),
            ),
        )
        // 힌트는 **다른 message** 의 것이면 쓰지 않는다.
        assertFalse(
            "남의 힌트로 갈아탔다",
            StockClipLanguageRebinder.needsRebind(
                legacy, "ko", live, mapOf("other" to "medication"),
            ),
        )
    }

    /**
     * **받은 알람에 받는 사람의 조건을 채운다**(2026-09-03 리뷰 15차).
     *
     * 스케줄러를 부르는 것만으로는 안 된다 — 그 워커가 읽는 것이 바로 이 필드들이고,
     * 받은 알람은 전부 비어 있다. 안 채우면 날씨는 서버 기본값(서울)으로, 운세는 빈
     * 프로필 해시로 떨어진다.
     */
    @Test
    fun 조건형_버킷에_받는_사람의_조건을_채운다() {
        val prefs = com.alarmtalk.app.data.DynamicPromptPreferences(
            weatherCountry = "KR", weatherCity = "부산",
            fortuneGender = "female", fortuneBirthDate = "1994-03-02", fortuneBirthTime = "07:30",
        )
        val received = alarmWith(bucketId = "weather", clipKeys = emptyList(), ttsMessageId = "old-0")

        val weather = StockClipLanguageRebinder.withRecipientConditions(received, "weather", prefs)
        assertEquals("KR", weather.voiceWeatherCountry)
        assertEquals("부산", weather.voiceWeatherCity)
        // ⚠ **그 버킷에 필요한 것만 채운다** — 날씨 알람에 사주를 적어 둘 이유가 없다.
        assertNull(weather.voiceFortuneBirthDate)

        val fortune = StockClipLanguageRebinder.withRecipientConditions(received, "fortune", prefs)
        assertEquals("1994-03-02", fortune.voiceFortuneBirthDate)
        assertEquals("07:30", fortune.voiceFortuneBirthTime)
        assertNull(fortune.voiceWeatherCity)

        // 회전형은 조건이 없으므로 아무것도 안 건드린다.
        val medication = StockClipLanguageRebinder.withRecipientConditions(received, "medication", prefs)
        assertNull(medication.voiceWeatherCity)
        assertNull(medication.voiceFortuneBirthDate)
    }

    /** ⚠ **사용자가 그 알람에 넣어 둔 값이 이긴다** — 덮어쓰면 남의 도시로 바뀐다. */
    @Test
    fun 이미_들어_있는_조건은_덮어쓰지_않는다() {
        val prefs = com.alarmtalk.app.data.DynamicPromptPreferences(
            weatherCountry = "KR", weatherCity = "부산",
        )
        val mine = alarmWith(bucketId = "weather", clipKeys = emptyList(), ttsMessageId = "old-0")
            .copy(voiceWeatherCountry = "JP", voiceWeatherCity = "도쿄")
        val filled = StockClipLanguageRebinder.withRecipientConditions(mine, "weather", prefs)
        assertEquals("JP", filled.voiceWeatherCountry)
        assertEquals("도쿄", filled.voiceWeatherCity)
    }

    /** 저장된 취향이 없으면 아무것도 채우지 않는다(빈 문자열을 값으로 쓰지 않는다). */
    @Test
    fun 저장된_조건이_없으면_비워_둔다() {
        val received = alarmWith(bucketId = "weather", clipKeys = emptyList(), ttsMessageId = "old-0")
        assertNull(
            StockClipLanguageRebinder.withRecipientConditions(
                received, "weather", com.alarmtalk.app.data.DynamicPromptPreferences(),
            ).voiceWeatherCity,
        )
        assertNull(
            StockClipLanguageRebinder.withRecipientConditions(received, "weather", null).voiceWeatherCity,
        )
    }

    /** 판단할 근거가 없으면(메시지 id 조차 없음) 건드리지 않는다. */
    @Test
    fun 클립_목록도_메시지_id_도_없으면_건드리지_않는다() {
        assertFalse(
            StockClipLanguageRebinder.needsRebind(
                alarmWith(
                    bucketId = "medication", clipKeys = emptyList(), ttsMessageId = "", language = null,
                ),
                "ko", live,
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
        language: String? = "ko",
        clipKeys: List<String> = listOf("stock_old-0", "stock_old-1"),
        ttsMessageId: String = "clip-0",
        playMode: String = AlarmPlayModes.VOICE_ONLY,
        voiceSource: String = VoiceSources.TTS_PROFILE,
        bucketId: String? = "weather",
        randomPrompt: Boolean = false,
        randomContext: String? = "wake_weather",
        origin: String = AlarmOrigins.LOCAL_OWNED,
        remoteAlarmId: String? = null,
        syncState: String = AlarmSyncStates.LOCAL_ONLY,
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
        voiceRandomPrompt = randomPrompt,
        voiceRandomContext = randomContext,
        voiceWeatherCountry = null,
        voiceWeatherCity = null,
        voiceFortuneGender = null,
        voiceFortuneBirthDate = null,
        voiceFortuneBirthTime = null,
        dynamicVoicePreparedForFireAtMillis = null,
        voiceRepeat = true,
        voiceVolumePercent = 100,
        ttsMessageId = ttsMessageId,
        bucketId = bucketId,
        bucketClipKeysJson = encodeBucketClipKeys(clipKeys),
        remoteAlarmId = remoteAlarmId,
        lastSyncedAtMillis = null,
        syncState = syncState,
        origin = origin,
        alarmVolumePercent = 100,
        alarmSoundUri = null,
        alarmSoundLabel = null,
        enabled = true,
        state = AlarmStates.SCHEDULED,
        createdAtMillis = 0L,
        updatedAtMillis = 0L,
    )
}
