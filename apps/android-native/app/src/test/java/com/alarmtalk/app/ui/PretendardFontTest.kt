package com.alarmtalk.app.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 번들한 Pretendard 가 **실제로 들어 있고 이름이 맞는지** 확인한다.
 *
 * 왜 테스트가 필요한가: 폰트 파일이 빠지거나 이름이 바뀌면 `R.font.*` 참조가 컴파일에서
 * 걸리긴 하지만, **파일이 0바이트로 깨져 있거나 다른 서체로 바뀐 것**은 못 잡는다.
 * 그러면 앱이 조용히 시스템 서체로 돌아가고, 화면은 멀쩡해 보인다.
 *
 * iOS 대응: `AlarmTalkTests/PretendardFontTests.swift`(PostScript 이름 해석 확인).
 */
class PretendardFontTest {

    private val fontDir = File("src/main/res/font")

    @Test
    fun `네 굵기가 모두 있고 비어 있지 않다`() {
        val expected = listOf(
            "pretendard_regular.otf",
            "pretendard_medium.otf",
            "pretendard_semibold.otf",
            "pretendard_bold.otf",
        )
        for (name in expected) {
            val file = File(fontDir, name)
            assertTrue("$name 이 없다 — AlarmTalkTypography 의 FontFamily 가 깨진다", file.exists())
            assertTrue("$name 이 비어 있다(0바이트)", file.length() > 10_000)
        }
    }

    @Test
    fun `OTF 시그니처가 맞다`() {
        // OpenType/CFF 는 'OTTO', TrueType 은 0x00010000 으로 시작한다.
        // 다른 서체 파일을 같은 이름으로 덮어써도 여기서 걸린다.
        for (file in fontDir.listFiles().orEmpty()) {
            val head = file.inputStream().use { it.readNBytes(4) }
            assertEquals(
                "${file.name} 의 헤더가 OTF 가 아니다",
                "OTTO",
                String(head, Charsets.ISO_8859_1),
            )
        }
    }
}
