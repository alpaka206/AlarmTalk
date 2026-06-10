package com.alarmtalk.app.network

import org.junit.Assert.assertThrows
import org.junit.Test

class AlarmTalkApiClientTest {
    @Test
    fun createRejectsCleartextBaseUrl() {
        assertThrows(IllegalArgumentException::class.java) {
            AlarmTalkApiClient.create(baseUrl = "http://api.example.com/api/")
        }
    }
}
