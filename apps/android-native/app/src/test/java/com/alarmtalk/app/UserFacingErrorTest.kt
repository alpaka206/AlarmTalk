package com.alarmtalk.app

import android.content.Context
import android.content.res.Configuration
import androidx.test.core.app.ApplicationProvider
import com.alarmtalk.app.sync.ClipFailure
import com.alarmtalk.app.sync.classifyClipFailure
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.Locale

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class UserFacingErrorTest {
    private fun context(language: String): Context {
        val base = ApplicationProvider.getApplicationContext<Context>()
        val configuration = Configuration(base.resources.configuration)
        configuration.setLocale(Locale.forLanguageTag(language))
        return base.createConfigurationContext(configuration)
    }

    @Test
    fun `앱 문구는 세 언어에서 유지하고 내부 오류는 가린다`() {
        for (language in listOf("ko", "en", "ja")) {
            val message = context(language).getString(R.string.rd_audio_open_failed)
            assertEquals(message, userFacingError(UserFacingException(message), "fallback"))
            assertEquals(message, userFacingError(IllegalStateException("wrapper", UserFacingException(message)), "fallback"))
            assertEquals("fallback", userFacingError(IllegalArgumentException(message), "fallback"))
        }
    }

    @Test
    fun `사용자용 오디오 형식 오류는 영구 실패 분류를 유지한다`() {
        assertEquals(ClipFailure.PERMANENT, classifyClipFailure(UserFacingException("Invalid audio")))
    }

    @Test
    fun `서로 감싼 내부 오류도 무한 순환하지 않는다`() {
        val first = RuntimeException("first")
        val second = RuntimeException("second", first)
        first.initCause(second)
        assertEquals("fallback", userFacingError(first, "fallback"))
    }

    @Test
    fun `이름 없는 가족 알람 완료는 각 언어의 완성 문장을 쓴다`() {
        val expected = mapOf("ko" to "상대에게 알람을 설정했어요", "en" to "Set an alarm for the other person.", "ja" to "相手にアラームを設定しました。")
        for ((language, message) in expected) {
            val context = context(language)
            assertEquals(message, familyAlarmCompletionMessage(context, null))
            assertEquals(message, familyAlarmCompletionMessage(context, "  "))
            assertEquals(
                context.getString(R.string.msg_family_alarm_set_for_target, com.alarmtalk.app.data.honoredPersonName(context, "Alex")),
                familyAlarmCompletionMessage(context, "Alex"),
            )
        }
    }

    @Test
    fun `오류와 완료 스낵바는 세 언어에서 같은 색상 의미를 유지한다`() {
        for (language in listOf("ko", "en", "ja")) {
            val context = context(language)
            assertEquals(language, MessageSeverity.Error, snackbarSeverity(context, context.getString(R.string.msg_alarm_save_failed)))
            assertEquals(language, MessageSeverity.Success, snackbarSeverity(context, familyAlarmCompletionMessage(context, null)))
            assertEquals(language, MessageSeverity.Info, snackbarSeverity(context, "12345"))
        }
    }
    @Test
    fun `서버 오류와 실패 안내를 완료 색상으로 표시하지 않는다`() {
        val failureResources = R.string::class.java.fields.filter {
            it.name.startsWith("api_error_") || it.name.endsWith("_failed")
        }
        for (language in listOf("ko", "en", "ja")) {
            val context = context(language)
            for (field in failureResources) {
                val text = context.getString(field.getInt(null))
                org.junit.Assert.assertNotEquals("$language: ${field.name}: $text", MessageSeverity.Success, snackbarSeverity(context, text))
            }
            assertEquals(language, MessageSeverity.Error, snackbarSeverity(context, context.getString(R.string.api_error_server)))
        }
    }

}
