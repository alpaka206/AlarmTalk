package com.alarmtalk.app.ui.voices

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 목소리 등록 확정 화면의 **문구**를 지킨다(2026-09-29 실기기 지시).
 *
 * 지키는 것 셋:
 *  1. **월 등록 한도 경고는 없다.** 제목 아래의 "저장하면 이번 달에 만들 수 있는 목소리를 다
 *     쓰게 돼요…" 는 사용자 승인으로 뺐다 — 리소스째 지웠으니 되살아나면 누군가 다시 넣은 것이다.
 *  2. **교체 안내는 한 줄이다.** 교체일 때만 보이는 본문(`voices_confirm_replace_body`)은
 *     "저장하면 이전 목소리는 삭제돼요." 하나다. 언제 보이는지는 화면(`replaceTargetVoice`)이 가른다.
 *  3. **말투 안내는 첫 문장뿐이다.** "매일 아침 문구가 이 말투로 만들어져요." 를 뺐다.
 *
 * iOS 는 `VoicePreviewConfirmView` 와 `Localizable.xcstrings` 가 같은 문구를 쓴다 — 한쪽만 바꾸면
 * 두 앱이 다른 말을 한다.
 *
 * 리소스를 런타임으로 해석하지 않고 **소스 XML 을 읽는다**(`ShareCodeTextTest` 와 같은 형태) —
 * 로케일마다 설정을 바꿔 가며 띄울 필요 없이 세 벌을 한 번에 본다.
 */
class VoiceRegistrationCopyTest {

    private val dirs = listOf("values", "values-en", "values-ja")

    private fun strings(dir: String): String {
        // 테스트는 app/ 에서 돈다. 모듈 루트 기준 상대 경로.
        val file = File("src/main/res/$dir/strings.xml")
        assertTrue("$dir/strings.xml 을 못 찾았다(경로: ${file.absolutePath})", file.exists())
        return file.readText()
    }

    private fun value(dir: String, name: String): String? =
        Regex("""<string name="$name"[^>]*>(.*?)</string>""", RegexOption.DOT_MATCHES_ALL)
            .find(strings(dir))?.groupValues?.get(1)

    @Test
    fun `확정 화면에 월 등록 한도 경고가 없다`() {
        for (dir in dirs) {
            assertNull("$dir 에 voices_confirm_new_body 가 되살아났다", value(dir, "voices_confirm_new_body"))
        }
    }

    @Test
    fun `교체 안내는 이전 목소리가 삭제된다는 한 줄이다`() {
        assertEquals("저장하면 이전 목소리는 삭제돼요.", value("values", "voices_confirm_replace_body"))
        for (dir in dirs) {
            val text = value(dir, "voices_confirm_replace_body")
            assertTrue("$dir 에 voices_confirm_replace_body 가 없다", !text.isNullOrBlank())
            assertFalse("$dir/voices_confirm_replace_body 가 한 줄이 아니다", text!!.contains("\\n") || text.contains('\n'))
        }
    }

    @Test
    fun `말투 안내는 첫 문장만 남긴다`() {
        assertEquals("말투를 원하는 대로 바꿔 보세요.", value("values", "voices_preview_edit_hint"))
        for (dir in dirs) {
            val text = value(dir, "voices_preview_edit_hint")
            assertTrue("$dir 에 voices_preview_edit_hint 가 없다", !text.isNullOrBlank())
            assertFalse("$dir/voices_preview_edit_hint 에 둘째 문장이 남았다", text!!.contains("\\n") || text.contains('\n'))
        }
    }
}
