package com.alarmtalk.app.data

import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 계정 설정 올리기는 **한 번에 하나씩, 부른 순서대로**다(`PromptSettingsUploadQueue`, Codex #837).
 *
 * 지역을 고르고 곧바로 운세를 고치면 설정 전체를 실은 요청이 둘 뜬다. 겹쳐 돌면 먼저 부른(옛) 요청이
 * 늦게 끝나 서버·세션을 옛 값으로 되돌리고, 받아 적기가 '안 올라간 변경' 표시 없이 그 옛 값을 이 기기에
 * 적는다 — 방금 고친 값이 조용히 사라진다.
 */
class PromptSettingsUploadQueueTest {
    @Test
    fun 먼저_부른_요청이_느려도_뒤_요청은_그다음에_보내고_끝난다() = runTest {
        val queue = PromptSettingsUploadQueue()
        val events = mutableListOf<String>()

        launch {
            queue.enqueue {
                events += "send:region"
                delay(500) // 느린 망
                events += "done:region"
            }
        }
        launch {
            queue.enqueue {
                events += "send:region+fortune"
                delay(10)
                events += "done:region+fortune"
            }
        }
        advanceUntilIdle()

        assertEquals(
            listOf("send:region", "done:region", "send:region+fortune", "done:region+fortune"),
            events,
        )
    }

    @Test
    fun 앞_요청이_실패해도_뒤_요청은_간다() = runTest {
        val queue = PromptSettingsUploadQueue()
        val sent = mutableListOf<String>()

        launch { runCatching { queue.enqueue { sent += "first"; error("offline") } } }
        launch { queue.enqueue { sent += "second" } }
        advanceUntilIdle()

        assertEquals(listOf("first", "second"), sent)
    }
}
