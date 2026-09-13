package com.alarmtalk.app.data

import com.alarmtalk.app.network.RemoteAlarm
import com.alarmtalk.app.network.RemoteAlarmApi
import com.alarmtalk.app.network.RemoteAlarmListResponse
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.supervisorScope
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

class RemoteAlarmPaginationTest {
    @Test
    fun readsFamilyAlarmBeyond2500ThroughActualCursorRequests() = runBlocking {
        val requests = mutableListOf<String?>()
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            assertEquals("Bearer test-token", request.header("Authorization"))
            assertEquals("cursor", request.url.queryParameter("pagination"))
            assertEquals("100", request.url.queryParameter("limit"))
            assertNull(request.url.queryParameter("offset"))
            val after = request.url.queryParameter("after")
            requests.add(after)
            val start = after?.toInt() ?: 0
            val end = minOf(start + 100, 2601)
            val alarms = (start until end).joinToString(",") { index ->
                """{"id":"alarm-$index","is_received":${index == 2600}}"""
            }
            val next = if (end < 2601) "\"$end\"" else "null"
            // total은 의도적으로 없다. 완료 여부는 커서 계약으로만 결정한다.
            val body = """{"alarms":[$alarms],"has_more":${end < 2601},"next_cursor":$next}"""
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200)
                .message("OK").body(body.toResponseBody("application/json".toMediaType())).build()
        }.build()
        try {
            val api = Retrofit.Builder().baseUrl("https://pagination.example.test/api/")
                .client(client).addConverterFactory(GsonConverterFactory.create()).build()
                .create(RemoteAlarmApi::class.java)
            val alarms = collectRemoteAlarmPages { after ->
                api.listAlarms("Bearer test-token", limit = 100, after = after)
            }
            assertEquals(2601, alarms.size)
            assertEquals(listOf("alarm-2600"), alarms.filter { it.isReceived }.map { it.id })
            assertEquals(listOf(null) + (100..2600 step 100).map { it.toString() }, requests)
        } finally {
            client.dispatcher.executorService.shutdown()
            client.connectionPool.evictAll()
        }
    }

    @Test
    fun cursorSurvivesDeletionAndDoesNotUseTotalOrPageLength() = runBlocking {
        val requested = mutableListOf<String?>()
        val result = collectRemoteAlarmPages { after ->
            requested.add(after)
            when (after) {
                null -> page(listOf(alarm("removed")), true, "10").copy(total = 2)
                // 앞 행과 커서 행이 삭제돼 total이 줄어도 after=10 뒤의 새 행을 읽는다.
                "10" -> page(listOf(alarm("family")), false).copy(total = 1)
                else -> error("Unexpected cursor")
            }
        }
        assertEquals(listOf(null, "10"), requested)
        assertEquals(listOf("removed", "family"), result.map { it.id })
        assertTrue(collectRemoteAlarmPages { page(emptyList(), false) }.isEmpty())
    }

    @Test
    fun mergesNewDeliveryAtLatestPositionIncludingDisabledGeneration() = runBlocking {
        for (originalVersion in listOf(null, "old")) {
            var call = 0
            val result = collectRemoteAlarmPages {
                when (call++) {
                    0 -> page(listOf(alarm("a", originalVersion), alarm("b", "b1")), true, "2")
                    else -> page(listOf(alarm("a", "new").copy(isActive = false)), false)
                }
            }
            assertEquals(listOf("b", "a"), result.map { it.id })
            assertEquals("new", result.last().deliveryVersion)
            assertEquals(false, result.last().isActive)
        }
    }

    @Test
    fun rejectsDuplicateMissingAndRegressedDeliveryVersions() = runBlocking {
        val invalidPages = listOf(
            listOf(page(listOf(alarm("a"), alarm("a")), false)),
            listOf(page(listOf(alarm("a", "old")), true, "1"), page(listOf(alarm("a", "old")), false)),
            listOf(page(listOf(alarm("a", "old")), true, "1"), page(listOf(alarm("a")), false)),
            listOf(page(listOf(alarm("a", "old")), true, "1"), page(listOf(alarm("a", "  ")), false)),
            listOf(
                page(listOf(alarm("a", "old")), true, "1"),
                page(listOf(alarm("a", "new")), true, "2"),
                page(listOf(alarm("a", "old")), false),
            ),
        )
        for (pages in invalidPages) {
            var call = 0
            expectInvalid { collectRemoteAlarmPages { pages[call++] } }
        }
    }

    @Test
    fun rejectsMissingIncompleteAndNonAdvancingCursorContracts() = runBlocking {
        expectInvalid { collectRemoteAlarmPages { RemoteAlarmListResponse(listOf(alarm("a"))) } }
        expectInvalid { collectRemoteAlarmPages { page(emptyList(), true, "1") } }
        expectInvalid { collectRemoteAlarmPages { page(listOf(alarm("a")), false, "1") } }
        for (cursor in listOf(null, "", "0", "-1", "01", "+1", "1.0", " 1", "9007199254740992")) {
            expectInvalid { collectRemoteAlarmPages { page(listOf(alarm("a")), true, cursor) } }
        }
        for (cursor in listOf("9", "10")) {
            var call = 0
            expectInvalid {
                collectRemoteAlarmPages {
                    if (call++ == 0) page(listOf(alarm("a")), true, "10")
                    else page(listOf(alarm("b")), true, cursor)
                }
            }
        }
    }

    @Test
    fun laterFailureDoesNotReturnPartialCollection() = runBlocking {
        var call = 0
        expectInvalid {
            collectRemoteAlarmPages {
                if (call++ == 0) page(listOf(alarm("a")), true, "1")
                else throw IOException("page unavailable")
            }
        }
        assertEquals(2, call)
    }

    @Test
    fun cancellationAfterResponseCannotPublishPartialOrCompleteCollection() = runBlocking {
        supervisorScope {
            var returned = false
            val task = async {
                collectRemoteAlarmPages {
                    currentCoroutineContext().cancel()
                    page(listOf(alarm("a")), false)
                }
                returned = true
            }
            try {
                task.await()
                fail("Cancellation must propagate")
            } catch (_: CancellationException) {
                assertFalse(returned)
            }
        }
    }

    private fun alarm(id: String, version: String? = null) =
        RemoteAlarm(id = id, deliveryVersion = version)

    private fun page(alarms: List<RemoteAlarm>, more: Boolean, next: String? = null) =
        RemoteAlarmListResponse(alarms, hasMore = more, nextCursor = next)

    private suspend fun expectInvalid(block: suspend () -> Unit) {
        try {
            block()
            fail("Invalid or incomplete pages must not succeed")
        } catch (_: IOException) {
            // 목록 수집이 실패하므로 호출자의 예약·ACK·prune 단계로 넘어갈 수 없다.
        }
    }
}
