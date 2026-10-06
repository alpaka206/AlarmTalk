package com.alarmtalk.app

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

/**
 * 스낵바 색은 문구의 종류로 정한다(`ui/app/SnackbarSeverity.kt`). 예전 낱말 표지는 영어·일본어에서
 * 뜻을 뒤집었다 — 이 테스트는 **스낵바로 갈 수 있는 모든 문구**를 세 언어로 펼쳐 정해 둔 색인지 본다.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class SnackbarSeverityTest {
    private val context: Context get() = ApplicationProvider.getApplicationContext()

    @Test
    @Config(qualifiers = "ko")
    fun `한국어 스낵바 문구는 정해 둔 색으로 뜬다`() = assertEveryMessage("ko")

    @Test
    @Config(qualifiers = "en")
    fun `영어 스낵바 문구는 정해 둔 색으로 뜬다`() = assertEveryMessage("en")

    @Test
    @Config(qualifiers = "ja")
    fun `일본어 스낵바 문구는 정해 둔 색으로 뜬다`() = assertEveryMessage("ja")

    @Test
    @Config(qualifiers = "ja")
    fun `일본어 성공 문구의 부정형 어미를 오류로 읽지 않는다`() {
        assertEquals(MessageSeverity.Success, severity(context.getString(R.string.msg_gb_share_code_regenerated, "カップル")))
        assertEquals(MessageSeverity.Success, severity(context.getString(R.string.msg_gb_subscription_cancel_at_period_end)))
    }

    @Test
    @Config(qualifiers = "en")
    fun `영어 동의 요구와 등록 실패를 성공으로 읽지 않는다`() {
        assertEquals(MessageSeverity.Info, severity(context.getString(R.string.r3misc_consent_required)))
        assertEquals(MessageSeverity.Info, severity(context.getString(R.string.msg_voice_consent_required)))
        assertEquals(MessageSeverity.Error, severity(context.getString(R.string.msg2_code_fail_code_not_found)))
        assertEquals(MessageSeverity.Error, severity(context.getString(R.string.msg2_code_fail_code_already_redeemed_by_you)))
    }

    @Test
    fun `표에 없는 글은 안내로 둔다`() {
        assertEquals(MessageSeverity.Info, severity("12345"))
        assertEquals(MessageSeverity.Info, severity("Voice profile not found"))
    }

    @Test
    fun `한 문구는 한 종류에만 속한다`() {
        val overlaps = (SnackbarSeverities.success intersect SnackbarSeverities.error) +
            (SnackbarSeverities.success intersect SnackbarSeverities.info) +
            (SnackbarSeverities.error intersect SnackbarSeverities.info)
        assertTrue(overlaps.map(::resourceName).toString(), overlaps.isEmpty())
    }

    /**
     * 뷰모델이 스낵바(`message`)에 싣는 문구와 공용 오류 표의 문구는 전부 분류돼 있어야 한다 —
     * 빠지면 그 문구는 말없이 '안내' 색으로 뜬다. 스낵바가 아닌 자리에서 쓰는 문구만 아래에 적는다.
     */
    @Test
    fun `뷰모델과 공용 오류 표가 쓰는 문구는 빠짐없이 분류돼 있다`() {
        val sources = File(SOURCE_ROOT, "ui/main").listFiles { file -> file.name.startsWith("MainViewModel") }!!.toList() +
            File(SOURCE_ROOT, "network/ApiErrorMessages.kt")
        assertTrue(sources.size > 2)
        val classified = (SnackbarSeverities.success + SnackbarSeverities.error + SnackbarSeverities.info)
            .map(::resourceName).toSet() +
            SnackbarSeverities.successPlurals.map(::resourceName)
        val missing = sources.flatMap { file ->
            RESOURCE_REFERENCE.findAll(file.readText()).map { it.groupValues[1] }.toList()
        }.toSet() - classified - NOT_SNACKBAR
        assertTrue("스낵바 색이 정해지지 않은 문구: $missing", missing.isEmpty())
    }

    private fun assertEveryMessage(language: String) {
        val expected = SnackbarSeverities.success.associateWith { MessageSeverity.Success } +
            SnackbarSeverities.error.associateWith { MessageSeverity.Error } +
            SnackbarSeverities.info.associateWith { MessageSeverity.Info }
        val wrong = expected.mapNotNull { (id, severity) ->
            val text = render(id)
            val actual = severity(text)
            if (actual == severity) null else "${resourceName(id)}: $severity 이어야 하는데 $actual — $text"
        }.toMutableList()
        for (id in SnackbarSeverities.successPlurals) {
            for (count in listOf(1, 3)) {
                val text = context.resources.getQuantityString(id, count, count)
                val actual = severity(text)
                if (actual != MessageSeverity.Success) wrong += "${resourceName(id)}($count): $actual — $text"
            }
        }
        assertTrue("$language\n" + wrong.joinToString("\n"), wrong.isEmpty())
    }

    /** 자리표시자에 그럴듯한 값을 넣어 실제로 뜰 글을 만든다. */
    private fun render(id: Int): String {
        val raw = context.resources.getText(id).toString()
        val specs = FORMAT_SPECIFIER.findAll(raw).filter { it.groupValues[2] != "%" }.toList()
        if (specs.isEmpty()) return context.getString(id)
        val args = specs.mapIndexed { index, spec ->
            val position = spec.groupValues[1].toIntOrNull() ?: (index + 1)
            position to if (spec.groupValues[2] == "d") 7 else "Alex"
        }.toMap()
        return context.getString(id, *(1..args.keys.max()).map { args[it] ?: "Alex" }.toTypedArray())
    }

    private fun severity(text: String): MessageSeverity = snackbarSeverity(context, text)

    private fun resourceName(id: Int): String = context.resources.getResourceEntryName(id)

    private companion object {
        const val SOURCE_ROOT = "src/main/java/com/alarmtalk/app"
        val RESOURCE_REFERENCE = Regex("""R\.(?:string|plurals)\.(\w+)""")
        val FORMAT_SPECIFIER = Regex("""%(?:(\d+)\$)?[-#+ 0,(]*\d*(?:\.\d+)?([a-zA-Z%])""")

        /** 뷰모델 소스에 있지만 스낵바에 실리지 않는 문구 — 다른 문구의 인자이거나 화면 안 글이다. */
        val NOT_SNACKBAR = setOf(
            // 가족 알람 전송 라벨(서버에 저장되는 값).
            "msg_family_voice_default_label",
            // 공유 코드 문구의 %1$s 인자.
            "msg_gb_plan_label_couple",
            "msg_gb_plan_label_family",
            "msg_gb_plan_label_shared",
        )
    }
}
