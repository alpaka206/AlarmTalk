package com.alarmtalk.app.data

import com.alarmtalk.app.network.UsageEventBatchRequest
import com.alarmtalk.app.sync.UsageEventUploadWorker
import com.google.gson.Gson
import com.google.gson.JsonParser
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
 * 사용 기록 **2판**(`docs/spec/usage-events.md` §7) — 기록기가 공통 필드를 채우고, 정해진 칸을 서버 모양으로 다듬고,
 * 전송 모양이 1판 행을 그대로 1판으로 보내는가.
 *
 * ⚠ 서버는 칸·식별자 하나라도 모양이 틀리면 **배치째 400** 이고 앱은 성공한 배치만 지우므로, 틀린 값이 큐에 들어가면 그
 *   배치가 영원히 맨 앞에서 다시 간다. 그래서 다듬기는 '고쳐 보내기' 가 아니라 '그 칸만 비우기' 다.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class UsageEventV2Test {
    private val attempt = "3f2504e0-4f89-41d3-9a0c-0305e82c3301"

    @Test
    fun `새 행은 2판이고 적는 순간의 앱 버전과 시도 id 를 싣는다`() {
        val dao = FakeDao()
        val recorder = UsageEventRecorder(dao, currentUserId = { "u1" }, appVersion = "41")

        recorder.record(
            type = UsageEvents.VOICE_PREPARATION_READY,
            attemptId = attempt,
            featureVersion = PreparationAttempt.FEATURE_VERSION,
            props = UsageEventProps(scope = UsageEventProps.SCOPE_ALL_VOICES, durationMs = 1200, bytes = 9000),
        )

        val row = dao.awaitOne()
        assertEquals(2, row.schemaVersion)
        assertEquals("41", row.appVersion)
        assertEquals("prep-1", row.featureVersion)
        assertEquals(attempt, row.attemptId)
        val props = UsageEventProps.fromJson(row.propsJson)!!
        assertEquals("all_voices", props.scope)
        assertEquals(1200L, props.durationMs)
    }

    @Test
    fun `1판 종류도 2판으로 적는다 — 앱 버전을 싣는다`() {
        val dao = FakeDao()
        UsageEventRecorder(dao, currentUserId = { "u1" }, appVersion = "41").record(type = UsageEvents.ALARM_RANG)
        val row = dao.awaitOne()
        assertEquals(2, row.schemaVersion)
        assertNull(row.propsJson)
    }

    @Test
    fun `모양이 틀린 칸과 식별자는 그 칸만 비운다 — 사건은 남긴다`() {
        val dao = FakeDao()
        UsageEventRecorder(dao, currentUserId = { "u1" }, appVersion = "41").record(
            type = UsageEvents.ALARM_SAVE_BLOCKED,
            alarmId = "not-a-uuid",
            attemptId = "abc",
            props = UsageEventProps(
                reason = "MANUAL_TEXT_MISSING",
                errorCode = "문구 원문",
                scope = "everything",
                durationMs = -5,
                usageMonth = "2026-13",
                resultId = "x",
            ),
        )
        val row = dao.awaitOne()
        assertEquals(UsageEvents.ALARM_SAVE_BLOCKED, row.type)
        assertNull(row.alarmId)
        assertNull(row.attemptId)
        val props = UsageEventProps.fromJson(row.propsJson)!!
        assertEquals("manual_text_missing", props.reason)
        assertNull(props.errorCode)
        assertNull(props.scope)
        assertEquals(0L, props.durationMs)
        assertNull(props.usageMonth)
        assertNull(props.resultId)
    }

    @Test
    fun `계정을 모르면 2판 기록도 적지 않는다 — 가입 전 수집은 없다`() {
        val dao = FakeDao()
        UsageEventRecorder(dao, currentUserId = { null }, appVersion = "41").record(
            type = UsageEvents.SAMPLE_STARTED,
            props = UsageEventProps(surface = "editor"),
        )
        Thread.sleep(50)
        assertEquals(0, runBlocking { dao.count() })
    }

    @Test
    fun `옛 행은 1판으로 보낸다 — 플랫폼·칸 없이`() {
        val payload = UsageEventUploadWorker.toPayload(
            UsageEventEntity(id = attempt, type = "alarm_rang", occurredAtMillis = 0L, userId = "u1"),
        )
        assertEquals(1, payload.schemaVersion)
        assertNull(payload.platform)
        assertNull(payload.appVersion)
        assertNull(payload.props)
    }

    @Test
    fun `2판 행은 props 객체로 풀어 보내고 null 칸은 빠진다`() {
        val row = UsageEventEntity(
            id = attempt,
            type = UsageEvents.GENERATION_OUTCOME,
            occurredAtMillis = 0L,
            userId = "u1",
            schemaVersion = 2,
            appVersion = "41",
            attemptId = attempt,
            propsJson = UsageEventProps(
                outcome = UsageEventProps.OUTCOME_SUCCESS,
                chargedSource = UsageEventProps.CHARGED_BASE,
                charCount = 12,
                isFirst = false,
            ).toJson(),
        )
        val json = Gson().toJson(UsageEventBatchRequest(listOf(UsageEventUploadWorker.toPayload(row))))
        val event = JsonParser.parseString(json).asJsonObject["events"].asJsonArray[0].asJsonObject
        assertEquals("android", event["platform"].asString)
        assertEquals(2, event["schema_version"].asInt)
        assertEquals("41", event["app_version"].asString)
        val props = event["props"].asJsonObject
        assertEquals("success", props["outcome"].asString)
        assertEquals("base", props["charged_source"].asString)
        assertEquals(12, props["char_count"].asInt)
        assertFalse(props["is_first"].asBoolean)
        // 서버의 칸은 `optional()` 이라 null 을 받지 않는다 — 빠져야 한다.
        assertFalse(json.contains("null"))
        assertFalse(props.has("scope"))
    }

    @Test
    fun `코드 다듬기는 서버 코드를 소문자로 내리고 코드가 아닌 것은 비운다`() {
        assertEquals("voice_not_found", UsageEventProps.code("VOICE_NOT_FOUND"))
        assertEquals("email_register", UsageEventProps.code("email_register"))
        assertNull(UsageEventProps.code("안녕하세요"))
        assertNull(UsageEventProps.code(""))
        assertTrue(UsageEventProps.isUuid(attempt))
        assertFalse(UsageEventProps.isUuid("3f2504e0-4f89-01d3-9a0c-0305e82c3301"))
    }

    private class FakeDao : UsageEventDao {
        val inserted = mutableListOf<UsageEventEntity>()

        override suspend fun insert(event: UsageEventEntity) {
            synchronized(inserted) { inserted += event }
        }

        override suspend fun oldest(userId: String, limit: Int): List<UsageEventEntity> =
            synchronized(inserted) { inserted.filter { it.userId == userId } }

        override suspend fun deleteByIds(ids: List<String>) {
            synchronized(inserted) { inserted.removeAll { it.id in ids } }
        }

        override suspend fun count(): Int = synchronized(inserted) { inserted.size }

        override suspend fun deleteOldest(count: Int) {
            synchronized(inserted) { repeat(minOf(count, inserted.size)) { inserted.removeAt(0) } }
        }

        fun awaitOne(): UsageEventEntity {
            val deadline = System.currentTimeMillis() + 2_000
            while (synchronized(inserted) { inserted.isEmpty() }) {
                if (System.currentTimeMillis() > deadline) error("기록이 들어오지 않았다")
                Thread.sleep(10)
            }
            return synchronized(inserted) { inserted.single() }
        }
    }
}
