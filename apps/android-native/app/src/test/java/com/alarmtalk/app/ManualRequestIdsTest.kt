package com.alarmtalk.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** 직접 입력 '음성 만들기' 의 같은 요청 id(`docs/spec/voice-and-message.md` §8 「같은 요청」, Codex #942). */
class ManualRequestIdsTest {
    @Test
    fun sameInputRetriesKeepTheIdAndNewInputGetsANewOne() {
        val ids = ManualRequestIds()
        val first = ids.idFor("v1", "ko", "회의 자료 챙겨")
        assertEquals("응답이 끊겨 다시 눌러도 같은 id", first, ids.idFor("v1", "ko", "회의 자료 챙겨"))
        assertNotEquals("문구가 바뀌면 새 요청", first, ids.idFor("v1", "ko", "약 먹어"))
        assertNotEquals("목소리가 바뀌어도 새 요청", ids.idFor("v1", "ko", "약 먹어"), ids.idFor("v2", "ko", "약 먹어"))
    }

    @Test
    fun aSuccessForgetsTheId() {
        val ids = ManualRequestIds()
        val first = ids.idFor("v1", "ko", "일어나")
        ids.completed()
        assertNotEquals("성공한 뒤의 만들기는 새 요청", first, ids.idFor("v1", "ko", "일어나"))
    }

    // ── 배선 — id 는 편집기보다 오래 산다(스펙 §8 「같은 요청」, 2026-10-29) ─────────────────────

    @Test
    fun theEditorUsesTheViewModelsIdsSoLeavingMidGenerationDoesNotChargeTwice() {
        val editor = withoutLineComments(readSource("ui/editor/AlarmEditorScreen.kt"))
        assertFalse(
            "편집기가 id 를 스스로 만들면 만드는 중에 나갔다 돌아올 때 새 id 라 서버가 한 번 더 센다",
            editor.contains("ManualRequestIds()"),
        )
        assertTrue(editor.contains("manualRequestIds: ManualRequestIds,"))
        val app = withoutLineComments(readSource("ui/app/AlarmTalkApp.kt"))
        assertTrue(app.contains("manualRequestIds = viewModel.manualRequestIds,"))
    }

    @Test
    fun anAccountSwitchForgetsTheId() {
        val viewModel = withoutLineComments(readSource("ui/main/MainViewModel.kt"))
        assertTrue(viewModel.contains("internal val manualRequestIds = ManualRequestIds()"))
        val clear = functionBody(viewModel, "fun clearUserScopedRemoteState(")
        assertTrue(clear.contains("manualRequestIds.completed()"))
    }
}
