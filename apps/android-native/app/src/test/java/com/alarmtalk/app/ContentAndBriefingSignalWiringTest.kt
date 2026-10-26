package com.alarmtalk.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 콘텐츠·소식 사용 기록의 **배선**(`docs/spec/usage-events.md` §7.1). `MainViewModel` 과 화면은 단위 테스트로 세울 수 없어
 * 소스로 본다([readSource]).
 */
class ContentAndBriefingSignalWiringTest {
    @Test
    fun `응원 선택은 저장 성공 갈래에서만 적고 시작한 계정으로 적는다`() {
        val source = withoutLineComments(readSource("ui/main/MainViewModelAlarmActions.kt"))
        listOf("internal fun MainViewModel.createAlarm(", "internal fun MainViewModel.updateAlarm(").forEach { signature ->
            val body = functionBody(source, signature)
            assertEquals("$signature 에서 한 번만 적는다", 1, Regex("recordContentSelected\\(").findAll(body).count())
            val success = braceBlock(body, ".onSuccess { saved ->")
            assertTrue("$signature 의 성공 갈래가 적어야 한다", success.contains("recordContentSelected(getApplication(), saved, ownerUserId)"))
            val failure = braceBlock(body, ".onFailure { error ->")
            assertFalse("$signature 의 실패 갈래는 적지 않는다", failure.contains("recordContentSelected"))
            // 계정은 비동기 저장을 **시작하기 전에** 잡는다.
            assertTrue(body.indexOf("val ownerUserId = authSession?.user?.id") in 0 until body.indexOf("viewModelScope.launch"))
        }
        // 편집기(화면)는 적지 않는다 — 눌러만 보고 취소한 것은 기록이 아니다.
        assertFalse(readSource("ui/editor/AlarmEditorScreen.kt").contains("CONTENT_SELECTED"))
        assertFalse(readSource("ui/editor/AlarmRandomPromptSettings.kt").contains("recordContentSelected"))
    }

    @Test
    fun `팩 사용은 저장 성공 갈래에서만 응원 선택 옆에서 시작한 계정으로 적는다`() {
        val source = withoutLineComments(readSource("ui/main/MainViewModelAlarmActions.kt"))
        listOf("internal fun MainViewModel.createAlarm(", "internal fun MainViewModel.updateAlarm(").forEach { signature ->
            val body = functionBody(source, signature)
            assertEquals("$signature 에서 한 번만 적는다", 1, Regex("recordPackSelected\\(").findAll(body).count())
            val success = braceBlock(body, ".onSuccess { saved ->")
            assertTrue(
                "$signature 의 성공 갈래가 응원 선택 바로 옆에서 적어야 한다",
                success.contains(
                    "recordContentSelected(getApplication(), saved, ownerUserId)\n" +
                        "            com.alarmtalk.app.data.recordPackSelected(getApplication(), saved, ownerUserId)",
                ),
            )
            assertFalse("$signature 의 실패 갈래는 적지 않는다", braceBlock(body, ".onFailure { error ->").contains("recordPackSelected"))
        }
        assertFalse("편집기는 적지 않는다", readSource("ui/editor/AlarmEditorScreen.kt").contains("PACK_SELECTED"))
    }

    @Test
    fun `소식 기록은 링크·제목·문장을 넘기지 않는다`() {
        val source = withoutLineComments(readSource("ui/briefing/BriefingScreen.kt"))
        val opened = Regex("BriefingSignals\\.sourceOpened\\(([^)]*)\\)").findAll(source).map { it.groupValues[1] }.toList()
        assertEquals("공시·정책뉴스 두 줄에서 적는다", 2, opened.size)
        opened.forEach { args ->
            assertFalse("원문 링크를 넘기지 않는다: $args", args.contains("url"))
            assertTrue(args.contains("BriefingSource."))
        }
        assertEquals(1, Regex("BriefingSignals\\.opened\\(context\\)").findAll(source).count())
        val requested = Regex("BriefingSignals\\.audioRequested\\(([^)]*)\\)").findAll(source).map { it.groupValues[1] }.toList()
        assertEquals(listOf("context, target.source, chosen"), requested)
        // 요청을 보내기 전에 적는다 — 실패해도 '요청했다' 는 남는다.
        val generate = functionBody(source, "fun generate()")
        assertTrue(generate.indexOf("BriefingSignals.audioRequested") in 0 until generate.indexOf("onGenerateSpeech("))
    }

    /** [marker] 에서 시작하는 첫 중괄호 블록(람다 하나). */
    private fun braceBlock(source: String, marker: String): String {
        val start = source.indexOf(marker)
        assertTrue("`$marker` 를 못 찾았다.", start >= 0)
        val open = source.indexOf('{', start)
        var depth = 0
        for (i in open until source.length) {
            when (source[i]) {
                '{' -> depth += 1
                '}' -> {
                    depth -= 1
                    if (depth == 0) return source.substring(start, i + 1)
                }
            }
        }
        return source.substring(start)
    }
}
