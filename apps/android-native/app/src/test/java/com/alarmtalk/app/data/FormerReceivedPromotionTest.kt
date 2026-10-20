package com.alarmtalk.app.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.alarmtalk.app.alarm.AlarmScheduler
import com.alarmtalk.app.network.ExpectedVariantCounts
import com.alarmtalk.app.network.StockClip
import com.alarmtalk.app.network.VoiceProfile
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * **받았던 알람을 내 목소리로 올리는 2단계**의 판정(`decideFormerReceivedPromotion`)과 재료.
 *
 * 1단계(Room 27→28)가 받은 알람을 미나의 내 알람으로 바꿨다. 2단계는 그 계정이 **지금 쓸 수 있는 자기 클론**과
 * 그 클론의 기본 인사말 클립을 **기기에 다 갖고 있을 때만** 그 클론 + 기본 인사말로 바꾼다. 하나라도 모자라면 미나로
 * 둔다 — 조용히 울리는 알람을 만들지 않는다.
 *
 * 쓰기는 저장소가 락 안에서 행을 다시 읽어 판정한 뒤에만 한다 — 그 사이 계정이 바뀌었거나 남의 행이면 쓰지 않는다.
 *
 * 규칙: `docs/spec/billing-lifecycle.md` 「목소리를 못 쓰게 되면」, `docs/spec/plan-gates.md` 「커플·가족 이용권 — 폐지」.
 * 클립 목록을 JSON 으로 적는 부분(`encodeBucketClipKeys` — `org.json`)과 Room 이 있어 Robolectric 으로 돈다.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class FormerReceivedPromotionTest {

    // ── 판정 ─────────────────────────────────────────────────────────────

    @Test
    fun `클론과 인사말이 다 있으면 올린다`() {
        val clone = clone("clone-a")
        val greeting = greeting("clone-a")
        assertEquals(
            FormerReceivedPromotion.Promote(greeting),
            decideFormerReceivedPromotion(converted(), clone, cloneSettling = false, cloneEntitled = true, greeting = greeting),
        )
    }

    @Test
    fun `인사말 클립이 덜 받아졌으면 미나로 두고 다시 본다`() {
        val clone = clone("clone-a")
        assertEquals(
            FormerReceivedPromotion.Retry,
            decideFormerReceivedPromotion(converted(), clone, cloneSettling = false, cloneEntitled = true, greeting = null),
        )
        // 다른 목소리의 인사말로는 묶지 않는다.
        assertEquals(
            FormerReceivedPromotion.Retry,
            decideFormerReceivedPromotion(
                converted(), clone, cloneSettling = false, cloneEntitled = true, greeting = greeting("clone-b"),
            ),
        )
    }

    @Test
    fun `이용권 판정 전이거나 클론이 정리 중이면 다시 본다`() {
        val clone = clone("clone-a")
        val greeting = greeting("clone-a")
        assertEquals(
            FormerReceivedPromotion.Retry,
            decideFormerReceivedPromotion(converted(), clone, cloneSettling = false, cloneEntitled = null, greeting = greeting),
        )
        assertEquals(
            FormerReceivedPromotion.Retry,
            decideFormerReceivedPromotion(converted(), clone, cloneSettling = true, cloneEntitled = true, greeting = greeting),
        )
    }

    @Test
    fun `쓸 수 있는 클론이 없으면 미나로 확정한다`() {
        // 클론이 없으면 이용권 판정을 기다릴 것도 없다.
        listOf(true, false, null).forEach { entitled ->
            assertEquals(
                "entitled=$entitled",
                FormerReceivedPromotion.KeepDefaultVoice,
                decideFormerReceivedPromotion(converted(), null, cloneSettling = false, cloneEntitled = entitled, greeting = null),
            )
        }
        // 확실히 무료면 클론이 있어도 못 쓴다.
        assertEquals(
            FormerReceivedPromotion.KeepDefaultVoice,
            decideFormerReceivedPromotion(
                converted(), clone("clone-a"), cloneSettling = false, cloneEntitled = false, greeting = greeting("clone-a"),
            ),
        )
    }

    @Test
    fun `알람 모드는 목소리를 쓰지 않으니 미나로 확정한다`() {
        assertEquals(
            FormerReceivedPromotion.KeepDefaultVoice,
            decideFormerReceivedPromotion(
                converted().copy(playMode = AlarmPlayModes.ALARM_ONLY),
                clone("clone-a"),
                cloneSettling = false,
                cloneEntitled = true,
                greeting = greeting("clone-a"),
            ),
        )
    }

    @Test
    fun `사용자가 고쳤거나 지운 알람은 손대지 않는다`() {
        val clone = clone("clone-a")
        val greeting = greeting("clone-a")
        val edited = listOf(
            null,
            converted().copy(voiceRandomContext = "cheer"),
            converted().copy(voiceRandomPrompt = true),
            converted().copy(voiceText = "직접 친 문구"),
            converted().copy(bucketId = "weather"),
            converted().copy(voiceProfileId = SYSTEM_VOICE_ID_PREFIX + "000000000101"),
            converted().copy(voiceSource = VoiceSources.LOCAL_AUDIO, localAudioUri = "file:///rec.m4a"),
            // 이미 올린 행은 1단계 모양이 아니다 — 두 번 올리지 않는다.
            converted().promotedToCloneGreeting(greeting, nowMillis = 2L),
        )
        for (alarm in edited) {
            assertEquals(
                alarm.toString(),
                FormerReceivedPromotion.UserChanged,
                decideFormerReceivedPromotion(alarm, clone, cloneSettling = false, cloneEntitled = true, greeting = greeting),
            )
        }
        // 켜고 끄기·시각만 바꾼 것은 고친 것이 아니다 — 목소리는 그대로 미나다.
        assertEquals(
            FormerReceivedPromotion.Promote(greeting),
            decideFormerReceivedPromotion(
                converted().copy(enabled = false, hour = 9, minute = 30),
                clone,
                cloneSettling = false,
                cloneEntitled = true,
                greeting = greeting,
            ),
        )
    }

    // ── 어느 클론으로 올리나 ──────────────────────────────────────────────

    @Test
    fun `마지막에 쓴 목소리가 클론이면 그것이다`() {
        val profiles = listOf(clone("new", "2026-10-10 09:00:00"), clone("old", "2026-01-01 09:00:00"))
        assertEquals("old", pickPromotionClone(profiles, lastUsedVoiceId = "old")?.id)
    }

    @Test
    fun `아니면 가장 최근에 만든 준비된 클론이다`() {
        val profiles = listOf(
            clone("older", "2026-03-01 09:00:00"),
            clone("newest", "2026-10-01 09:00:00"),
            clone("middle", "2026-05-01T09:00:00Z"),
        )
        // 마지막에 쓴 목소리가 기본 목소리면 클론 고르기에는 상관없다.
        assertEquals("newest", pickPromotionClone(profiles, lastUsedVoiceId = SUBSTITUTE_SYSTEM_VOICE_ID)?.id)
        assertEquals("newest", pickPromotionClone(profiles, lastUsedVoiceId = null)?.id)
    }

    @Test
    fun `만든 시각을 못 읽으면 서버 목록 순서(최신순)의 앞을 쓴다`() {
        val profiles = listOf(clone("first", null), clone("second", "not-a-date"))
        assertEquals("first", pickPromotionClone(profiles, lastUsedVoiceId = null)?.id)
    }

    @Test
    fun `기본 목소리·초안·준비 안 된 목소리는 고르지 않는다`() {
        val profiles = listOf(
            VoiceProfile(id = SUBSTITUTE_SYSTEM_VOICE_ID, name = "미나", status = "ready", isSystem = true),
            clone("draft").copy(isDraft = true),
            clone("processing").copy(status = "processing"),
            clone("deleting").copy(status = "deleting"),
            clone("failed").copy(status = "failed"),
        )
        assertNull(pickPromotionClone(profiles, lastUsedVoiceId = "draft"))
        assertEquals("ready", pickPromotionClone(profiles + clone("ready"), lastUsedVoiceId = null)?.id)
    }

    // ── 기본 인사말 한 벌 ───────────────────────────────────────────────────

    private val expected = ExpectedVariantCounts(clone = mapOf(STOCK_GREETING_CATEGORY to 3))

    @Test
    fun `인사말 세트가 완전하고 전부 기기에 있을 때만 한 벌이다`() {
        val clips = greetingClips("clone-a", "ko", 3)
        val greeting = completeGreetingFor("clone-a", clips, expected, appVoiceLanguage = "ko", cached = ::cachedAll)
        assertEquals(listOf("g-ko-0", "g-ko-1", "g-ko-2"), greeting?.clips?.map { it.messageId })
        assertEquals("ko", greeting?.language)

        // 하나라도 기기에 없으면 묶지 않는다.
        assertNull(
            completeGreetingFor("clone-a", clips, expected, "ko") { key, url ->
                if (key.endsWith("g-ko-1")) null else cachedAll(key, url)
            },
        )
        // 서버가 다 만들지 않았으면(가운데 빠짐) 묶지 않는다.
        assertNull(completeGreetingFor("clone-a", clips.filterNot { it.variant == 1 }, expected, "ko", ::cachedAll))
        // 개수를 모르면 완전한지 단정할 수 없다 — 편집기 관문과 같다.
        assertNull(completeGreetingFor("clone-a", clips, null, "ko", ::cachedAll))
        // 다른 목소리의 클립은 세지 않는다.
        assertNull(completeGreetingFor("clone-b", clips, expected, "ko", ::cachedAll))
    }

    @Test
    fun `언어는 편집기와 같다 — 앱 언어 클립이 있으면 그 언어 아니면 클론의 언어`() {
        val both = greetingClips("clone-a", "ja", 3) + greetingClips("clone-a", "en", 3)
        assertEquals("en", completeGreetingFor("clone-a", both, expected, "en", ::cachedAll)?.language)
        val japaneseOnly = greetingClips("clone-a", "ja", 3)
        assertEquals("ja", completeGreetingFor("clone-a", japaneseOnly, expected, "ko", ::cachedAll)?.language)
    }

    // ── 올린 모양 ─────────────────────────────────────────────────────────

    @Test
    fun `올린 행은 편집기에서 그 클론과 기본 인사말을 골라 저장한 모양이다`() {
        val greeting = greeting("clone-a", language = "ja")
        val promoted = converted().promotedToCloneGreeting(greeting, nowMillis = 42L)

        assertEquals(VoiceSources.TTS_PROFILE, promoted.voiceSource)
        assertEquals("clone-a", promoted.voiceProfileId)
        assertEquals(STOCK_GREETING_CATEGORY, promoted.bucketId)
        assertEquals("preset", promoted.voiceRandomContext)
        assertFalse(promoted.voiceRandomPrompt)
        assertEquals("custom", promoted.voiceCategory)
        assertEquals("ja", promoted.voiceLanguage)
        assertEquals(greeting.clips.map { it.cacheKey }, decodeBucketClipKeys(promoted.bucketClipKeysJson))
        assertEquals(greeting.clips.map { it.text }, decodeBucketClipKeys(promoted.bucketClipTextsJson))
        assertEquals(greeting.clips.first().cacheKey, promoted.audioCacheKey)
        assertEquals(greeting.clips.first().localAudioUri, promoted.localAudioUri)
        assertEquals(greeting.clips.first().messageId, promoted.ttsMessageId)
        assertEquals(greeting.clips.first().text, promoted.voiceText)
        assertEquals(0, promoted.bucketRotationIndex)
        assertTrue(promoted.voiceRepeat)
        assertEquals(42L, promoted.updatedAtMillis)
        // 시각·요일·라벨·재생 방식은 그대로다.
        assertEquals(
            listOf(7, 0, 0b0111110, "알람", AlarmPlayModes.VOICE_ONLY),
            listOf(promoted.hour, promoted.minute, promoted.repeatDaysMask, promoted.label, promoted.playMode),
        )
        // 아직 서버에 없으면 새 알람으로, 이미 올라갔으면 바뀐 알람으로 올라간다.
        assertEquals(AlarmSyncStates.LOCAL_ONLY, promoted.syncState)
        assertEquals(
            AlarmSyncStates.DIRTY,
            converted().copy(remoteAlarmId = "server-1", syncState = AlarmSyncStates.SYNCED)
                .promotedToCloneGreeting(greeting, nowMillis = 42L).syncState,
        )
    }

    // ── 저장소 — 락 안에서 행을 다시 읽어 판정하고 쓴다(`AlarmRepository.settleFormerReceivedAlarm`) ──────────

    @Test
    fun `저장소는 판정대로 올리고 서버가 준 칸은 지킨다`() = withRepository(currentUser = "user-1") { repository, dao ->
        // 1단계 뒤 이미 서버에 올라간 행 — 올리면 바뀐 알람(DIRTY)으로 다시 올라가야 한다.
        val uploaded = converted().copy(remoteAlarmId = "server-1", lastSyncedAtMillis = 9L, syncState = AlarmSyncStates.SYNCED)
        dao.upsert(uploaded)
        val greeting = greeting("clone-a")

        val decision = repository.settleFormerReceivedAlarm(uploaded.id, "user-1") { row ->
            decideFormerReceivedPromotion(row, clone("clone-a"), cloneSettling = false, cloneEntitled = true, greeting = greeting)
        }

        assertEquals(FormerReceivedPromotion.Promote(greeting), decision)
        val stored = checkNotNull(dao.getById(uploaded.id))
        assertEquals("clone-a", stored.voiceProfileId)
        assertEquals(STOCK_GREETING_CATEGORY, stored.bucketId)
        assertEquals(greeting.clips.map { it.cacheKey }, decodeBucketClipKeys(stored.bucketClipKeysJson))
        assertEquals("server-1", stored.remoteAlarmId)
        assertEquals(9L, stored.lastSyncedAtMillis)
        assertEquals(AlarmSyncStates.DIRTY, stored.syncState)
    }

    @Test
    fun `저장소는 미나 확정과 다시 보기에 행을 바꾸지 않는다`() = withRepository(currentUser = "user-1") { repository, dao ->
        val row = converted()
        dao.upsert(row)
        for (answer in listOf(FormerReceivedPromotion.KeepDefaultVoice, FormerReceivedPromotion.Retry)) {
            assertEquals(answer, repository.settleFormerReceivedAlarm(row.id, "user-1") { answer })
            assertEquals(answer.toString(), row, dao.getById(row.id))
        }
    }

    @Test
    fun `다른 계정의 재료나 다른 계정의 행으로는 쓰지 않는다`() = withRepository(currentUser = "user-2") { repository, dao ->
        val row = converted()
        dao.upsert(row)
        var asked = false
        val promote: (AlarmEntity?) -> FormerReceivedPromotion = {
            asked = true
            FormerReceivedPromotion.Promote(greeting("clone-a"))
        }

        // 재료(목록·이용권)를 가져온 계정(user-1)과 지금 계정(user-2)이 다르다 — 판정도 하지 않고 다시 본다.
        assertEquals(FormerReceivedPromotion.Retry, repository.settleFormerReceivedAlarm(row.id, "user-1", promote))
        assertFalse("계정이 바뀌었는데 판정했다", asked)
        // 지금 계정의 재료인데 행의 임자가 다르다 — 남의 알람이다.
        assertEquals(FormerReceivedPromotion.UserChanged, repository.settleFormerReceivedAlarm(row.id, "user-2", promote))
        assertFalse("남의 알람을 판정했다", asked)
        assertEquals(row, dao.getById(row.id))
        // 지워진 행은 판정이 '고쳤다' 로 끝낸다.
        assertEquals(
            FormerReceivedPromotion.UserChanged,
            repository.settleFormerReceivedAlarm("gone", "user-2") { decideFormerReceivedPromotion(it, null, false, null, null) },
        )
    }

    @Test
    fun `소유자 없는 옛 행은 지금 계정 것으로 보고 올린다`() = withRepository(currentUser = "user-1") { repository, dao ->
        val row = converted().copy(ownerUserId = null)
        dao.upsert(row)

        val decision = repository.settleFormerReceivedAlarm(row.id, "user-1") { FormerReceivedPromotion.Promote(greeting("clone-a")) }

        assertTrue(decision is FormerReceivedPromotion.Promote)
        assertEquals("clone-a", dao.getById(row.id)?.voiceProfileId)
    }

    // ── 도우미 ────────────────────────────────────────────────────────────

    /** 메모리 Room 위의 실제 저장소. [currentUser] 가 지금 로그인한 계정이다. */
    private fun withRepository(
        currentUser: String?,
        block: suspend (AlarmRepository, AlarmDao) -> Unit,
    ) {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val db = Room.inMemoryDatabaseBuilder(context, AlarmDatabase::class.java).allowMainThreadQueries().build()
        try {
            val repository = AlarmRepository(
                alarmDao = db.alarmDao(),
                holidayCalendarStore = HolidayCalendarStore(db.holidayDao()),
                holidayCountryPreferenceStore = HolidayCountryPreferenceStore(context),
                alarmScheduler = AlarmScheduler(context),
                alarmAudioStore = AlarmAudioStore(context),
                context = context,
                currentUserIdProvider = { currentUser },
                pendingOwnerUserIdProvider = { null },
                onOwnershipSettled = {},
            )
            runBlocking { block(repository, db.alarmDao()) }
        } finally {
            db.close()
        }
    }

    /** 1단계가 만든 모양(`ReceivedAlarmConversionMigration`) — 미나의 오디오 없는 내 알람. */
    private fun converted() = AlarmEntity(
        id = "recv-1",
        label = "알람",
        hour = 7,
        minute = 0,
        fireAtMillis = 1_700_000_000_000L,
        repeatDaysMask = 0b0111110,
        holidayOff = false,
        snoozeEnabled = true,
        snoozeMinutes = 5,
        snoozeRepeatLimit = SnoozeRepeatLimits.THREE,
        snoozeCount = 0,
        vibrationPattern = "default",
        playMode = AlarmPlayModes.VOICE_ONLY,
        defaultAlarmSoundId = DefaultAlarmSounds.BUNDLED_DEFAULT,
        localAudioUri = null,
        audioCacheKey = null,
        rawAudioUri = null,
        voiceSource = VoiceSources.TTS_PROFILE,
        voiceProfileId = SUBSTITUTE_SYSTEM_VOICE_ID,
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
        alarmVolumePercent = 100,
        alarmSoundUri = null,
        alarmSoundLabel = null,
        enabled = true,
        state = AlarmStates.SCHEDULED,
        createdAtMillis = 1L,
        updatedAtMillis = 1L,
        ownerUserId = "user-1",
    )

    private fun clone(id: String, createdAt: String? = "2026-10-01 09:00:00") =
        VoiceProfile(id = id, name = id, status = "ready", createdAt = createdAt, isDraft = false, isSystem = false)

    private fun greetingClips(voiceId: String, language: String, count: Int): List<StockClip> =
        (0 until count).map { variant ->
            StockClip(
                messageId = "g-$language-$variant",
                voiceProfileId = voiceId,
                category = STOCK_GREETING_CATEGORY,
                language = language,
                variant = variant,
                text = "인사 $language $variant",
                audioUrl = "https://cdn.example.test/g-$language-$variant.mp3",
            )
        }

    private fun cachedAll(cacheKey: String, audioUrl: String?) = CachedAlarmAudio(
        localAudioUri = "file:///audio/$cacheKey.mp3",
        rawAudioUri = audioUrl,
        displayName = "$cacheKey.mp3",
        durationMillis = null,
        cacheKey = cacheKey,
    )

    private fun greeting(voiceId: String, language: String = "ko") = PromotionGreeting(
        voiceProfileId = voiceId,
        language = language,
        clips = (0 until 3).map { variant ->
            DefaultVoiceClip(
                messageId = "$voiceId-g-$variant",
                cacheKey = AlarmAudioStore.STOCK_CACHE_KEY_PREFIX + "$voiceId-g-$variant",
                text = "인사 $variant",
                localAudioUri = "file:///audio/$voiceId-g-$variant.mp3",
                rawAudioUri = "https://cdn.example.test/$voiceId-g-$variant.mp3",
            )
        },
    )
}
