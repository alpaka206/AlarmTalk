package com.alarmtalk.app

import android.app.Application
import android.app.NotificationManager
import android.content.Context
import android.content.res.Configuration
import androidx.test.core.app.ApplicationProvider
import com.alarmtalk.app.alarm.NotificationChannels
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NotificationChannelsLocalizationTest {
    private fun context(language: String): Context {
        val base = ApplicationProvider.getApplicationContext<Context>()
        val config = Configuration(base.resources.configuration).apply { setLocale(Locale.forLanguageTag(language)) }
        return base.createConfigurationContext(config)
    }

    @Test
    fun `언어를 바꾸면 같은 채널의 이름과 설명만 갱신하고 울림 설정을 보존한다`() {
        val channels = listOf(
            Triple(NotificationChannels.RINGING_CHANNEL_ID, R.string.notification_ringing_name, R.string.notification_ringing_description),
            Triple(NotificationChannels.RINGING_QUIET_CHANNEL_ID, R.string.notification_ringing_quiet_name, R.string.notification_ringing_quiet_description),
            Triple(NotificationChannels.RINGING_FALLBACK_CHANNEL_ID, R.string.notification_ringing_fallback_name, R.string.notification_ringing_fallback_description),
            Triple(NotificationChannels.SOCIAL_CHANNEL_ID, R.string.notification_social_name, R.string.notification_social_description),
            Triple(NotificationChannels.CLIP_PREFETCH_CHANNEL_ID, R.string.notification_download_name, R.string.notification_download_description),
        )
        val manager = context("ko").getSystemService(NotificationManager::class.java)
        NotificationChannels.ensure(context("ko"))
        val settings = channels.associate { (id, _, _) ->
            val channel = manager.getNotificationChannel(id)
            id to Triple(channel.importance, channel.sound, channel.shouldVibrate())
        }
        for (language in listOf("en", "ja", "ko")) {
            val context = context(language)
            NotificationChannels.ensure(context)
            for ((id, name, description) in channels) {
                val channel = manager.getNotificationChannel(id)
                assertEquals(context.getString(name), channel.name.toString())
                assertEquals(context.getString(description), channel.description)
                assertEquals(settings[id], Triple(channel.importance, channel.sound, channel.shouldVibrate()))
                if (language != "ko") assertFalse(Regex("[가-힣]").containsMatchIn(channel.name.toString() + channel.description))
            }
        }
        assertNull(manager.getNotificationChannel(NotificationChannels.RINGING_CHANNEL_ID).sound)
        assertNull(manager.getNotificationChannel(NotificationChannels.RINGING_QUIET_CHANNEL_ID).sound)
        assertEquals(5, manager.notificationChannels.size)
    }

    @Test
    fun `프로세스 재시작 없이 언어 구성 콜백만으로 모든 채널의 표시를 갱신한다`() {
        // 테스트의 plain Application을 유지해 Sentry·동기화 초기화를 실행하지 않는다.
        val application = ApplicationProvider.getApplicationContext<Application>()
        NotificationChannels.install(application)
        NotificationChannels.ensure(context("ko"))
        val manager = application.getSystemService(NotificationManager::class.java)
        val settings = manager.notificationChannels.associate { it.id to Triple(it.importance, it.sound, it.shouldVibrate()) }
        for (language in listOf("en", "ja", "ko")) {
            val localized = context(language)
            application.onConfigurationChanged(localized.resources.configuration)
            for ((id, name, description) in listOf(
                Triple(NotificationChannels.RINGING_CHANNEL_ID, R.string.notification_ringing_name, R.string.notification_ringing_description),
                Triple(NotificationChannels.RINGING_QUIET_CHANNEL_ID, R.string.notification_ringing_quiet_name, R.string.notification_ringing_quiet_description),
                Triple(NotificationChannels.RINGING_FALLBACK_CHANNEL_ID, R.string.notification_ringing_fallback_name, R.string.notification_ringing_fallback_description),
                Triple(NotificationChannels.SOCIAL_CHANNEL_ID, R.string.notification_social_name, R.string.notification_social_description),
                Triple(NotificationChannels.CLIP_PREFETCH_CHANNEL_ID, R.string.notification_download_name, R.string.notification_download_description),
            )) {
                val channel = manager.getNotificationChannel(id)
                assertEquals(localized.getString(name), channel.name.toString())
                assertEquals(localized.getString(description), channel.description)
                assertEquals(settings[id], Triple(channel.importance, channel.sound, channel.shouldVibrate()))
            }
            assertEquals(5, manager.notificationChannels.size)
        }
    }

    @Test
    fun `설정의 법적 문서 링크는 화면 언어와 같고 운세 저장값은 표시만 번역한다`() {
        for (language in listOf("ko", "en", "ja")) {
            val context = context(language)
            assertEquals("https://alarm-talk.com/$language/privacy", context.getString(R.string.legal_privacy_url))
            assertEquals("https://alarm-talk.com/$language/terms", context.getString(R.string.legal_terms_url))
            val label = fortuneInfoSettingsLabel(context, FortuneGenderMale, "2000-01-02")
            val expectedGender = when (language) { "en" -> "Male"; "ja" -> "男性"; else -> FortuneGenderMale }
            assertEquals("$expectedGender · 2000-01-02", label)
        }
    }
}
