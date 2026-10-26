package com.alarmtalk.app.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.test.core.app.ApplicationProvider
import com.alarmtalk.app.R
import java.lang.reflect.Modifier
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * **Room 27→28 — 받은 알람을 내 알람으로 바꾸고 `alarms` 를 새로 만든다**(`ReceivedAlarmConversionMigration`).
 *
 * 이 마이그레이션이 틀리면 업데이트한 모든 사용자의 앱이 켜자마자 죽는다(파괴적 폴백이 없다 —
 * `AlarmDatabaseMigrationSafetyTest`). 그래서 v27 파일 DB 를 **Room 이 만들던 CREATE 문 그대로** 세우고,
 * 실제 등록(`AlarmDatabase.build`)으로 열어 Room 의 스키마 검증까지 통과하는지 본다.
 *
 * 고정하는 것:
 *  - 내 알람은 **모든 칸이 그대로**다(전달 세대 두 칸만 사라진다).
 *  - 받은 알람은 시각·요일·스누즈·진동·알람음·음량·소유자를 지키고, 보낸 사람 흔적(원격 연결·라벨·오디오·문구·
 *    테마·클립·잠금 표시)을 비운 **미나의 내 알람**이 된다. 재생 방식은 잠금 표시가 있으면 그 원래 값이다.
 *  - 바꾼 알람은 계정별로 2단계 기록(`FormerReceivedAlarmStore`)에 남는다. 소유자가 없는 행은 바꾸되 기록하지 않는다.
 *  - 열을 **이름으로** 옮긴다 — `ALTER TABLE` 이력으로 열 순서가 다른 기기도 값이 섞이지 않는다.
 *
 * 규칙: `docs/spec/billing-lifecycle.md` 「목소리를 못 쓰게 되면」, `docs/spec/plan-gates.md` 「커플·가족 이용권 — 폐지」.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ReceivedAlarmConversionMigrationTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val dbName = "received-conversion-27-28.db"
    private val owner = "user-1"
    private val otherOwner = "user-2"

    @Before
    fun setUp() {
        context.deleteDatabase(dbName)
        FormerReceivedAlarmStore(context).apply {
            clear(owner)
            clear(otherOwner)
        }
    }

    @After
    fun tearDown() {
        context.deleteDatabase(dbName)
    }

    @Test
    fun `27에서 28로 올리면 내 알람은 그대로이고 받은 알람은 미나의 내 알람이 된다`() = runBlocking {
        val own = ownAlarm()
        val receivedVoice = receivedAlarm("recv-voice", playMode = AlarmPlayModes.VOICE_ONLY)
        // 옛 버그의 잠금 표시 — '알람' 모드로 내려가 있지만 원래는 목소리 알람이다.
        val receivedLocked = receivedAlarm(
            "recv-locked",
            playMode = AlarmPlayModes.ALARM_ONLY,
            preLockPlayMode = AlarmPlayModes.VOICE_ONLY,
        )
        // 받은 사람이 '알람' 모드로 둔 행 — 그 선택을 지킨다.
        val receivedAlarmOnly = receivedAlarm("recv-alarm-only", playMode = AlarmPlayModes.ALARM_ONLY, preLockPlayMode = null)
        // 옛 재생 방식 값은 목소리로 읽는다(`AlarmPlayModes.normalize`).
        val receivedLegacyMode = receivedAlarm(
            "recv-legacy-mode",
            playMode = AlarmPlayModes.LEGACY_ALARM_VOICE,
            preLockPlayMode = null,
            ownerUserId = otherOwner,
        )
        val receivedOwnerless = receivedAlarm("recv-ownerless", playMode = AlarmPlayModes.VOICE_ONLY, ownerUserId = null)
        val received = listOf(receivedVoice, receivedLocked, receivedAlarmOnly, receivedLegacyMode, receivedOwnerless)
        createV27Database(V27_ALARMS_CREATE, listOf(own) + received)

        val before = System.currentTimeMillis()
        val rows = openWithRealRegistration()
        val after = System.currentTimeMillis()

        assertEquals("내 알람의 칸이 하나라도 바뀌었다", own, rows.getValue(own.id))

        val defaultLabel = context.getString(R.string.rd_default_alarm_label)
        val expectedModes = mapOf(
            receivedVoice.id to AlarmPlayModes.VOICE_ONLY,
            receivedLocked.id to AlarmPlayModes.VOICE_ONLY,
            receivedAlarmOnly.id to AlarmPlayModes.ALARM_ONLY,
            receivedLegacyMode.id to AlarmPlayModes.VOICE_ONLY,
            receivedOwnerless.id to AlarmPlayModes.VOICE_ONLY,
        )
        for (source in received) {
            val migrated = rows.getValue(source.id)
            assertTrue(
                "${source.id}: 바꾼 시각이 마이그레이션 시각이 아니다",
                migrated.updatedAtMillis in before..after,
            )
            assertEquals(
                source.id,
                source.convertedShape(defaultLabel, expectedModes.getValue(source.id))
                    .copy(updatedAtMillis = migrated.updatedAtMillis),
                migrated,
            )
            assertTrue("${source.id}: 1단계 모양이 아니다 — 2단계가 고친 행으로 읽는다", migrated.keepsReceivedConversionShape())
        }

        val store = FormerReceivedAlarmStore(context)
        // 소유자가 안 적힌 옛 행은 주인 없음 칸에 적혀 로그인한 어느 계정이든 2단계에서 본다(Codex #931).
        assertEquals(
            setOf(receivedVoice.id, receivedLocked.id, receivedAlarmOnly.id, receivedOwnerless.id),
            store.pending(owner),
        )
        assertEquals(setOf(receivedLegacyMode.id, receivedOwnerless.id), store.pending(otherOwner))
    }

    @Test
    fun `열 순서가 다른 기기에서도 이름으로 옮긴다`() = runBlocking {
        // 오래된 기기는 `ALTER TABLE ADD COLUMN` 을 거쳐 왔다 — 열 순서가 새로 설치한 기기와 다르다.
        // Room 검증은 순서를 보지 않으므로 그런 v27 은 정상이다. `SELECT *` 로 옮기면 값이 엉뚱한 칸에 들어간다.
        val own = ownAlarm()
        createV27Database(reversedColumns(V27_ALARMS_CREATE), listOf(own))

        val rows = openWithRealRegistration()

        assertEquals(own, rows.getValue(own.id))
        // 받은 알람이 없으면 기록할 것도 없다.
        assertTrue(FormerReceivedAlarmStore(context).pending(owner).isEmpty())
    }

    @Test
    fun `2단계 기록은 계정별이고 끝낸 것만 지우며 로그아웃하면 그 계정 것이 떠난다`() {
        val store = FormerReceivedAlarmStore(context)
        store.recordConverted(mapOf(owner to setOf("a", "b", "c"), otherOwner to setOf("x")))
        // 마이그레이션이 다시 돌아도(검증 실패 뒤 재시도) 합칠 뿐이다.
        store.recordConverted(mapOf(owner to setOf("c", "d")))
        assertEquals(setOf("a", "b", "c", "d"), store.pending(owner))

        store.settle(owner, listOf("a", "c"))
        assertEquals(setOf("b", "d"), store.pending(owner))
        assertEquals(setOf("x"), store.pending(otherOwner))

        store.settle(owner, listOf("b", "d"))
        assertTrue(store.pending(owner).isEmpty())

        store.clear(otherOwner)
        assertTrue(store.pending(otherOwner).isEmpty())
        // 계정이 없으면 아무것도 읽지 않는다.
        assertTrue(store.pending(null).isEmpty())
        assertTrue(store.pending(" ").isEmpty())
    }

    @Test
    fun `소유자 없는 옛 행은 주인 없음 칸에 적혀 로그인한 계정이 보고 끝내거나 떠나면 지워진다`() {
        val store = FormerReceivedAlarmStore(context)
        store.recordConverted(mapOf(null to setOf("u1", "u2"), owner to setOf("a")))
        assertEquals(setOf("a", "u1", "u2"), store.pending(owner))
        assertEquals(setOf("u1", "u2"), store.pending(otherOwner))
        // 계정이 없으면 주인 없음 칸도 보지 않는다 — 2단계는 로그인한 계정의 재료로만 돈다.
        assertTrue(store.pending(null).isEmpty())

        // 끝낸 것은 어느 칸에 있든 지운다.
        store.settle(owner, listOf("u1", "a"))
        assertEquals(setOf("u2"), store.pending(owner))
        assertEquals(setOf("u2"), store.pending(otherOwner))

        // 계정을 떠나면 소유자 없는 행은 그 계정 것으로 새겨지므로(`claimUnownedAlarmsFor`) 주인 없음 칸도 떠난다.
        store.clear(owner)
        assertTrue(store.pending(owner).isEmpty())
        assertTrue(store.pending(otherOwner).isEmpty())
    }

    // ── 도우미 ────────────────────────────────────────────────────────────

    private fun openWithRealRegistration(): Map<String, AlarmEntity> {
        val database = AlarmDatabase.build(context, dbName)
        return try {
            runBlocking { database.alarmDao().getAllAlarms() }.associateBy { it.id }
        } finally {
            database.close()
        }
    }

    /** v27 파일 DB — 세 표와 Room 의 신원 표, `user_version = 27`. */
    private fun createV27Database(alarmsCreate: String, rows: List<AlarmEntity>) {
        val file = context.getDatabasePath(dbName)
        file.parentFile?.mkdirs()
        SQLiteDatabase.openOrCreateDatabase(file, null).use { db ->
            db.execSQL(alarmsCreate)
            db.execSQL(V27_HOLIDAY_DATES_CREATE)
            db.execSQL(V27_USAGE_EVENTS_CREATE)
            db.execSQL("CREATE TABLE IF NOT EXISTS room_master_table (id INTEGER PRIMARY KEY,identity_hash TEXT)")
            db.execSQL("INSERT OR REPLACE INTO room_master_table (id,identity_hash) VALUES(42, '$V27_IDENTITY_HASH')")
            for (row in rows) {
                db.insertOrThrow("alarms", null, row.toV27Values())
            }
            db.version = 27
        }
    }

    /** 엔티티의 모든 칸 + v27 에만 있는 전달 세대 두 칸. 열 이름은 필드 이름이다(Room 기본값). */
    private fun AlarmEntity.toV27Values(): ContentValues = ContentValues().apply {
        for (field in AlarmEntity::class.java.declaredFields) {
            if (Modifier.isStatic(field.modifiers) || field.isSynthetic) continue
            // v27 뒤에 생긴 칸은 v27 표에 없다(28→29 의 날짜 지정 알람 두 칸).
            if (field.name in FieldsAddedAfterV27) continue
            field.isAccessible = true
            when (val value = field.get(this@toV27Values)) {
                null -> putNull(field.name)
                is String -> put(field.name, value)
                is Int -> put(field.name, value)
                is Long -> put(field.name, value)
                is Boolean -> put(field.name, if (value) 1 else 0)
                else -> error("모르는 칸 타입: ${field.name}=${value::class.java}")
            }
        }
        put("remoteDeliveryVersion", "delivery-1")
        put("observedDeliveryVersion", "delivery-1")
    }

    private val FieldsAddedAfterV27 = setOf("targetDate", "targetTimezone")

    /** [D2 설계] 1단계의 모양 — 남기는 값은 [this] 그대로, 지우는 값은 비우고 목소리는 미나다. */
    private fun AlarmEntity.convertedShape(defaultLabel: String, playMode: String): AlarmEntity = copy(
        label = defaultLabel,
        playMode = playMode,
        preLockPlayMode = null,
        preLockVoiceJson = null,
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
        ttsMessageId = null,
        bucketId = null,
        bucketRotationIndex = 0,
        bucketClipKeysJson = null,
        bucketClipTextsJson = null,
        contextVariantIndex = null,
        contextResolvedAtMillis = null,
        remoteAlarmId = null,
        lastSyncedAtMillis = null,
        syncState = AlarmSyncStates.LOCAL_ONLY,
        origin = AlarmOrigins.LOCAL_OWNED,
    )

    /** 칸을 **전부** 채운 내 알람 — 하나라도 비우면 '그대로 옮겨졌는가' 를 그 칸에서 못 본다. */
    private fun ownAlarm() = AlarmEntity(
        id = "own-1",
        label = "출근",
        hour = 6,
        minute = 45,
        fireAtMillis = 1_700_000_000_000L,
        repeatDaysMask = 0b0111110,
        holidayOff = true,
        snoozeEnabled = true,
        snoozeMinutes = 7,
        snoozeRepeatLimit = SnoozeRepeatLimits.FIVE,
        snoozeCount = 1,
        vibrationPattern = "heartbeat",
        playMode = AlarmPlayModes.VOICE_ONLY,
        defaultAlarmSoundId = DefaultAlarmSounds.BUNDLED_DEFAULT,
        localAudioUri = "file:///audio/stock_clone-weather-0.mp3",
        audioCacheKey = "stock_clone-weather-0",
        rawAudioUri = "https://cdn.example.test/clone-weather-0.mp3",
        voiceSource = VoiceSources.TTS_PROFILE,
        voiceProfileId = "clone-1",
        voiceListenerTitle = "우리 딸",
        voiceText = "비가 와요",
        voiceCategory = "custom",
        voiceLanguage = "ko",
        voiceRandomPrompt = false,
        voiceRandomContext = "wake_weather",
        voiceWeatherCountry = "KR",
        voiceWeatherCity = "서울",
        voiceFortuneGender = "female",
        voiceFortuneBirthDate = "1995-05-19",
        voiceFortuneBirthTime = "07:30",
        dynamicVoicePreparedForFireAtMillis = 1_699_999_000_000L,
        voiceRepeat = true,
        voiceVolumePercent = 80,
        ttsMessageId = "clone-weather-0",
        bucketId = "weather",
        bucketRotationIndex = 2,
        bucketClipKeysJson = "[\"stock_clone-weather-0\",\"stock_clone-weather-1\"]",
        bucketClipTextsJson = "[\"비가 와요\",\"맑아요\"]",
        contextVariantIndex = 1,
        contextResolvedAtMillis = 1_699_998_000_000L,
        remoteAlarmId = "server-own-1",
        lastSyncedAtMillis = 1_699_997_000_000L,
        syncState = AlarmSyncStates.SYNCED,
        origin = AlarmOrigins.LOCAL_OWNED,
        alarmVolumePercent = 60,
        alarmSoundUri = "content://media/internal/audio/media/12",
        alarmSoundLabel = "Morning",
        alarmSoundEnabled = false,
        enabled = true,
        state = AlarmStates.SCHEDULED,
        createdAtMillis = 1_690_000_000_000L,
        updatedAtMillis = 1_699_990_000_000L,
        preLockPlayMode = AlarmPlayModes.VOICE_ONLY,
        preLockVoiceJson = "{\"voiceProfileId\":\"clone-1\"}",
        ownerUserId = owner,
    )

    /** 칸을 전부 채운 받은 알람(보낸 사람의 목소리·문구·테마·클립·원격 연결까지). */
    private fun receivedAlarm(
        id: String,
        playMode: String,
        preLockPlayMode: String? = AlarmPlayModes.VOICE_ONLY,
        ownerUserId: String? = owner,
    ) = ownAlarm().copy(
        id = id,
        label = "민수님이 보낸 알람",
        hour = 7,
        minute = 10,
        repeatDaysMask = 0b1000001,
        snoozeEnabled = false,
        snoozeMinutes = 3,
        vibrationPattern = "default",
        playMode = playMode,
        localAudioUri = "file:///audio/remote-message-msg-$id.m4a",
        audioCacheKey = "remote-message-msg-$id",
        rawAudioUri = "https://cdn.example.test/voices/sender/msg-$id.m4a",
        voiceSource = VoiceSources.SERVER_TTS,
        voiceProfileId = "sender-clone",
        voiceListenerTitle = "자기",
        voiceText = "일어나요",
        voiceCategory = "family",
        voiceLanguage = "ja",
        voiceRandomPrompt = true,
        ttsMessageId = "msg-$id",
        bucketId = "cheer",
        remoteAlarmId = "server-$id",
        syncState = AlarmSyncStates.SYNCED,
        // 마이그레이션 SQL 이 보는 옛 값 — 상수는 지웠다.
        origin = "received_remote",
        alarmVolumePercent = 40,
        alarmSoundEnabled = true,
        voiceVolumePercent = 55,
        preLockPlayMode = preLockPlayMode,
        ownerUserId = ownerUserId,
    )

    /** 같은 열 정의를 거꾸로 늘어놓은 CREATE 문(PRIMARY KEY 절은 끝에 둔다). */
    private fun reversedColumns(create: String): String {
        val open = create.indexOf('(')
        val primaryKey = create.lastIndexOf(", PRIMARY KEY")
        val columns = create.substring(open + 1, primaryKey).split(", `").map { if (it.startsWith("`")) it else "`$it" }
        return create.substring(0, open + 1) + columns.reversed().joinToString(", ") + create.substring(primaryKey)
    }

    private companion object {
        /** Room 이 엔티티 수정 전(v27)에 만들던 그대로(`AlarmDatabase_Impl.createAllTables`). 인덱스는 없다. */
        const val V27_ALARMS_CREATE =
            "CREATE TABLE IF NOT EXISTS `alarms` (`id` TEXT NOT NULL, `label` TEXT NOT NULL, `hour` INTEGER NOT NULL, " +
                "`minute` INTEGER NOT NULL, `fireAtMillis` INTEGER NOT NULL, `repeatDaysMask` INTEGER NOT NULL, " +
                "`holidayOff` INTEGER NOT NULL, `snoozeEnabled` INTEGER NOT NULL, `snoozeMinutes` INTEGER NOT NULL, " +
                "`snoozeRepeatLimit` INTEGER NOT NULL, `snoozeCount` INTEGER NOT NULL, `vibrationPattern` TEXT NOT NULL, " +
                "`playMode` TEXT NOT NULL, `defaultAlarmSoundId` TEXT NOT NULL, `localAudioUri` TEXT, `audioCacheKey` TEXT, " +
                "`rawAudioUri` TEXT, `voiceSource` TEXT NOT NULL, `voiceProfileId` TEXT, `voiceListenerTitle` TEXT, " +
                "`voiceText` TEXT, `voiceCategory` TEXT, `voiceLanguage` TEXT, `voiceRandomPrompt` INTEGER NOT NULL, " +
                "`voiceRandomContext` TEXT, `voiceWeatherCountry` TEXT, `voiceWeatherCity` TEXT, `voiceFortuneGender` TEXT, " +
                "`voiceFortuneBirthDate` TEXT, `voiceFortuneBirthTime` TEXT, `dynamicVoicePreparedForFireAtMillis` INTEGER, " +
                "`voiceRepeat` INTEGER NOT NULL, `voiceVolumePercent` INTEGER NOT NULL, `ttsMessageId` TEXT, `bucketId` TEXT, " +
                "`bucketRotationIndex` INTEGER NOT NULL, `bucketClipKeysJson` TEXT, `bucketClipTextsJson` TEXT, " +
                "`contextVariantIndex` INTEGER, `contextResolvedAtMillis` INTEGER, `remoteAlarmId` TEXT, " +
                "`lastSyncedAtMillis` INTEGER, `syncState` TEXT NOT NULL, `origin` TEXT NOT NULL, " +
                "`alarmVolumePercent` INTEGER NOT NULL, `alarmSoundUri` TEXT, `alarmSoundLabel` TEXT, " +
                "`alarmSoundEnabled` INTEGER NOT NULL, `enabled` INTEGER NOT NULL, `state` TEXT NOT NULL, " +
                "`createdAtMillis` INTEGER NOT NULL, `updatedAtMillis` INTEGER NOT NULL, `preLockPlayMode` TEXT, " +
                "`preLockVoiceJson` TEXT, `ownerUserId` TEXT, `remoteDeliveryVersion` TEXT, " +
                "`observedDeliveryVersion` TEXT, PRIMARY KEY(`id`))"

        const val V27_HOLIDAY_DATES_CREATE =
            "CREATE TABLE IF NOT EXISTS `holiday_dates` (`countryCode` TEXT NOT NULL, `regionCode` TEXT NOT NULL, " +
                "`epochDay` INTEGER NOT NULL, `localDate` TEXT NOT NULL, `name` TEXT NOT NULL, `source` TEXT NOT NULL, " +
                "`updatedAtMillis` INTEGER NOT NULL, PRIMARY KEY(`countryCode`, `regionCode`, `epochDay`))"

        const val V27_USAGE_EVENTS_CREATE =
            "CREATE TABLE IF NOT EXISTS `usage_events` (`id` TEXT NOT NULL, `type` TEXT NOT NULL, " +
                "`occurredAtMillis` INTEGER NOT NULL, `alarmId` TEXT, `voiceProfileId` TEXT, `messageId` TEXT, " +
                "`detail` TEXT, `userId` TEXT, PRIMARY KEY(`id`))"

        const val V27_IDENTITY_HASH = "4a530b775c10581d206bf02349065ea8"
    }
}
