package com.alarmtalk.app.ui.billing

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 이용권 화면 **개인 카드의 기능 문구**를 지킨다(2026-09-30).
 *
 * 개인 카드는 "날씨·운세 등 매일 다른 문구" 라고 적었는데 둘 다 사실이 아니었다:
 *  - 날씨·운세·응원·약 문구는 **기본 목소리로 무료**다 — 문구 목록은 등급으로 자르지 않는다
 *    (`docs/spec/voice-and-message.md` §2). 유료 혜택처럼 적으면 무료 사용자는 없는 줄 알고,
 *    산 사람은 이미 있던 것을 샀다고 느낀다.
 *  - 클립은 준비된 것을 돌려 쓴다(§5) — '매일 새 문구' 가 아니다.
 * 개인 이용권이 더하는 것은 그 문구를 **등록한 목소리로** 듣는 것이다.
 *
 * iOS 는 `PlanCard.features(for:)` 와 `Localizable.xcstrings` 가 같은 글자를 쓴다
 * (`AlarmTalkTests/PlanCardCopyTests`) — 한쪽만 바꾸면 같은 상품을 두 스토어에서 다르게 설명한다.
 *
 * 리소스를 런타임으로 해석하지 않고 **소스 XML 을 읽는다**(`VoiceRegistrationCopyTest` 와 같은
 * 형태) — 로케일마다 설정을 바꿔 가며 띄울 필요 없이 세 벌을 한 번에 본다.
 */
class PlanCardCopyTest {

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

    /** 이용권 카드의 기능 불릿 전부(`billing_plan_*feature*`). */
    private fun featureLines(dir: String): Map<String, String> =
        Regex("""<string name="(billing_plan_\w*feature\w*)"[^>]*>(.*?)</string>""", RegexOption.DOT_MATCHES_ALL)
            .findAll(strings(dir))
            .associate { it.groupValues[1] to it.groupValues[2] }

    @Test
    fun `개인 카드는 문구 종류가 아니라 등록한 목소리로 듣는 것을 말한다`() {
        val expected = mapOf(
            "values" to "내 목소리로 듣는 날씨·운세 문구",
            "values-en" to "Weather and fortune messages in your own voice",
            "values-ja" to "自分の声で聞く天気・運勢メッセージ",
        )
        for ((dir, text) in expected) {
            assertEquals("$dir 개인 카드 문구", text, value(dir, "billing_plan_personal_feature_messages_in_voice"))
        }
    }

    @Test
    fun `옛 매일 다른 문구 키가 되살아나지 않는다`() {
        for (dir in dirs) {
            assertNull(
                "$dir 에 billing_plan_personal_feature_daily_prompt 가 되살아났다",
                value(dir, "billing_plan_personal_feature_daily_prompt"),
            )
        }
    }

    @Test
    fun `어느 카드도 매일 새 문구를 약속하지 않는다`() {
        val dailyClaims = listOf("매일", "every day", "daily", "毎日")
        for (dir in dirs) {
            val lines = featureLines(dir)
            assertTrue("$dir 에서 카드 기능 문구를 못 읽었다", lines.isNotEmpty())
            for ((name, text) in lines) {
                for (claim in dailyClaims) {
                    assertFalse("$dir/$name 가 '$claim' 을 약속한다: $text", text.contains(claim, ignoreCase = true))
                }
            }
        }
    }
}
