package com.alarmtalk.app

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.alarmtalk.app.data.AlarmAudioStore
import com.alarmtalk.app.data.ReusableTtsAudio
import java.io.File
import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.Runnable
import kotlinx.coroutines.cancel
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * 저장 버튼의 **로컬 확인**(같은 문구의 오디오가 폰에 있는가)은 메인 밖에서, 저장 잠금 안에서 한다
 * (`docs/spec/alarm-editor.md` §6, 2026-10-10 Sentry 조사).
 *
 * 고치기 전에는 저장을 누르는 순간 별칭 `.meta` 읽기·파일 찾기·`MediaMetadataRetriever` 길이 재기가 메인
 * 스레드에서 돌았고, 오프라인이면 저장 사유를 셀 때마다(화면이 다시 그려질 때마다) 같은 파일을 또 읽었다.
 * 여기서는 **몇 번·어디서·잠금**을 본다([ManualAudioReuseGate]) — 알람 관문(`DefaultVoiceGateTest`)과 같은 모양이다.
 * 편집기가 그 문을 실제로 쓰는지는 소스 배선으로 본다(이 모듈에는 Compose UI 테스트 하네스가 없다).
 *
 * (Robolectric 인 이유: 찾다 실패하는 갈래가 `AlarmTalkLog` → `android.util.Log` 를 부르고, 캐시 히트는 진짜
 * `AlarmAudioStore` 로 본다.)
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ManualAudioReuseGateTest {

    private val context: Context = ApplicationProvider.getApplicationContext()

    /** IO 로 **실제로 넘겼는가**를 센다 — 같은 디스패처면 `withContext` 가 넘기지 않으므로 이 수가 0 이다. */
    private class CountingDispatcher(private val delegate: CoroutineDispatcher) : CoroutineDispatcher() {
        var dispatches = 0
        override fun dispatch(context: CoroutineContext, block: Runnable) {
            dispatches += 1
            delegate.dispatch(context, block)
        }
    }

    private class Recorder {
        var lookups = 0
        var found = 0
        var missing = 0
    }

    private fun TestScope.gate(io: CoroutineDispatcher = StandardTestDispatcher(testScheduler)) =
        ManualAudioReuseGate(scope = this, ioDispatcher = io)

    private fun ManualAudioReuseGate.tap(recorder: Recorder, result: String?): Boolean = request(
        lookup = {
            recorder.lookups += 1
            result
        },
        onFound = { recorder.found += 1 },
        onMissing = { recorder.missing += 1 },
    )

    @Test
    fun tapsWhileALookupIsInFlightAreDroppedNotStacked() = runTest {
        val gate = gate()
        val recorder = Recorder()

        // 찾는 사이 세 번 누른다.
        assertTrue(gate.tap(recorder, "cached"))
        assertFalse("찾는 동안 들어온 탭은 버린다", gate.tap(recorder, "cached"))
        assertFalse(gate.tap(recorder, "cached"))
        assertTrue("찾는 동안이 곧 '저장 중' 이다(편집기의 busy 가 이 값을 본다)", gate.inFlight)

        advanceUntilIdle()

        assertEquals("세 번 눌러도 찾은 것은 한 번이다", 1, recorder.lookups)
        assertEquals("저장은 한 번이다 — 두 번 저장·두 번 팝(검은 화면)이 없다", 1, recorder.found)
        assertEquals(0, recorder.missing)
        assertFalse(gate.inFlight)

        // 끝난 뒤의 탭은 다시 받는다.
        assertTrue(gate.tap(recorder, null))
        advanceUntilIdle()
        assertEquals(2, recorder.lookups)
        assertEquals(1, recorder.missing)
    }

    @Test
    fun theLookupRunsOnTheInjectedIoDispatcher() = runTest {
        val io = CountingDispatcher(StandardTestDispatcher(testScheduler))
        val gate = gate(io)
        val recorder = Recorder()

        gate.tap(recorder, "cached")
        assertEquals("누른 자리에서 곧바로 찾지 않는다", 0, recorder.lookups)

        advanceUntilIdle()

        assertTrue("찾는 일은 IO 디스패처로 넘겼다", io.dispatches > 0)
        assertEquals(1, recorder.lookups)
        assertEquals(1, recorder.found)
    }

    /** 결과를 적용한 **뒤에** 잠금을 내린다 — 적용이 뷰모델 저장 중을 세우므로 busy 가 끊기지 않는다. */
    @Test
    fun theLockIsStillHeldWhileTheResultIsApplied() = runTest {
        val gate = gate()
        val heldDuringApply = mutableListOf<Boolean>()

        gate.request(lookup = { "cached" }, onFound = { heldDuringApply += gate.inFlight }, onMissing = {})
        gate.request<String>(lookup = { null }, onFound = {}, onMissing = { heldDuringApply += gate.inFlight })
        advanceUntilIdle()
        gate.request<String>(lookup = { null }, onFound = {}, onMissing = { heldDuringApply += gate.inFlight })
        advanceUntilIdle()

        assertEquals(listOf(true, true), heldDuringApply)
        assertFalse(gate.inFlight)
    }

    /** 찾다 실패하면 '없다' 로 본다 — 서버 경로가 다시 만들고, 잠금은 풀린다(갇히면 저장을 영영 못 한다). */
    @Test
    fun aFailingLookupIsTreatedAsMissingAndReleasesTheLock() = runTest {
        val gate = gate()
        val recorder = Recorder()

        gate.request<String>(
            lookup = { error("disk unavailable") },
            onFound = { recorder.found += 1 },
            onMissing = { recorder.missing += 1 },
        )
        advanceUntilIdle()

        assertEquals(0, recorder.found)
        assertEquals(1, recorder.missing)
        assertFalse(gate.inFlight)
        assertTrue(gate.tap(recorder, "cached"))
    }

    /** 편집기가 사라지면(화면 스코프 취소) 결과를 적용하지 않는다 — 떠난 편집기가 저장하거나 팝하지 않는다. */
    @Test
    fun aClosedEditorAppliesNothing() = runTest {
        val editorScope = CoroutineScope(StandardTestDispatcher(testScheduler) + Job())
        val gate = ManualAudioReuseGate(scope = editorScope, ioDispatcher = StandardTestDispatcher(testScheduler))
        val recorder = Recorder()

        gate.tap(recorder, "cached")
        editorScope.cancel()
        advanceUntilIdle()

        assertEquals(0, recorder.found)
        assertEquals(0, recorder.missing)
    }

    // ── 진짜 캐시로 — 같은 문구의 오디오가 폰에 있으면 서버 없이 저장한다 ────────────────────────

    private val store = AlarmAudioStore(context)
    private val inputKey = AlarmAudioStore.ttsInputKey(
        userId = "user-a",
        profileId = "voice-1",
        text = "일어나 규원아",
        category = "custom",
        language = "ko",
        listenerTitle = null,
    )

    private fun cacheServerAudio(serverKey: String) {
        store.cacheGeneratedAudio(
            bytes = ByteArray(2 * 1024) { 3 },
            format = "mp3",
            rawAudioUri = "https://r2.example/$serverKey.mp3",
            cacheKey = serverKey,
            messageId = "message-$serverKey",
        )
        store.linkTtsInput(inputKey, serverKey, "일어나 규원아")
    }

    @Test
    fun aCachedManualAudioSavesWithoutAServerCall() = runTest {
        cacheServerAudio("server-key-hit")
        val gate = gate()
        val saved = mutableListOf<ReusableTtsAudio>()
        var serverCalls = 0

        gate.request(
            lookup = { store.findReusableTtsAudio(inputKey, rawAudioUri = null) },
            onFound = { saved += it },
            onMissing = { serverCalls += 1 },
        )
        advanceUntilIdle()

        assertEquals("서버를 부르지 않는다(한도도 깎이지 않는다)", 0, serverCalls)
        assertEquals(1, saved.size)
        assertEquals("server-key-hit", saved.single().audio.cacheKey)
        assertEquals("message-server-key-hit", saved.single().audio.messageId)
        assertEquals("일어나 규원아", saved.single().alias.displayText)
    }

    /** 별칭이 있어도 **파일이 없으면 없는 것**이다 — 별칭 파일은 오디오와 함께 지워지지 않는다. */
    @Test
    fun anAliasWithoutItsAudioIsMissing() = runTest {
        cacheServerAudio("server-key-gone")
        store.deleteCachedAudio("server-key-gone")
        val gate = gate()
        var missing = 0

        gate.request(
            lookup = { store.findReusableTtsAudio(inputKey, rawAudioUri = null) },
            onFound = {},
            onMissing = { missing += 1 },
        )
        advanceUntilIdle()

        assertEquals(1, missing)
        assertNull(store.findReusableTtsAudio(inputKey, rawAudioUri = null))
    }

    // ── 배선 — 편집기가 그 문을 쓰는가 ─────────────────────────────────────────────

    private val editorSource: String by lazy { readSource("ui/editor/AlarmEditorScreen.kt") }

    /** 저장 잠금(`busy`)이 로컬 확인을 포함한다 — 빼면 찾는 사이의 탭이 쌓인다. */
    @Test
    fun theSaveLockIncludesTheLookup() {
        assertTrue(editorSource.contains("val busy = manualAudioReuse.inFlight || generating || saving"))
    }

    @Test
    fun saveEditorLooksUpThroughTheGateAndChecksOfflineAfterIt() {
        val body = withoutLineComments(functionBody(editorSource, "    fun saveEditor()"))
        assertTrue(body.contains("manualAudioReuse.request("))
        assertTrue(body.contains("audioStore.findReusableTtsAudio("))
        // 누르는 자리에서 파일을 읽지 않는다.
        assertFalse("저장 버튼이 메인에서 별칭을 읽는다", body.contains("audioStore.resolveTtsInput("))
        assertFalse("저장 버튼이 메인에서 길이를 잰다", body.contains("audioStore.getCachedAudio("))
        // 오프라인 판정은 로컬 확인이 '없다' 고 답한 뒤(onMissing)에, 생성보다 먼저.
        assertTrue(body.contains("onMissing = missing@{"))
        val onMissing = body.substringAfter("onMissing = missing@{")
        val offline = onMissing.indexOf("SaveBlockReason.OFFLINE_NEW_MESSAGE")
        val generation = onMissing.indexOf("startGeneration()")
        assertTrue(offline >= 0 && generation > offline)
        // 생성은 시작하는 순간 잠근다 — 로컬 확인의 잠금이 그 뒤에 내려가도 busy 가 끊기지 않는다.
        val startGeneration = functionBody(body, "fun startGeneration()")
        assertTrue(
            startGeneration.indexOf("generating = true") in 0 until startGeneration.indexOf("scope.launch"),
        )
    }

    /**
     * 찾는 동안 잠기는 것은 저장 버튼뿐이다 — 그 사이 시각·문구·목소리를 고치면, 결과는 누른 순간의 값으로 찾은
     * 것인데 저장은 바뀐 상태로 나간다(Codex #879). 누른 순간의 초안을 잡고, 두 결과 모두 **맨 먼저** 그 초안과
     * 지금 초안을 견줘 다르면 아무것도 하지 않아야 한다(이어 붙이거나 생성을 시작하기 전에).
     */
    @Test
    fun aLookupResultIsDroppedWhenTheEditorChangedMeanwhile() {
        val body = withoutLineComments(functionBody(editorSource, "    fun saveEditor()"))
        val captured = body.indexOf("val draftAtTap = editor.toDraft()")
        assertTrue("누른 순간의 초안을 잡지 않는다", captured >= 0)
        assertTrue(captured < body.indexOf("manualAudioReuse.request("))
        val guard = "if (editor.toDraft() != draftAtTap) return@"
        val onFound = body.substringAfter("onFound = found@{ reusable ->")
        assertTrue(onFound.trimStart().startsWith(guard + "found"))
        val onMissing = body.substringAfter("onMissing = missing@{")
        assertTrue(onMissing.trimStart().startsWith(guard + "missing"))
    }

    /** 저장 사유는 화면이 다시 그려질 때마다 계산된다 — 파일을 읽으면 안 된다. */
    @Test
    fun theSaveBlockReasonReadsNoFiles() {
        val start = editorSource.indexOf("val editorSaveBlockReason")
        assertTrue(start >= 0)
        val open = editorSource.indexOf('{', start)
        var depth = 0
        var end = open
        for (i in open until editorSource.length) {
            when (editorSource[i]) {
                '{' -> depth += 1
                '}' -> {
                    depth -= 1
                    if (depth == 0) {
                        end = i
                        break
                    }
                }
            }
        }
        val reason = withoutLineComments(editorSource.substring(start, end + 1))
        listOf("resolveTtsInput(", "hasCachedAudio(", "getCachedAudio(", "findReusableTtsAudio(", "manualAudioReadyLocally(")
            .forEach { call -> assertFalse("저장 사유가 $call 를 부른다", reason.contains(call)) }
        assertFalse(editorSource.contains("fun manualAudioReadyLocally("))
    }

    /** 저장 버튼과 저장 흐름은 같은 표로 말한다 — 오프라인 알럿의 문구가 자리마다 갈리지 않는다. */
    @Test
    fun bothAlertSitesShareOneTable() {
        val (title, message) = saveBlockAlertStrings(SaveBlockReason.OFFLINE_NEW_MESSAGE, familyAlarmMode = false)
        assertEquals(R.string.editor_block_offline_title, title)
        assertEquals(R.string.editor_block_offline_message, message)
        assertEquals(
            R.string.editor_block_weather_family_message,
            saveBlockAlertStrings(SaveBlockReason.WEATHER_LOCATION_MISSING, familyAlarmMode = true).second,
        )
        // 표는 한 곳뿐이다.
        assertEquals(1, Regex("R\\.string\\.editor_block_offline_title").findAll(editorSource).count())
    }

    @org.junit.After
    fun cleanAudio() {
        File(context.filesDir, "alarm-audio").listFiles()?.forEach { it.delete() }
    }
}
