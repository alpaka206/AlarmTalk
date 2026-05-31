package com.alarmtalk.app.network

import org.junit.Assert.assertThrows
import org.junit.Test

class VoiceAlarmApiClientTest {
    @Test
    fun createRejectsCleartextBaseUrl() {
        assertThrows(IllegalArgumentException::class.java) {
            VoiceAlarmApiClient.create(baseUrl = "http://api.example.com/api/")
        }
    }
}
