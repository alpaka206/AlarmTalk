package com.alarmtalk.app.data

import android.content.Context
import androidx.room.Database
import androidx.room.migration.Migration
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(
    entities = [AlarmEntity::class, CharacterEventEntity::class, HolidayEntity::class],
    version = 14,
    exportSchema = false,
)
abstract class AlarmDatabase : RoomDatabase() {
    abstract fun alarmDao(): AlarmDao
    abstract fun characterEventDao(): CharacterEventDao
    abstract fun holidayDao(): HolidayDao

    companion object {
        @Volatile
        private var instance: AlarmDatabase? = null

        fun getInstance(context: Context): AlarmDatabase =
            instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    AlarmDatabase::class.java,
                    "voice-alarm.db",
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
                ).build()
                    .also { instance = it }
            }

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

        private val MIGRATION_3_4 = object : Migration(3, 4) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS character_events (
                        id TEXT NOT NULL PRIMARY KEY,
                        event TEXT NOT NULL,
                        clientNonce TEXT NOT NULL,
                        localDate TEXT NOT NULL,
                        sourceAlarmId TEXT,
                        state TEXT NOT NULL,
                        createdAtMillis INTEGER NOT NULL,
                        syncedAtMillis INTEGER,
                        lastError TEXT
                    )
                    """.trimIndent(),
                )
                db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS index_character_events_clientNonce ON character_events(clientNonce)")
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
    }
}
