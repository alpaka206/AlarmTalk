package com.alarmtalk.app.ui.voices

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 목소리 등록 확정 화면의 **문구**를 지킨다(2026-09-29 실기기 지시, 2026-10-08 사용자 정리 — 스펙 voice-and-message §4-1·§4-3).
 *
 * 지키는 것:
 *  1. **월 등록 한도 경고는 없다.** 제목 아래의 "저장하면 이번 달에 만들 수 있는 목소리를 다
 *     쓰게 돼요…" 는 사용자 승인으로 뺐다 — 리소스째 지웠으니 되살아나면 누군가 다시 넣은 것이다.
 *  2. **교체는 체크 없이 한 줄이다.** 교체일 때만 보이는 `voices_confirm_replace_body` 가 "이전에 저장한 목소리는
 *     삭제하고 이 목소리로 등록할게요." 하나다(제목 크기, 체크 상자·설명 없음). ''○○' 대신 이 목소리를 써요' 체크와
 *     그 설명은 뺐다. 언제 보이는지는 화면(`registrationReplaceTarget`)이 가른다.
 *  3. **말투 안내는 첫 문장뿐이다.** "매일 아침 문구가 이 말투로 만들어져요." 를 뺐다. 자리는 제목 바로 아래다.
 *  4. **톤 카드는 `톤 조절` · 막대 · `원본 듣기`/`현재 톤 듣기` 뿐이다.** 설명 글·'추천값'·'0으로'·문구 옆 재생 버튼의
 *     문구는 리소스째 지웠다.
 *  5. **안내·오류는 화면에 있는 것을 가리킨다.** 문구 재시도 안내는 톤 카드의 듣기 버튼을, 높이 오류는 `톤` 을 말한다.
 *     청취 확인 실패는 재생 실패와 다른 말이다(소리는 끝까지 났다).
 *
 * iOS 는 `VoicePreviewConfirmView` 와 `Localizable.xcstrings` 가 같은 문구를 쓴다 — 한쪽만 바꾸면
 * 두 앱이 다른 말을 한다.
 *
 * 리소스를 런타임으로 해석하지 않고 **소스 XML 을 읽는다**(`ShareCodeTextTest` 와 같은 형태) —
 * 로케일마다 설정을 바꿔 가며 띄울 필요 없이 세 벌을 한 번에 본다.
 */
class VoiceRegistrationCopyTest {

    @Test
    fun `생성 안내 줄바꿈과 생체정보 동의의 세 문단을 보존한다`() {
        for (dir in dirs) {
            for (key in listOf("voices_prerender_ready_body", "voices_creating_body", "voices_register_biometric_desc")) {
                assertFalse("$dir/$key", value(dir, key)!!.contains('\n'))
            }
            assertEquals("$dir 동의 문단", 3, value(dir, "voices_register_biometric_desc")!!.split("\\n").size)
        }
        assertEquals("Grandchild", value("values-en", "voices2_relationship_grandson"))
        assertEquals("孫", value("values-ja", "voices2_relationship_grandson"))
    }

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

    private fun assertSingleLine(dir: String, name: String) {
        val text = value(dir, name)
        assertTrue("$dir 에 $name 이 없다", !text.isNullOrBlank())
        assertFalse("$dir/$name 이 한 줄이 아니다", text!!.contains("\\n") || text.contains('\n'))
    }

    @Test
    fun `확정 화면에 월 등록 한도 경고가 없다`() {
        for (dir in dirs) {
            assertNull("$dir 에 voices_confirm_new_body 가 되살아났다", value(dir, "voices_confirm_new_body"))
        }
    }

    @Test
    fun `교체 안내는 체크 없는 한 줄이다`() {
        assertEquals("이전에 저장한 목소리는 삭제하고 이 목소리로 등록할게요.", value("values", "voices_confirm_replace_body"))
        assertEquals(
            "Your saved voice will be deleted and this voice will be registered instead.",
            value("values-en", "voices_confirm_replace_body"),
        )
        assertEquals("保存した声は削除して、この声で登録します。", value("values-ja", "voices_confirm_replace_body"))
        for (dir in dirs) {
            assertSingleLine(dir, "voices_confirm_replace_body")
            // 체크 카드('○○' 대신 이 목소리를 써요)와 그 설명은 뺐다 — 되살아나면 교체를 다시 묻는 것이다.
            assertNull("$dir 에 voices_replace_existing_title 이 되살아났다", value(dir, "voices_replace_existing_title"))
            assertNull("$dir 에 voices_replace_existing_desc 가 되살아났다", value(dir, "voices_replace_existing_desc"))
        }
    }

    @Test
    fun `말투 안내는 첫 문장만 남긴다`() {
        assertEquals("말투를 원하는 대로 바꿔 보세요.", value("values", "voices_preview_edit_hint"))
        for (dir in dirs) {
            assertSingleLine(dir, "voices_preview_edit_hint")
        }
    }

    @Test
    fun `문구 재시도 안내는 톤 카드의 듣기 버튼을 가리킨다`() {
        // 문구 옆 재생 버튼('미리듣기')은 뺐다 — 다시 받는 길은 톤 카드의 `원본 듣기`·`현재 톤 듣기` 다.
        assertEquals("문구를 아직 준비하지 못했어요. 듣기 버튼을 눌러 다시 시도해 주세요.", value("values", "voices_preview_text_retry_hint"))
        assertEquals(
            "The line isn\\'t ready yet. Tap a play button to try again.",
            value("values-en", "voices_preview_text_retry_hint"),
        )
        assertEquals(
            "フレーズをまだ準備できていません。再生ボタンを押してもう一度お試しください。",
            value("values-ja", "voices_preview_text_retry_hint"),
        )
    }

    @Test
    fun `청취 확인 실패는 재생 실패와 다른 말이다`() {
        // 소리는 끝까지 났고 서버 확인만 안 됐다 — iOS 와 같은 문구(`VoiceStudioViewModel.confirmDraftPreviewListened`).
        assertEquals("미리듣기 확인에 실패했어요. 다시 들어 주세요.", value("values", "voices_preview_confirm_failed"))
        assertEquals("Could not confirm the preview. Please listen again.", value("values-en", "voices_preview_confirm_failed"))
        assertEquals("プレビューを確認できませんでした。もう一度お聞きください。", value("values-ja", "voices_preview_confirm_failed"))
    }

    @Test
    fun `높이 오류 문구는 화면의 이름(톤)을 쓴다`() {
        // 카드 이름이 '목소리 높이' 에서 `톤 조절` 로 바뀌었다(2026-10-08 사용자) — 같은 화면의 저장 오류가 옛 이름을 쓰면
        // 없는 컨트롤을 가리킨다. 오류 코드(INVALID_VOICE_PITCH·VOICE_PITCH_LOCKED)는 그대로다.
        assertEquals("톤 값이 올바르지 않아요. 다시 맞춰 주세요.", value("values", "api_error_invalid_voice_pitch"))
        assertEquals("톤은 목소리를 등록할 때만 정할 수 있어요.", value("values", "api_error_voice_pitch_locked"))
        assertEquals(
            "The tone value isn\\'t valid. Please adjust it and try again.",
            value("values-en", "api_error_invalid_voice_pitch"),
        )
        assertEquals("Tone can only be set when you register a voice.", value("values-en", "api_error_voice_pitch_locked"))
        assertEquals("トーンの値が正しくありません。調整し直してください。", value("values-ja", "api_error_invalid_voice_pitch"))
        assertEquals("トーンは声を登録するときにだけ設定できます。", value("values-ja", "api_error_voice_pitch_locked"))
    }

    @Test
    fun `톤 카드는 제목과 두 듣기 버튼뿐이다`() {
        assertEquals("톤 조절", value("values", "voices_tuning_title"))
        assertEquals("Tone", value("values-en", "voices_tuning_title"))
        assertEquals("トーン調整", value("values-ja", "voices_tuning_title"))
        assertEquals("원본 듣기", value("values", "voices_tuning_listen_original"))
        assertEquals("Play original", value("values-en", "voices_tuning_listen_original"))
        assertEquals("元の声を聞く", value("values-ja", "voices_tuning_listen_original"))
        assertEquals("현재 톤 듣기", value("values", "voices_tuning_listen_current"))
        assertEquals("Play current tone", value("values-en", "voices_tuning_listen_current"))
        assertEquals("今のトーンで聞く", value("values-ja", "voices_tuning_listen_current"))
        // 값 표시("−1.5 반음")는 그대로 둔다.
        assertEquals("%1\$s 반음", value("values", "voices_tuning_pitch_value"))
        for (dir in dirs) {
            for (removed in listOf(
                // 설명 글·'추천값'·'0으로'·진행 문구, 옛 제목 '목소리 높이'.
                "voices_tuning_desc",
                "voices_tuning_suggested",
                "voices_tuning_reset",
                "voices_tuning_analyzing",
                "voices_tuning_rendering",
                "voices_tuning_pitch",
                // 문구 카드 옆 재생 버튼(재생은 톤 카드의 두 버튼이 한다).
                "voices_confirm_new_preview",
            )) {
                assertNull("$dir 에 $removed 가 되살아났다", value(dir, removed))
            }
        }
    }
}
