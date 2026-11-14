package com.alarmtalk.app.ui.voices

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 목소리 탭의 인사말 '듣기'는 **울림과 같은 스트림(USAGE_ALARM·CONTENT_TYPE_SPEECH)** 으로 난다(2026-11-09 실기기 —
 * CLAUDE.md 「미리듣기는 울림과 같은 스트림」). 예전에는 인사말만 `MediaPlayer.create` 로 만들어 미디어 볼륨으로 났고,
 * 같은 화면의 등록 미리듣기는 알람 볼륨이라 버튼마다 다른 볼륨 축에서 들렸다.
 *
 * 플레이어를 만드는 곳이 컴포저블 안의 지역 함수라 단위 테스트에서 띄울 수 없어(`VoicePackTest` 의 진입 구독 검사와 같은
 * 사정) 배선을 소스로 고정한다:
 *  1. 인사말 두 갈래(내장 인사말 `playGreeting`·받은 클립 `playGreetingClip`)는 `MediaPlayer.create` 를 쓰지 않고
 *     `createPreviewPlayer` 로 연다.
 *  2. `createPreviewPlayer` 는 알람 용도·말소리 속성을 **데이터를 넣고 prepare 하기 전에** 건다 — `MediaPlayer.create` 는
 *     prepare 까지 끝낸 플레이어를 돌려주므로 그 뒤에 건 속성은 먹지 않는다.
 */
class GreetingPreviewStreamTest {

    @Test
    fun `인사말 듣기는 알람 스트림 플레이어로 연다`() {
        for (header in GREETING_PLAYERS) {
            val body = bodyOf(header)
            assertFalse("$header 가 다시 MediaPlayer.create 로 만든다 — 미디어 볼륨으로 난다.", body.contains("MediaPlayer.create("))
            assertTrue("$header 가 createPreviewPlayer 로 열지 않는다.", body.contains("createPreviewPlayer("))
        }
    }

    @Test
    fun `알람 스트림 속성은 데이터와 prepare 보다 먼저 건다`() {
        val body = bodyOf(PREVIEW_PLAYER_FACTORY)
        val usage = body.indexOf("USAGE_ALARM")
        val content = body.indexOf("CONTENT_TYPE_SPEECH")
        val data = body.indexOf("setDataSource(")
        val prepare = body.indexOf(".prepare()")
        assertTrue("USAGE_ALARM 이 없다.", usage >= 0)
        assertTrue("CONTENT_TYPE_SPEECH 가 없다.", content >= 0)
        assertTrue("setDataSource 가 없다.", data >= 0)
        assertTrue("prepare 가 없다.", prepare >= 0)
        assertTrue("속성은 데이터를 넣기 전에 건다.", maxOf(usage, content) < data)
        assertTrue("데이터는 prepare 전에 넣는다.", data < prepare)
    }

    private val panel: String by lazy {
        // 테스트는 app/ 에서 돈다. 모듈 루트 기준 상대 경로.
        val file = File("src/main/java/com/alarmtalk/app/ui/voices/VoiceProfileManagementPanel.kt")
        assertTrue("VoiceProfileManagementPanel.kt 를 못 찾았다(${file.absolutePath}).", file.exists())
        file.readText()
    }

    /** [header] 부터 다음 함수 선언 앞까지. */
    private fun bodyOf(header: String): String {
        val start = panel.indexOf(header)
        assertTrue("$header 를 못 찾았다 — 이름이 바뀌었으면 이 테스트도 같이 고칠 것.", start >= 0)
        val rest = panel.substring(start + header.length)
        return rest.substring(0, NEXT_DECLARATION.find(rest)?.range?.first ?: rest.length)
    }

    private companion object {
        val NEXT_DECLARATION = Regex("""(?m)^[ \t]*(?:(?:private|internal|suspend)\s+)*fun\s""")
        val GREETING_PLAYERS = listOf(
            "fun playGreeting(profile: VoiceProfile)",
            "fun playGreetingClip(voiceId: String, failureLog: String)",
        )
        const val PREVIEW_PLAYER_FACTORY = "fun createPreviewPlayer(originalUri: String, tunedWav: ByteArray?): MediaPlayer"
    }
}
