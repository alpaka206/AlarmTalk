package com.alarmtalk.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * **저장을 누른 뒤 찾거나 만드는 사이에 바꾼 것은 그 값으로 저장한다**(2026-10-29 오너 "저장을 누르면 바뀐걸로 되어야").
 *
 * 저장을 누르면 잠기는 것은 저장·취소 버튼뿐이라, 음성을 만드는 몇 초 동안 목소리·문구·시각을 그대로 고칠 수 있다. 예전에는
 * 생성이 끝나면 **누른 순간의** 목소리·문구로 덮어 저장했고(로컬 확인 갈래는 아무것도 안 하고 버렸고), 시각을 바꾸면 생성을
 * 취소했다. 이제 결과는 폰에 두고 지금 화면 값으로 저장을 다시 돈다 — 같은 입력이면 폰의 결과를 다시 써서 더 세지 않는다.
 * 초안이 뷰모델로 넘어간 뒤(마지막 저장)에는 편집기 입력을 막는다 — 그때 바꾼 것은 저장되지 않은 채 편집기만 닫힌다.
 *
 * 편집기는 Compose 화면이라 이 모듈에서 세울 수 없다(`SourceWiring`) — 판정이 그 자리에 있는가를 소스로 본다. 실제로 바꾼 값이
 * 저장되는지는 실기기로 본다(`docs/spec/alarm-editor.md` §6).
 */
class EditorResaveAfterChangeWiringTest {
    private val editor = withoutLineComments(readSource("ui/editor/AlarmEditorScreen.kt"))

    @Test
    fun 생성이_끝났을_때_바뀌었으면_누른_순간_값으로_덮지_않고_다시_저장한다() {
        val start = functionBody(editor, "fun startGeneration(")
        assertTrue(start.contains("val draftAtStart = editor.toDraft()"))
        val check = start.indexOf("if (editor.toDraft() != draftAtStart)")
        val apply = start.indexOf("editor.setGeneratedTtsAudio(")
        assertTrue("결과를 잇기 전에 바뀌었는지 본다", check in 0 until apply)
        assertTrue(start.substring(check, apply).contains("resaveAfterChange = true"))
    }

    @Test
    fun 테마_클립은_받는_사이_바뀌었으면_묶지_않고_다시_저장한다() {
        val bind = editor.indexOf("suspend fun bindStockBucketClips(")
        val guard = editor.indexOf("if (!applyIf()) return false", bind)
        val apply = editor.indexOf("editor.setBucketAudio(", bind)
        assertTrue("묶기 직전에 확인한다", bind >= 0 && guard in bind until apply)
        val start = functionBody(editor, "fun startGeneration(")
        assertTrue(start.contains("applyIf = { (editor.toDraft() == draftAtStart)"))
        assertTrue(start.contains("if (changedMeanwhile) {"))
    }

    @Test
    fun 로컬_확인_중_바뀌었으면_버리지_않고_다시_저장한다() {
        val save = functionBody(editor, "fun saveEditor(")
        val resave = Regex("""if \(editor\.toDraft\(\) != draftAtTap\) \{\s*resaveAfterChange = true""")
        assertEquals("찾았다·없다 두 갈래 모두", 2, resave.findAll(save).count())
    }

    @Test
    fun 다시_저장은_잠금이_풀린_뒤_지금의_saveEditor_로_돈다() {
        val effect = editor.indexOf("LaunchedEffect(resaveAfterChange, busy)")
        assertTrue(effect >= 0)
        val body = editor.substring(effect, editor.indexOf('}', editor.indexOf("saveEditor()", effect)) + 1)
        assertTrue(body.contains("if (resaveAfterChange && !busy)"))
        assertTrue(body.contains("saveEditor()"))
    }

    /** 다시 저장도 누르는 순간과 같은 차단 검사를 지난다 — 바꾼 사이 날짜 알람의 시각이 지났거나 지역이 빠졌으면 이유를 말한다. */
    @Test
    fun 다시_저장도_누를_때와_같은_차단_검사를_지난다() {
        val effect = editor.indexOf("LaunchedEffect(resaveAfterChange, busy)")
        val body = editor.substring(effect, editor.indexOf("\n    }\n", effect))
        assertTrue(
            "다시 저장이 차단 검사를 건너뛴다",
            body.contains("datedSaveBlockReason(editor, otherAlarmTimes) ?: editorSaveBlockReason"),
        )
        assertTrue(body.contains("if (reason == null) saveEditor() else showSaveBlockAlert(reason)"))
        assertTrue("사유 판정보다 앞에 두면 그 값을 볼 수 없다", effect > editor.indexOf("val editorSaveBlockReason: SaveBlockReason?"))
    }

    @Test
    fun 시각을_바꿔도_만드는_중인_음성을_취소하지_않는다() {
        val effect = editor.indexOf("LaunchedEffect(editor.hour, editor.minute)")
        assertTrue(effect >= 0)
        val body = editor.substring(effect, editor.indexOf("\n    }\n", effect))
        assertFalse("취소하면 서버가 이미 센 생성을 잃고 다시 눌러야 한다", body.contains("generationJob"))
    }

    @Test
    fun 뷰모델이_저장하는_동안에는_편집기_입력을_막는다() {
        val overlay = editor.indexOf("if (saving) {")
        assertTrue(overlay >= 0)
        assertTrue(editor.indexOf("awaitPointerEvent(PointerEventPass.Initial).changes.forEach { it.consume() }", overlay) > overlay)
        assertTrue(editor.contains("if (saving) focusManager.clearFocus()"))
    }
}
