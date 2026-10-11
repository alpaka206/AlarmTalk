package com.alarmtalk.app.data

import android.content.Context
import android.content.res.Configuration
import androidx.test.core.app.ApplicationProvider
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ReceivedAlarmLabelDisplayTest {
    private fun context(language: String): Context {
        val base = ApplicationProvider.getApplicationContext<Context>()
        val config = Configuration(base.resources.configuration).apply { setLocale(Locale.forLanguageTag(language)) }
        return base.createConfigurationContext(config)
    }

    @Test
    fun `다른 언어에서 저장된 자동 라벨과 이중 존칭을 현재 언어로 표시한다`() {
        for ((language, expected) in mapOf("ko" to "Alex님이 보낸 알람", "en" to "Alarm from Alex", "ja" to "Alexさんから届いたアラーム")) {
            val context = context(language)
            for (stored in listOf("Alex님이 보낸 알람", "Alarm from Alex", "Alexさんから届いたアラーム", "Alexさんさんから届いたアラーム")) {
                assertEquals(expected, localizedReceivedAlarmLabel(context, stored))
            }
            assertEquals("직접 정한 이름", localizedReceivedAlarmLabel(context, "직접 정한 이름"))
            assertEquals(receivedRemoteAlarmLabel(context, null), localizedReceivedAlarmLabel(context, "Alarm from your friend"))
            assertEquals(receivedRemoteAlarmLabel(context, "선생"), localizedReceivedAlarmLabel(context, "선생님이 보낸 알람"))
        }
    }

    @Test
    fun `가족 알람의 기본 녹음 라벨은 받는 기기의 언어로 보이고 직접 친 라벨은 그대로다`() {
        val expected = mapOf("ko" to "상대가 보낸 음성", "en" to "Voice from someone", "ja" to "相手から届いた音声")
        for ((language, text) in expected) {
            val context = context(language)
            // 계약값과, 번역문을 보내던 옛 안드로이드 빌드가 남긴 값.
            for (stored in listOf("가족이 보낸 음성", " 가족이 보낸 음성 ", "Voice from family", "家族からの音声")) {
                assertEquals(text, localizedReceivedVoiceText(context, stored))
            }
            assertEquals("엄마가 깨워 줄게", localizedReceivedVoiceText(context, "엄마가 깨워 줄게"))
        }
    }

    @Test
    fun `가족 알람의 기본 녹음 라벨은 서버와 같은 계약값이다`() {
        assertEquals("가족이 보낸 음성", FAMILY_VOICE_DEFAULT_LABEL)
        val server = java.io.File("../../../packages/backend/src/routes/family-alarm.ts").readText()
        assert(server.contains("const DEFAULT_VOICE_LABEL = '$FAMILY_VOICE_DEFAULT_LABEL';")) { "server default label drifted" }
    }

    @Test
    fun `세 언어의 기본 이름은 제목에서 빼고 직접 지은 이름은 보존한다`() {
        for (label in listOf("알람", "Alarm", "アラーム", "", "  ")) assertNull(customRingingAlarmLabel(label))
        assertEquals("출근", customRingingAlarmLabel("  출근  "))
    }
}
