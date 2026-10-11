package com.alarmtalk.app.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class AlarmTalkApiClientTest {
    @Test
    fun createRejectsCleartextBaseUrl() {
        assertThrows(IllegalArgumentException::class.java) {
            AlarmTalkApiClient.create(baseUrl = "http://api.example.com/api/")
        }
    }

    /**
     * 기본 목소리 받기 워커의 클라이언트에는 **요청 하나의 전체 시간 상한**이 있다
     * (`docs/spec/voice-and-message.md` 「준비 페이지」 — 받기 한 회차에는 끝이 있다). 연결·읽기·쓰기 60초는
     * 바이트 사이 간격이라 아주 느린 망에서는 클립 하나가 끝없이 길어질 수 있었다.
     */
    @Test
    fun theClipDownloadClientHasACallTimeout() {
        val client = AlarmTalkApiClient.httpClient(callTimeoutSeconds = AlarmTalkApiClient.CLIP_DOWNLOAD_CALL_TIMEOUT_SECONDS)

        assertEquals(90_000, client.callTimeoutMillis)
        // 바이트 사이 간격 상한은 그대로다.
        assertEquals(60_000, client.connectTimeoutMillis)
        assertEquals(60_000, client.readTimeoutMillis)
        assertEquals(60_000, client.writeTimeoutMillis)
    }

    /** 전경 클라이언트는 상한을 걸지 않는다 — 목소리 등록 업로드처럼 오래 걸려도 정상인 요청이 같이 쓴다. */
    @Test
    fun theDefaultClientHasNoCallTimeout() {
        assertEquals(0, AlarmTalkApiClient.httpClient().callTimeoutMillis)
    }
}
