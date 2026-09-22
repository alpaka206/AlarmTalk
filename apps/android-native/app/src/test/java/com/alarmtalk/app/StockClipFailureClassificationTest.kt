package com.alarmtalk.app

import com.alarmtalk.app.sync.ClipFailure
import com.alarmtalk.app.sync.classifyClipFailure
import com.alarmtalk.app.sync.isPermanentClipFailure
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response
import java.io.IOException

/**
 * 스톡 클립 선다운로드의 **클립별** 실패 분류 회귀 가드(코덱스 #788).
 *
 * 클립별 `runCatching` 은 형제 요청을 살리려고 실패를 삼키는데, 그 자리에서 401 을 `isPermanent`
 * 로만 보면 영구 실패로 세어져 배치가 `failure` 로 조용히 끝난다 — 워커의 바깥 갈래
 * (`syncWorkerOutcome` → `endSessionAfterWorkerUnauthorized`)에 닿지 못해 죽은 세션이 살아남는다.
 * 그래서 401 은 **세지 않고** 별도 갈래로 올린다.
 */
class StockClipFailureClassificationTest {

    private fun http(code: Int): HttpException =
        HttpException(Response.error<Any>(code, "{}".toResponseBody("application/json".toMediaType())))

    @Test
    fun `401 은 영구 실패가 아니라 세션 만료다`() {
        // 4xx 라 `isPermanentClipFailure` 만 보면 영구로 읽힌다 — 그 순서가 이 버그였다.
        assertTrue(isPermanentClipFailure(http(401)))
        assertEquals(ClipFailure.SESSION_EXPIRED, classifyClipFailure(http(401)))
    }

    @Test
    fun `감싼 401 도 세션 만료다`() {
        val wrapped = IllegalStateException("download failed", http(401))
        assertEquals(ClipFailure.SESSION_EXPIRED, classifyClipFailure(wrapped))
    }

    @Test
    fun `404 와 응답 형식 오류는 영구 실패다`() {
        assertEquals(ClipFailure.PERMANENT, classifyClipFailure(http(404)))
        assertEquals(ClipFailure.PERMANENT, classifyClipFailure(IllegalArgumentException("bad base64")))
    }

    @Test
    fun `403·408·429·5xx·네트워크 실패는 다시 해 볼 만하다`() {
        for (code in listOf(403, 408, 429, 500, 503)) {
            assertEquals("code=$code", ClipFailure.TRANSIENT, classifyClipFailure(http(code)))
            assertFalse("code=$code", isPermanentClipFailure(http(code)))
        }
        assertEquals(ClipFailure.TRANSIENT, classifyClipFailure(IOException("timeout")))
    }
}
