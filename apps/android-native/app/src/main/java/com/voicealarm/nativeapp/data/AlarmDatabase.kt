package com.voicealarm.nativeapp.data

import android.content.Context
import androidx.room.Database
import androidx.room.migration.Migration
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(
    entities = [AlarmEntity::class],
    version = 3,
    exportSchema = false,
)
abstract class AlarmDatabase : RoomDatabase() {
    abstract fun alarmDao(): AlarmDao

    companion object {
        @Volatile
        private var instance: AlarmDatabase? = null

        fun getInstance(context: Context): AlarmDatabase =
            instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    AlarmDatabase::class.java,
                    "voice-alarm.db",
                ).addMigrations(MIGRATION_1_2, MIGRATION_2_3).build().also { instance = it }
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
    }
}
