package com.alarmtalk.app

import android.content.Context
import android.content.res.Configuration
import androidx.test.core.app.ApplicationProvider
import com.alarmtalk.app.data.SYSTEM_VOICE_ID_PREFIX
import com.alarmtalk.app.data.receivedRemoteAlarmLabel
import com.alarmtalk.app.data.systemVoiceDisplayName
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.Locale

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class LocalizedDisplayTest {
    private fun context(language: String): Context {
        val base = ApplicationProvider.getApplicationContext<Context>()
        val configuration = Configuration(base.resources.configuration)
        configuration.setLocale(Locale.forLanguageTag(language))
        return base.createConfigurationContext(configuration)
    }

    @Test
    fun `기본 목소리는 id로 번역하고 개인 목소리 이름은 유지한다`() {
        val names = mapOf("ko" to listOf("시우", "미나", "도현", "애니"), "en" to listOf("Siwoo", "Mina", "Dohyun", "Aeni"), "ja" to listOf("シウ", "ミナ", "ドヒョン", "エニ"))
        for ((language, expected) in names) {
            val context = context(language)
            expected.forEachIndexed { index, name ->
                assertEquals(name, systemVoiceDisplayName(context, SYSTEM_VOICE_ID_PREFIX + "000000000${101 + index}", "server name"))
            }
            assertEquals("미나", systemVoiceDisplayName(context, "private-id", "미나"))
            assertEquals("New name", systemVoiceDisplayName(context, SYSTEM_VOICE_ID_PREFIX + "000000000999", "New name"))
        }
    }

    @Test
    fun `운세 저장값과 시간 구간은 유지하며 표시만 번역한다`() {
        for ((language, expected) in mapOf("en" to listOf("Male", "Female", "Unknown"), "ja" to listOf("男性", "女性", "時間不明"))) {
            val context = context(language)
            assertEquals(expected, listOf(FortuneGenderMale, FortuneGenderFemale, FortuneBirthTimeUnknown).map { fortuneValueLabel(context, it) })
            assertEquals("09:31~11:30", fortuneValueLabel(context, "09:31~11:30"))
        }
        assertEquals("남성", FortuneGenderMale)
        assertEquals("시간 모름", FortuneBirthTimeUnknown)
    }

    @Test
    fun `받은 알람 이름의 일본어 존칭은 한 번만 붙인다`() {
        val japanese = context("ja")
        assertEquals("田中さんから届いたアラーム", receivedRemoteAlarmLabel(japanese, "田中"))
        assertEquals("田中さんから届いたアラーム", receivedRemoteAlarmLabel(japanese, "田中さん"))
        assertEquals("민수님から届いたアラーム", receivedRemoteAlarmLabel(japanese, "민수님"))
        assertEquals("相手から届いたアラーム", receivedRemoteAlarmLabel(japanese, null))
        assertEquals("Alarm from Tanaka", receivedRemoteAlarmLabel(context("en"), "Tanaka"))
        assertEquals("민수님이 보낸 알람", receivedRemoteAlarmLabel(context("ko"), "민수님"))
    }
}
