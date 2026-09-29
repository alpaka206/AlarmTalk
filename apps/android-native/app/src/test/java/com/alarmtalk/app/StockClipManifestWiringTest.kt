package com.alarmtalk.app

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.alarmtalk.app.data.StockClipManifestStore
import com.alarmtalk.app.network.StockClip
import com.alarmtalk.app.network.StockClipListResponse
import java.io.File
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * 매니페스트를 **받는 곳은 뷰모델 안에 하나**이고, 그곳은 언제나 표·세대 가드를 거친다 —
 * 그리고 디스크 읽기·쓰기는 메인 밖이다(2026-09-29 효율 감사 M1·M2·M4).
 *
 * 고치기 전에는 준비도(`refreshClipReadiness`)와 클론 다운로드(`downloadAllPresetClips`)가
 * 매니페스트를 **직접** 받아 표 없이 `stockClips` 를 덮었다 — Codex #703 가드의 우회로였고,
 * 콜드 스타트 요청이 불어난 원인이었다. 공개(`save`)와 파싱(`load`)은 메인에서 돌며 워커와
 * 같은 잠금을 잡았다.
 *
 * `MainViewModel` 은 암호화 저장소·Room·워커를 통째로 물고 있어 단위 테스트에서 세울 수 없다
 * (`ColdStartRequestKeysTest` 와 같은 사정) — 배선은 소스로 보고, 저장소의 임자 대조는 실제로 돌린다.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class StockClipManifestWiringTest {

    private val context: Context = ApplicationProvider.getApplicationContext()

    @Before
    @After
    fun clean() {
        StockClipManifestStore.clearAndInvalidate(context)
    }

    // ── 배선 ───────────────────────────────────────────────────────────

    @Test
    fun theViewModelFetchesTheManifestInExactlyOnePlace() {
        val calls = uiSources.flatMap { (path, code) ->
            Regex("""\bapi\.getStockClips\(""").findAll(code).map { path }.toList()
        }
        assertEquals(
            "뷰모델·화면 쪽에서 매니페스트를 받는 곳이 하나가 아니다: $calls — " +
                "`ensureStockClipManifest` 를 거칠 것(표·세대 가드, 한 번에 하나).",
            listOf("ui/main/MainViewModelVoiceActions.kt"),
            calls,
        )
        val body = functionBody(voiceActions, "private suspend fun MainViewModel.fetchAndPublishStockClips(")
        val ticket = body.indexOf("StockClipManifestStore.beginFetch()")
        val fetch = body.indexOf("api.getStockClips(")
        val save = body.indexOf("StockClipManifestStore.save(")
        val apply = body.indexOf("applyStockClipManifest(response)")
        assertTrue("표를 요청 **전에** 뽑지 않는다.", ticket in 0 until fetch)
        assertTrue("응답을 공개(`save`)하지 않는다.", save > fetch)
        assertTrue("공개가 확인되기 **전에** 메모리에 싣는다(Codex #703 — 순서).", apply > save)
    }

    @Test
    fun readinessAndCloneDownloadsGoThroughTheSharedFetch() {
        val readiness = withoutLineComments(clipReadiness)
        assertFalse("준비도가 다시 매니페스트를 직접 받는다.", readiness.contains("getStockClips"))
        assertTrue(readiness.contains("ensureStockClipManifest(ManifestNeed.RECENT)"))
        assertFalse(
            "준비도가 다시 `stockClips` 를 덮는다 — 표를 거치지 않은 쓰기다.",
            Regex("""\bstockClips\s*=""").containsMatchIn(readiness),
        )

        val download = functionBody(voiceActions, "internal suspend fun MainViewModel.downloadAllPresetClips(")
        assertFalse("클론 다운로드가 다시 매니페스트를 직접 받는다.", download.contains("getStockClips"))
        assertTrue(
            "클론 다운로드는 생성이 끝난 **뒤에** 출발한 매니페스트를 써야 한다.",
            download.contains("ensureStockClipManifest(ManifestNeed.LATEST)"),
        )
        assertFalse(Regex("""\bstockClips\s*=""").containsMatchIn(download))
    }

    @Test
    fun manifestDiskReadsAndWritesStayOffTheMainThread() {
        val offenders = uiSources.flatMap { (path, code) ->
            Regex("""StockClipManifestStore\s*\.\s*(save|load)\(""").findAll(code).mapNotNull { match ->
                // 여는 `withContext(Dispatchers.IO) {` 가 바로 앞(같은 블록)에 있어야 한다.
                val before = code.substring(maxOf(0, match.range.first - 160), match.range.first)
                if (before.contains("withContext(Dispatchers.IO)")) null else "$path: ${match.value}"
            }.toList()
        }
        assertTrue("매니페스트 저장소를 메인에서 부른다: $offenders", offenders.isEmpty())
    }

    @Test
    fun theVoicesTabSharesCloneDownloadsAndSkipsTheDrivingVoice() {
        val panel = withoutLineComments(voicesPanel)
        val download = functionBody(panel, "suspend fun downloadCloneBuckets(")
        assertTrue(
            "목소리 탭이 클립을 직접 받는다 — `onCacheVoiceClips`(목소리마다 한 벌)를 거칠 것.",
            download.contains("onCacheVoiceClips("),
        )
        assertFalse("목소리 탭이 클립마다 캐시를 따로 묻는다.", download.contains("hasCachedAudio"))
        assertFalse(download.contains("onDownloadStockAudio"))
        assertTrue(
            "드라이브가 도는 목소리를 목소리 탭 폴링에서 빼지 않는다 — status·다운로드가 두 벌이 된다.",
            panel.contains(".filter { it != driveVoiceId }"),
        )
        assertTrue(
            "목록의 행이 드라이브 진행을 등록 마지막 단계와 같은 값으로 보여 주지 않는다.",
            panel.contains("drive.overallFraction()"),
        )
    }

    // ── 저장소 ─────────────────────────────────────────────────────────

    @Test
    fun theWinnerIsTakenOverOnlyByItsOwner() {
        val manifest = StockClipListResponse(
            clips = listOf(
                StockClip(
                    messageId = "m1",
                    voiceProfileId = "v1",
                    category = "weather",
                    language = "ko",
                    variant = 0,
                    text = "맑아요",
                    audioUrl = "https://r2.example/m1.mp3",
                ),
            ),
        )
        assertEquals(
            StockClipManifestStore.PublishResult.PUBLISHED,
            StockClipManifestStore.save(context, manifest, StockClipManifestStore.beginFetch(), "u1"),
        )
        assertNotNull(StockClipManifestStore.load(context, "u1", requireOwner = true))
        assertNull(
            "물러난 회차가 **남의** 매니페스트를 이어받았다(스펙 「공개 경합의 규칙」 — 임자 대조).",
            StockClipManifestStore.load(context, "u2", requireOwner = true),
        )
        assertNull(StockClipManifestStore.load(context, null, requireOwner = true))
        // 임자 대조를 요구하지 않는 시드 경로는 예전 그대로다.
        assertNotNull(StockClipManifestStore.load(context, "u2"))
    }

    @Test
    fun theDriveProgressIsOneNumberForTheStepAndTheRow() {
        assertNull(PrerenderDriveState("v", generated = 0, total = 0, downloading = false).overallFraction())
        assertEquals(0.25f, PrerenderDriveState("v", 10, 20, downloading = false).overallFraction()!!, 0.0001f)
        assertEquals(0.5f, PrerenderDriveState("v", 0, 21, downloading = true).overallFraction()!!, 0.0001f)
        assertEquals(1f, PrerenderDriveState("v", 21, 21, downloading = true).overallFraction()!!, 0.0001f)
        assertEquals(1f, PrerenderDriveState("v", 99, 21, downloading = true).overallFraction()!!, 0.0001f)
    }

    // ── 도우미 ─────────────────────────────────────────────────────────

    private val root = "src/main/java/com/alarmtalk/app/"
    private val voiceActions: String by lazy { withoutLineComments(readSource("ui/main/MainViewModelVoiceActions.kt")) }
    private val clipReadiness: String by lazy { readSource("ui/main/MainViewModelClipReadiness.kt") }
    private val voicesPanel: String by lazy { readSource("ui/voices/VoiceProfileManagementPanel.kt") }

    /** `ui/` 아래 코틀린 파일 전부(경로 → 줄 주석을 걷은 본문). 워커(`sync/`)는 일부러 뺀다. */
    private val uiSources: List<Pair<String, String>> by lazy {
        val base = File(root)
        File(base, "ui").walkTopDown()
            .filter { it.isFile && it.extension == "kt" }
            .map { it.relativeTo(base).invariantSeparatorsPath to withoutLineComments(it.readText()) }
            .sortedBy { it.first }
            .toList()
    }

    /** 테스트는 app/ 에서 돈다. 모듈 루트 기준 상대 경로. */
    private fun readSource(path: String): String {
        val file = File(root + path)
        assertTrue(
            "$path 를 못 찾았다(경로: ${file.absolutePath}). 파일을 옮겼으면 이 테스트의 경로도 같이 고칠 것.",
            file.exists(),
        )
        return file.readText()
    }

    /** [signature] 부터 짝이 맞는 닫는 중괄호까지. */
    private fun functionBody(source: String, signature: String): String {
        val start = source.indexOf(signature)
        assertTrue("`$signature` 를 못 찾았다.", start >= 0)
        val open = source.indexOf('{', source.indexOf(')', start))
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

    /** 주석에 적힌 옛 모양이 걸리지 않게 줄 주석을 걷는다. */
    private fun withoutLineComments(source: String): String =
        source.lineSequence().joinToString("\n") { line -> line.substringBefore("//") }
}
