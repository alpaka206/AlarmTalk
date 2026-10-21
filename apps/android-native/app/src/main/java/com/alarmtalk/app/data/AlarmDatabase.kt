package com.alarmtalk.app.data

import android.content.Context
import com.alarmtalk.app.R
import androidx.room.Database
import androidx.room.migration.Migration
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(
    entities = [AlarmEntity::class, HolidayEntity::class, UsageEventEntity::class],
    version = 28,
    exportSchema = false,
)
abstract class AlarmDatabase : RoomDatabase() {
    abstract fun alarmDao(): AlarmDao
    abstract fun holidayDao(): HolidayDao
    abstract fun usageEventDao(): UsageEventDao

    companion object {
        @Volatile
        private var instance: AlarmDatabase? = null

        fun getInstance(context: Context): AlarmDatabase =
            instance ?: synchronized(this) {
                instance ?: build(context.applicationContext, DATABASE_NAME).also { instance = it }
            }

        private const val DATABASE_NAME = "voice-alarm.db"

        /** 등록을 그대로 쓴 채 DB 를 연다 — 마이그레이션 테스트(`ReceivedAlarmConversionMigrationTest`)도 이걸 연다. */
        internal fun build(context: Context, name: String): AlarmDatabase =
            Room.databaseBuilder(
                context,
                AlarmDatabase::class.java,
                name,
            ).addMigrations(
                MIGRATION_1_2,
                MIGRATION_2_3,
                MIGRATION_3_4,
                MIGRATION_4_5,
                MIGRATION_5_6,
                MIGRATION_6_7,
                MIGRATION_7_8,
                MIGRATION_8_9,
                MIGRATION_9_10,
                MIGRATION_10_11,
                MIGRATION_11_12,
                MIGRATION_12_13,
                MIGRATION_13_14,
                MIGRATION_14_15,
                MIGRATION_15_16,
                MIGRATION_16_17,
                MIGRATION_17_18,
                MIGRATION_18_19,
                MIGRATION_19_20,
                MIGRATION_20_21,
                MIGRATION_21_22,
                MIGRATION_22_23,
                MIGRATION_23_24,
                MIGRATION_24_25,
                MIGRATION_25_26,
                MIGRATION_26_27,
                MIGRATION_27_28(context),
            )
                // ⚠ **`fallbackToDestructiveMigration()` 을 다시 넣지 말 것**(2026-08-18 제거).
                //
                // 붙어 있던 근거는 "개발 중이라 보존할 데이터 없음" 이었는데 **그건 이제
                // 사실이 아니다.** 앱은 스토어에 있고 베타 테스터의 알람이 들어 있다.
                // 그 플래그가 켜져 있으면 마이그레이션을 빠뜨린 채 `version` 만 올렸을 때
                // Room 이 **DB 를 통째로 지우고 다시 만든다** — 사용자는 알람이 전부
                // 사라진 것만 보고, 우리 쪽에는 예외도 로그도 남지 않는다.
                //
                // 지금은 없는 게 안전하다: 1→24 마이그레이션이 **빠짐없이** 위에 있고,
                // 앞으로 빠뜨리면 앱이 **켜자마자 죽는다.** 죽는 건 즉시 눈에 띄어 고칠 수
                // 있지만, 조용히 지워진 알람은 되돌릴 방법이 없다.
                // 스키마를 바꿀 때는 `version` 을 올리고 **반드시** 여기에 마이그레이션을
                // 등록할 것. 회귀 방지: `AlarmDatabaseMigrationSafetyTest`.
                .build()

        private val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE alarms ADD COLUMN hour INTEGER NOT NULL DEFAULT 7")
                db.execSQL("ALTER TABLE alarms ADD COLUMN minute INTEGER NOT NULL DEFAULT 0")
                db.execSQL("ALTER TABLE alarms ADD COLUMN repeatDaysMask INTEGER NOT NULL DEFAULT 0")
                db.execSQL("ALTER TABLE alarms ADD COLUMN vibrationPattern TEXT NOT NULL DEFAULT '${VibrationPatterns.DEFAULT}'")
                db.execSQL("ALTER TABLE alarms ADD COLUMN playMode TEXT NOT NULL DEFAULT '${AlarmPlayModes.ALARM_ONLY}'")
                db.execSQL("ALTER TABLE alarms ADD COLUMN defaultAlarmSoundId TEXT NOT NULL DEFAULT '${DefaultAlarmSounds.BUNDLED_DEFAULT}'")
                db.execSQL("ALTER TABLE alarms ADD COLUMN localAudioUri TEXT")
                db.execSQL("ALTER TABLE alarms ADD COLUMN rawAudioUri TEXT")
            }
        }

        private val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE alarms ADD COLUMN remoteAlarmId TEXT")
                db.execSQL("ALTER TABLE alarms ADD COLUMN lastSyncedAtMillis INTEGER")
                db.execSQL("ALTER TABLE alarms ADD COLUMN syncState TEXT NOT NULL DEFAULT '${AlarmSyncStates.LOCAL_ONLY}'")
            }
        }

        // 과거 버전에서 character_events 테이블을 만들던 마이그레이션. 캐릭터/성장 기능
        // 제거 후 이 테이블은 더 이상 스키마에 없으며, 잔존 테이블은 MIGRATION_14_15 에서 정리한다.
        private val MIGRATION_3_4 = object : Migration(3, 4) {
            override fun migrate(db: SupportSQLiteDatabase) {
                // no-op: character_events 테이블은 제거됨
            }
        }

        private val MIGRATION_4_5 = object : Migration(4, 5) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE alarms ADD COLUMN holidayOff INTEGER NOT NULL DEFAULT 0")
                db.execSQL("ALTER TABLE alarms ADD COLUMN snoozeEnabled INTEGER NOT NULL DEFAULT 1")
                db.execSQL("ALTER TABLE alarms ADD COLUMN voiceSource TEXT NOT NULL DEFAULT '${VoiceSources.LOCAL_AUDIO}'")
                db.execSQL("ALTER TABLE alarms ADD COLUMN voiceProfileId TEXT")
                db.execSQL("ALTER TABLE alarms ADD COLUMN voiceText TEXT")
                db.execSQL("ALTER TABLE alarms ADD COLUMN voiceCategory TEXT")
                db.execSQL("ALTER TABLE alarms ADD COLUMN voiceLanguage TEXT")
                db.execSQL("ALTER TABLE alarms ADD COLUMN ttsMessageId TEXT")
            }
        }

        private val MIGRATION_5_6 = object : Migration(5, 6) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE alarms ADD COLUMN audioCacheKey TEXT")
            }
        }

        private val MIGRATION_6_7 = object : Migration(6, 7) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE alarms ADD COLUMN snoozeRepeatLimit INTEGER NOT NULL DEFAULT ${SnoozeRepeatLimits.THREE}")
                db.execSQL("ALTER TABLE alarms ADD COLUMN snoozeCount INTEGER NOT NULL DEFAULT 0")
            }
        }

        private val MIGRATION_7_8 = object : Migration(7, 8) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE alarms ADD COLUMN origin TEXT NOT NULL DEFAULT '${AlarmOrigins.LOCAL_OWNED}'")
                db.execSQL("ALTER TABLE alarms ADD COLUMN alarmVolumePercent INTEGER NOT NULL DEFAULT 100")
                db.execSQL("ALTER TABLE alarms ADD COLUMN alarmSoundUri TEXT")
                db.execSQL("ALTER TABLE alarms ADD COLUMN alarmSoundLabel TEXT")
            }
        }

        private val MIGRATION_8_9 = object : Migration(8, 9) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS holiday_dates (
                        countryCode TEXT NOT NULL,
                        regionCode TEXT NOT NULL,
                        epochDay INTEGER NOT NULL,
                        localDate TEXT NOT NULL,
                        name TEXT NOT NULL,
                        source TEXT NOT NULL,
                        updatedAtMillis INTEGER NOT NULL,
                        PRIMARY KEY(countryCode, regionCode, epochDay)
                    )
                    """.trimIndent(),
                )
            }
        }

        private val MIGRATION_9_10 = object : Migration(9, 10) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE alarms ADD COLUMN voiceRandomPrompt INTEGER NOT NULL DEFAULT 0")
                db.execSQL("ALTER TABLE alarms ADD COLUMN voiceRepeat INTEGER NOT NULL DEFAULT 1")
            }
        }

        private val MIGRATION_10_11 = object : Migration(10, 11) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE alarms ADD COLUMN voiceRandomContext TEXT")
            }
        }

        private val MIGRATION_11_12 = object : Migration(11, 12) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE alarms ADD COLUMN voiceFortuneGender TEXT")
                db.execSQL("ALTER TABLE alarms ADD COLUMN voiceFortuneBirthDate TEXT")
                db.execSQL("ALTER TABLE alarms ADD COLUMN voiceFortuneBirthTime TEXT")
                db.execSQL("ALTER TABLE alarms ADD COLUMN dynamicVoicePreparedForFireAtMillis INTEGER")
            }
        }

        private val MIGRATION_12_13 = object : Migration(12, 13) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE alarms ADD COLUMN voiceWeatherCountry TEXT")
                db.execSQL("ALTER TABLE alarms ADD COLUMN voiceWeatherCity TEXT")
            }
        }

        private val MIGRATION_13_14 = object : Migration(13, 14) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE alarms ADD COLUMN voiceVolumePercent INTEGER NOT NULL DEFAULT 100")
            }
        }

        // 캐릭터/성장 기능 제거 — 잔존하는 character_events 테이블을 정리한다.
        private val MIGRATION_14_15 = object : Migration(14, 15) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("DROP TABLE IF EXISTS character_events")
            }
        }

        private val MIGRATION_15_16 = object : Migration(15, 16) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE alarms ADD COLUMN voiceListenerTitle TEXT")
            }
        }

        // 무료 버킷 회전: 알람이 가리키는 버킷과 매 울림 순차 회전 인덱스.
        private val MIGRATION_16_17 = object : Migration(16, 17) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE alarms ADD COLUMN bucketId TEXT")
                db.execSQL("ALTER TABLE alarms ADD COLUMN bucketRotationIndex INTEGER NOT NULL DEFAULT 0")
                db.execSQL("ALTER TABLE alarms ADD COLUMN bucketClipKeysJson TEXT")
            }
        }

        // 매칭형 버킷(날씨/운세)의 variant 인덱스 스냅샷(준비창에서 서버 resolve). nullable.
        private val MIGRATION_17_18 = object : Migration(17, 18) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE alarms ADD COLUMN contextVariantIndex INTEGER")
            }
        }

        // 날씨 variant 인덱스의 마지막 resolve 시각(준비창 12h 게이트 전용, 범용 updatedAtMillis 재사용 회귀 차단).
        private val MIGRATION_19_20 = object : Migration(19, 20) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE alarms ADD COLUMN contextResolvedAtMillis INTEGER")
            }
        }

        // 무료 전환 시 유료 목소리 알람을 삭제 대신 사운드온리로 '잠글' 때 원래 재생모드를 보관하고,
        // 알람을 만든 계정(ownerUserId)을 기록한다. 잠금/복원은 현재 세션이 소유자일 때만 수행해,
        // 다른 계정 로그인 시 남의 알람을 잠그거나 복원하지 않게 한다. null = 잠기지 않음/소유자 미기록.
        private val MIGRATION_20_21 = object : Migration(20, 21) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE alarms ADD COLUMN preLockPlayMode TEXT")
                db.execSQL("ALTER TABLE alarms ADD COLUMN ownerUserId TEXT")
            }
        }

        // 버킷 클립들의 표시 문구(variant 순). 잠금화면이 발사 variant 문구를 음성과 맞춰 보여주기 위함.
        private val MIGRATION_18_19 = object : Migration(18, 19) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE alarms ADD COLUMN bucketClipTextsJson TEXT")
            }
        }

        // 알람음(기상 톤) on/off 토글. 기본 1(켬) = 기존 동작 유지. off 면 톤만 재생 안 함.
        private val MIGRATION_21_22 = object : Migration(21, 22) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE alarms ADD COLUMN alarmSoundEnabled INTEGER NOT NULL DEFAULT 1")
            }
        }

        // 재생 방식 2개화(2026-08-06). 자세한 이유는 AlarmPlayModes 주석 참조.
        //
        //  1. 'alarm_voice' → 'voice_only'. 그 모드를 고른 사람은 목소리를 만들어 둔
        //     사용자이므로 목소리를 살린다(알람음으로 옮기면 애써 만든 목소리를 못 듣는다).
        //  2. '목소리만' 인데 alarmSoundEnabled=0 으로 굳은 행을 되살린다. 편집기가 그 조합을
        //     저장하고 있었는데, 그 알람이 유료 만료·목소리 삭제로 강등되면 톤 폴백까지 막혀
        //     **소리가 하나도 안 났다**. 알람음을 거부한 게 아니라 목소리를 고른 것이다.
        //  3. 음량 하한 10%. 0 은 '무음' 이라는 별개의 뜻이라 스위치로만 표현한다 —
        //     슬라이더 끝값으로 만들어진 0 은 알람이 조용히 안 울리는 사고가 된다.
        //     단 알람음 스위치를 끈 행(alarmSoundEnabled=0)의 0 은 의도된 무음이라 두지만,
        //     위 2번에서 되살아난 행은 함께 올린다.
        private val MIGRATION_22_23 = object : Migration(22, 23) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("UPDATE alarms SET playMode = 'voice_only' WHERE playMode = 'alarm_voice'")
                db.execSQL("UPDATE alarms SET preLockPlayMode = 'voice_only' WHERE preLockPlayMode = 'alarm_voice'")
                db.execSQL(
                    "UPDATE alarms SET alarmSoundEnabled = 1 " +
                        "WHERE alarmSoundEnabled = 0 AND " +
                        "(playMode = 'voice_only' OR preLockPlayMode = 'voice_only')",
                )
                db.execSQL("UPDATE alarms SET voiceVolumePercent = 10 WHERE voiceVolumePercent < 10")
                db.execSQL(
                    "UPDATE alarms SET alarmVolumePercent = 10 " +
                        "WHERE alarmVolumePercent < 10 AND alarmSoundEnabled = 1",
                )
            }
        }

        private val MIGRATION_23_24 = object : Migration(23, 24) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE alarms ADD COLUMN remoteDeliveryVersion TEXT")
            }
        }

        /**
         * 도착한 전달 세대를 따로 기록한다(`observedDeliveryVersion`).
         *
         * ⚠ **기존 행은 NULL 로 남긴다.** 그 행들은 이 값을 적기 전에 만들어졌으므로 '어느
         * 전달을 받았는지 모른다' 가 사실이고, 그때는 예전 규칙(32자리 backfill 예외)을 그대로
         * 적용한다. `remoteDeliveryVersion` 을 복사해 채우면 안 된다 — 그 값은 '반영까지
         * 끝냈다' 는 뜻이라, 비어 있는 행(=반영 실패)이 그대로 NULL 이 되어 아무것도 달라지지
         * 않고, 채워진 행은 재전송을 '같은 세대' 로 오인해 계속 덮지 못한다.
         */
        private val MIGRATION_24_25 = object : Migration(24, 25) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE alarms ADD COLUMN observedDeliveryVersion TEXT")
            }
        }

        /**
         * 사용 기록 큐(`usage_events`) — 오프라인에서 쌓았다가 연결되면 보낸다.
         *
         * ⚠ Room 엔티티와 **컬럼 이름·타입이 정확히 같아야 한다**(`UsageEventEntity`).
         * 어긋나면 앱이 켜자마자 `IllegalStateException` 으로 죽는다 — 조용히 지워지는
         * 것보다 낫다는 게 이 저장소의 규약이다(위 `fallbackToDestructiveMigration` 주석).
         */
        private val MIGRATION_25_26 = object : Migration(25, 26) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS usage_events (" +
                        "id TEXT NOT NULL PRIMARY KEY, " +
                        "type TEXT NOT NULL, " +
                        "occurredAtMillis INTEGER NOT NULL, " +
                        "alarmId TEXT, " +
                        "voiceProfileId TEXT, " +
                        "messageId TEXT, " +
                        "detail TEXT, " +
                        "userId TEXT)",
                )
            }
        }

        /**
         * 무료 잠금 보관본(`AlarmEntity.preLockVoiceJson`) — 잠금이 행을 기본 목소리 알람으로
         * 고쳐 쓸 때 원래 유료 목소리 필드를 담아 둔다(2026-09-29,
         * `docs/spec/billing-lifecycle.md` 「목소리를 못 쓰게 되면」). 옛 행은 NULL = 보관본 없음.
         */
        private val MIGRATION_26_27 = object : Migration(26, 27) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE alarms ADD COLUMN preLockVoiceJson TEXT")
            }
        }

        /**
         * 커플·가족 이용권 폐지(2026-10-20) — [ReceivedAlarmConversionMigration]. 기본 라벨과 승격 기록에 기기
         * 문맥이 있어야 해서 함수다. 이름은 등록 검사(`AlarmDatabaseMigrationSafetyTest`)가 찾는 그대로 둔다.
         */
        @Suppress("FunctionName")
        internal fun MIGRATION_27_28(context: Context): Migration = ReceivedAlarmConversionMigration(
            defaultLabel = context.getString(R.string.rd_default_alarm_label),
            recordConverted = { converted -> FormerReceivedAlarmStore(context).recordConverted(converted) },
        )
    }
}

/**
 * 27→28: **받은 알람을 내 알람으로 바꾸고**(받은 알람 정리의 1단계) `alarms` 를 새로 만들어 전달 세대 두 칸
 * (`remoteDeliveryVersion`·`observedDeliveryVersion`)을 없앤다. 받은 알람이 사라졌으니 두 칸을 채울 길이 없다.
 *
 * ① 변환 — 오프라인, 같은 트랜잭션. 받은 사람이 기대는 값(시각·요일·공휴일 끄기·켜짐·스누즈·진동·알람음·
 *   음량·소유자)은 그대로 두고, 보낸 사람 흔적(원격 연결·라벨·오디오·문구·테마·클립)은 비운다. 목소리는
 *   기본 목소리 미나다 — 오디오 없는 기본 목소리 알람이라 울릴 때 `RingingService` 가 미나의 내장 인사말을
 *   튼다(조용히 울리지 않는다). 재생 방식은 받은 사람이 둔 값이고, 옛 버그의 잠금 표시가 있으면 그 원래 값이다.
 *   동기 상태는 아직 서버에 없는 새 내 알람과 같다 — 다음 동기화가 내 알람으로 올린다.
 *   바꾼 알람은 계정별로 기록한다 — 그 계정의 클론으로 올리는 2단계([decideFormerReceivedPromotion])가 본다.
 * ② 재생성 — API 34 아래의 SQLite 에는 `DROP COLUMN` 이 없다. 새 표의 CREATE 문은 Room 이 엔티티로 만든
 *   것(`AlarmDatabase_Impl`) 그대로이고, 열은 **이름으로** 옮긴다(기기마다 열 순서가 다를 수 있어 `*` 를 쓰지
 *   않는다). `alarms` 에는 인덱스가 없다.
 *
 * 규칙: `docs/spec/billing-lifecycle.md` 「목소리를 못 쓰게 되면」, `docs/spec/plan-gates.md` 「커플·가족 이용권 — 폐지」.
 * 회귀 테스트: `ReceivedAlarmConversionMigrationTest`.
 */
internal class ReceivedAlarmConversionMigration(
    private val defaultLabel: String,
    private val recordConverted: (Map<String?, Set<String>>) -> Unit,
) : Migration(27, 28) {
    override fun migrate(db: SupportSQLiteDatabase) {
        // 변환 **전에** 대상을 읽는다 — 변환 뒤에는 내 알람과 구별되지 않는다.
        // 소유자가 안 적힌 옛 행은 주인 없음 칸(null)으로 적는다 — 로그인한 계정이 2단계에서 본다.
        val convertedByOwner = linkedMapOf<String?, MutableSet<String>>()
        db.query("SELECT id, ownerUserId FROM alarms WHERE origin = 'received_remote'").use { cursor ->
            while (cursor.moveToNext()) {
                val owner = cursor.getString(1)?.takeIf { it.isNotBlank() }
                convertedByOwner.getOrPut(owner) { linkedSetOf() }.add(cursor.getString(0))
            }
        }
        db.execSQL(CONVERT_RECEIVED_ALARMS_SQL, arrayOf<Any?>(defaultLabel, SUBSTITUTE_SYSTEM_VOICE_ID, System.currentTimeMillis()))
        db.execSQL("DROP TABLE IF EXISTS `alarms_new`")
        db.execSQL(CREATE_ALARMS_V28.replace("`alarms`", "`alarms_new`"))
        db.execSQL("INSERT INTO alarms_new ($ALARM_COLUMNS_V28) SELECT $ALARM_COLUMNS_V28 FROM alarms")
        db.execSQL("DROP TABLE alarms")
        db.execSQL("ALTER TABLE alarms_new RENAME TO alarms")
        if (convertedByOwner.isNotEmpty()) recordConverted(convertedByOwner)
    }

    private companion object {
        /**
         * 재생 방식은 `AlarmPlayModes.normalize(잠금 표시 ?: 재생 방식)` 과 같다. 받은 행이 문구·테마를 고쳐 두었어도
         * 비운다 — 2단계가 '아직 1단계 모양 그대로인가' 를 이 모양으로 가린다(`keepsReceivedConversionShape`).
         */
        const val CONVERT_RECEIVED_ALARMS_SQL = """
            UPDATE alarms SET
                label = ?,
                playMode = CASE
                    WHEN (CASE WHEN TRIM(COALESCE(preLockPlayMode, '')) = '' THEN playMode ELSE preLockPlayMode END)
                        IN ('voice_only', 'alarm_voice') THEN 'voice_only'
                    ELSE 'alarm_only'
                END,
                preLockPlayMode = NULL,
                preLockVoiceJson = NULL,
                localAudioUri = NULL,
                audioCacheKey = NULL,
                rawAudioUri = NULL,
                voiceSource = 'tts_profile',
                voiceProfileId = ?,
                voiceListenerTitle = NULL,
                voiceText = NULL,
                voiceCategory = NULL,
                voiceLanguage = NULL,
                voiceRandomPrompt = 0,
                voiceRandomContext = NULL,
                voiceWeatherCountry = NULL,
                voiceWeatherCity = NULL,
                voiceFortuneGender = NULL,
                voiceFortuneBirthDate = NULL,
                voiceFortuneBirthTime = NULL,
                dynamicVoicePreparedForFireAtMillis = NULL,
                ttsMessageId = NULL,
                bucketId = NULL,
                bucketRotationIndex = 0,
                bucketClipKeysJson = NULL,
                bucketClipTextsJson = NULL,
                contextVariantIndex = NULL,
                contextResolvedAtMillis = NULL,
                remoteAlarmId = NULL,
                lastSyncedAtMillis = NULL,
                syncState = 'local_only',
                origin = 'local_owned',
                updatedAtMillis = ?
            WHERE origin = 'received_remote'
        """

        /** Room 이 만든 v28 `alarms` CREATE 문 그대로(`AlarmDatabase_Impl.createAllTables`). */
        const val CREATE_ALARMS_V28 =
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
                "`preLockVoiceJson` TEXT, `ownerUserId` TEXT, PRIMARY KEY(`id`))"

        /** v28 에 남는 열 — 위 CREATE 문과 같은 순서. */
        const val ALARM_COLUMNS_V28 =
            "id, label, hour, minute, fireAtMillis, repeatDaysMask, holidayOff, snoozeEnabled, snoozeMinutes, " +
                "snoozeRepeatLimit, snoozeCount, vibrationPattern, playMode, defaultAlarmSoundId, localAudioUri, " +
                "audioCacheKey, rawAudioUri, voiceSource, voiceProfileId, voiceListenerTitle, voiceText, voiceCategory, " +
                "voiceLanguage, voiceRandomPrompt, voiceRandomContext, voiceWeatherCountry, voiceWeatherCity, " +
                "voiceFortuneGender, voiceFortuneBirthDate, voiceFortuneBirthTime, dynamicVoicePreparedForFireAtMillis, " +
                "voiceRepeat, voiceVolumePercent, ttsMessageId, bucketId, bucketRotationIndex, bucketClipKeysJson, " +
                "bucketClipTextsJson, contextVariantIndex, contextResolvedAtMillis, remoteAlarmId, lastSyncedAtMillis, " +
                "syncState, origin, alarmVolumePercent, alarmSoundUri, alarmSoundLabel, alarmSoundEnabled, enabled, " +
                "state, createdAtMillis, updatedAtMillis, preLockPlayMode, preLockVoiceJson, ownerUserId"
    }
}
