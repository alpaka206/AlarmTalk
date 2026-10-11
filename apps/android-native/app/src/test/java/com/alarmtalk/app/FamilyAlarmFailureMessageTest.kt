package com.alarmtalk.app

import android.content.Context
import android.content.res.Configuration
import androidx.test.core.app.ApplicationProvider
import com.alarmtalk.app.network.apiErrorMessageRes
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import retrofit2.HttpException
import retrofit2.Response
import java.io.File
import java.util.Locale

/**
 * 가족 알람 보내기·이용권 나가기가 서버의 **거절 이유**를 말하는지 본다(`docs/spec/error-codes.md` §4).
 * 예전에는 두 자리 모두 공용 표를 거치지 않아, 리드타임·설정 불가능 시간·받지 않음이 전부
 * "상대 알람 설정에 실패했어요" 로, 관리자의 나가기가 "이용권에서 나가지 못했어요" 로 뭉개졌다.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class FamilyAlarmFailureMessageTest {
    private fun context(language: String): Context {
        val base = ApplicationProvider.getApplicationContext<Context>()
        val configuration = Configuration(base.resources.configuration)
        configuration.setLocale(Locale.forLanguageTag(language))
        return base.createConfigurationContext(configuration)
    }

    private fun http(status: Int, code: String): HttpException =
        HttpException(Response.error<Any>(status, """{"error_code":"$code"}""".toResponseBody("application/json".toMediaType())))

    @Test
    fun `서버가 가족 알람에서 내는 거절 코드는 전부 공용 표에 문구가 있다`() {
        val sources = listOf("alarm-helpers.ts", "family-alarm.ts")
            .map { File("../../../packages/backend/src/routes/$it").readText() }
        val codes = sources.flatMap { Regex("""error_code: '(FAMILY_ALARM_\w+)'""").findAll(it).map { m -> m.groupValues[1] }.toList() }
            .toSet()
        assertEquals(setOf("FAMILY_ALARM_DISABLED", "FAMILY_ALARM_LEAD_TIME", "FAMILY_ALARM_QUIET_TIME"), codes)
        for (code in codes + "OWNER_CANNOT_LEAVE") {
            assertTrue("$code 에 문구가 없다", apiErrorMessageRes(code) != null)
        }
    }

    @Test
    fun `가족 알람 보내기 실패는 세 언어에서 거절 이유를 말한다`() {
        for (language in listOf("ko", "en", "ja")) {
            val context = context(language)
            val generic = context.getString(R.string.msg_family_alarm_set_failed)
            val expected = mapOf(
                http(403, "FAMILY_ALARM_DISABLED") to R.string.api_error_family_alarm_disabled,
                http(400, "FAMILY_ALARM_LEAD_TIME") to R.string.api_error_family_alarm_lead_time,
                http(403, "FAMILY_ALARM_QUIET_TIME") to R.string.editor_error_family_alarm_time_unavailable,
            )
            for ((error, res) in expected) {
                val message = familyAlarmFailureMessage(context, error)
                assertEquals(language, context.getString(res), message)
                assertNotEquals(language, generic, message)
                assertEquals(language, MessageSeverity.Error, snackbarSeverity(context, message))
            }
            assertEquals(language, generic, familyAlarmFailureMessage(context, http(500, "SOMETHING_NEW")))
            assertEquals(language, generic, familyAlarmFailureMessage(context, IllegalStateException("boom")))
        }
    }

    @Test
    fun `관리자가 이용권에서 나가려다 막히면 그 이유를 말한다`() {
        for (language in listOf("ko", "en", "ja")) {
            val context = context(language)
            assertEquals(
                language,
                context.getString(R.string.api_error_owner_cannot_leave),
                leaveGroupFailureMessage(context, http(409, "OWNER_CANNOT_LEAVE")),
            )
            assertEquals(
                language,
                context.getString(R.string.msg_leave_group_failed),
                leaveGroupFailureMessage(context, http(403, "NOT_MEMBER")),
            )
        }
    }
}
