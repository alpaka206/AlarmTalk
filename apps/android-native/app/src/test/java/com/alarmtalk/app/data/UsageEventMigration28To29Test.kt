package com.alarmtalk.app.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.test.core.app.ApplicationProvider
import com.alarmtalk.app.sync.UsageEventUploadWorker
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * **사용 기록 2판의 칸 — Room 29→30**(`AlarmDatabase.MIGRATION_29_30`, `docs/spec/usage-events.md` §7). v28 에서 열어 응원 칸(28→29)과
 * 이 칸(29→30)을 함께 지난다 — 스토어의 앱은 v28 이다.
 *
 * v28 파일 DB 를 Room 이 만들던 CREATE 문 그대로 세우고 실제 등록(`AlarmDatabase.build`)으로 연다 — 열 이름·타입·기본값이
 * 엔티티와 어긋나면 Room 의 스키마 검증이 여기서 던진다(앱이라면 켜자마자 죽는다). 큐에 남아 있던 옛 행은 1판으로
 * 그대로 올라가야 한다.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class UsageEventMigration28To29Test {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val dbName = "usage-events-28-29.db"

    @Before
    fun setUp() {
        context.deleteDatabase(dbName)
    }

    @After
    fun tearDown() {
        context.deleteDatabase(dbName)
    }

    @Test
    fun `28에서 29로 올리면 큐의 옛 행은 1판으로 남고 새 칸을 쓸 수 있다`() = runBlocking {
        val file = context.getDatabasePath(dbName)
        file.parentFile?.mkdirs()
        SQLiteDatabase.openOrCreateDatabase(file, null).use { db ->
            db.execSQL(ReceivedAlarmConversionMigration.CREATE_ALARMS_V28)
            db.execSQL(
                "CREATE TABLE IF NOT EXISTS `holiday_dates` (`countryCode` TEXT NOT NULL, `regionCode` TEXT NOT NULL, " +
                    "`epochDay` INTEGER NOT NULL, `localDate` TEXT NOT NULL, `name` TEXT NOT NULL, `source` TEXT NOT NULL, " +
                    "`updatedAtMillis` INTEGER NOT NULL, PRIMARY KEY(`countryCode`, `regionCode`, `epochDay`))",
            )
            db.execSQL(
                "CREATE TABLE IF NOT EXISTS `usage_events` (`id` TEXT NOT NULL, `type` TEXT NOT NULL, " +
                    "`occurredAtMillis` INTEGER NOT NULL, `alarmId` TEXT, `voiceProfileId` TEXT, `messageId` TEXT, " +
                    "`detail` TEXT, `userId` TEXT, PRIMARY KEY(`id`))",
            )
            db.execSQL("CREATE TABLE IF NOT EXISTS room_master_table (id INTEGER PRIMARY KEY,identity_hash TEXT)")
            db.execSQL("INSERT OR REPLACE INTO room_master_table (id,identity_hash) VALUES(42, 'v28')")
            db.insertOrThrow(
                "usage_events",
                null,
                ContentValues().apply {
                    put("id", OLD_ID)
                    put("type", "alarm_rang")
                    put("occurredAtMillis", 1_000L)
                    put("detail", "screen_off")
                    put("userId", "u1")
                },
            )
            db.version = 28
        }

        val database = AlarmDatabase.build(context, dbName)
        try {
            val dao = database.usageEventDao()
            val old = dao.oldest("u1", 10).single()
            assertEquals(1, old.schemaVersion)
            assertNull(old.appVersion)
            assertNull(old.attemptId)
            assertNull(old.propsJson)
            assertEquals("screen_off", old.detail)
            val payload = UsageEventUploadWorker.toPayload(old)
            assertEquals(1, payload.schemaVersion)
            assertNull(payload.props)

            dao.insert(
                UsageEventEntity(
                    id = NEW_ID,
                    type = UsageEvents.SAMPLE_STARTED,
                    occurredAtMillis = 2_000L,
                    userId = "u1",
                    schemaVersion = 2,
                    appVersion = "41",
                    attemptId = NEW_ID,
                    propsJson = UsageEventProps(surface = "editor").toJson(),
                ),
            )
            val fresh = dao.oldest("u1", 10).last()
            assertEquals(2, fresh.schemaVersion)
            assertEquals("editor", UsageEventProps.fromJson(fresh.propsJson)?.surface)
        } finally {
            database.close()
        }
    }

    private companion object {
        const val OLD_ID = "11111111-1111-4111-8111-111111111111"
        const val NEW_ID = "22222222-2222-4222-8222-222222222222"
    }
}
