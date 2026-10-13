package com.alarmtalk.app.ui.components

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 초대 코드 공유 문구의 **설치 링크와 등록 경로**를 지킨다(`shareRedeemCode` 가 보내는 본문).
 * 선물 코드 공유 문구(`share_code_gift_body`)는 선물과 함께 2026-10-14 에 지웠다(App Store 지침 3.1.1
 * 두 번째 반려) — 되살아나면 `선물 코드 공유 문구는 없다` 가 걸린다.
 *
 * 지키는 것 넷:
 *  1. **스토어 직링크가 아니라 랜딩이다.** 받는 사람이 어느 기기인지 모른다 — Play 주소를
 *     넣으면 아이폰 가족은 열어도 설치할 수 없다. iOS 게재(2026-09-22) 전에는 Play 주소를
 *     넣었다가 2026-09-23 에 랜딩으로 옮겼다. iOS 는 처음부터 랜딩이었다(`CodeShareText`).
 *  2. **문구와 같은 언어의 랜딩이다.** 랜딩 루트는 기기 언어와 상관없이 한국어 페이지를
 *     준다(정적 export — 언어 감지가 없다). 영어·일본어 문구에 루트를 넣으면 받는 사람이
 *     한국어 페이지에 떨어진다.
 *  3. **줄바꿈은 `\n` 으로 쓴다.** XML 에 줄바꿈을 그냥 치면 aapt2 가 공백 하나로 뭉친다 —
 *     2026-09-23 까지 이 문구가 실제로 그랬다(빌드된 APK 를 `aapt2 dump resources` 로 확인:
 *     "…같이 쓰자! 초대 코드: %1$s 1. 알람톡 설치 … 2. 가입하고 로그인 3. …" 한 줄). 번호 매긴
 *     단계가 한 줄로 붙어 받는 사람이 읽기 어려웠다. iOS 는 줄바꿈이 제대로 나갔다.
 *  4. **'어디에 넣는가' 는 실제 메뉴 이름이다.** 3단계는 하단 탭(`r3app_bottom_tab_menu`) → 더보기의
 *     행(`common_tab_code_register`) 이름을 그대로 댄다. 일본어 문구는 한동안 행 이름(「コード登録」)과
 *     다른 「コードを登録」 을 댔고, 2026-10-14 에 행 이름이 '초대 코드 등록' 으로 바뀌었다 — 이름이
 *     어긋나면 받는 사람이 그 행을 못 찾는다.
 *
 * iOS `CodeShareTextTests` 가 같은 주소를 지킨다 — 한쪽만 바꾸면 두 앱이 다른 곳으로 보낸다.
 *
 * 리소스를 런타임으로 해석하지 않고 **소스 XML 을 읽는다**(`AlarmDatabaseMigrationSafetyTest`
 * 와 같은 형태) — 로케일마다 설정을 바꿔 가며 띄울 필요 없이 세 벌을 한 번에 본다.
 */
class ShareCodeTextTest {

    private data class Locale(val dir: String, val landing: String)

    private val locales = listOf(
        Locale("values", "https://alarm-talk.com"),
        Locale("values-en", "https://alarm-talk.com/en/"),
        Locale("values-ja", "https://alarm-talk.com/ja/"),
    )

    private val names = listOf("share_code_invite_body")

    private fun strings(dir: String): String {
        // 테스트는 app/ 에서 돈다. 모듈 루트 기준 상대 경로.
        val file = File("src/main/res/$dir/strings.xml")
        assertTrue("$dir/strings.xml 을 못 찾았다(경로: ${file.absolutePath})", file.exists())
        return file.readText()
    }

    private fun body(dir: String, name: String): String =
        Regex("""<string name="$name"[^>]*>(.*?)</string>""", RegexOption.DOT_MATCHES_ALL)
            .find(strings(dir))?.groupValues?.get(1)
            ?: error("$dir/strings.xml 에 $name 이 없다")

    @Test
    fun `선물 코드 공유 문구는 없다`() {
        for (locale in locales) {
            assertFalse(
                "${locale.dir}/strings.xml 에 share_code_gift_body 가 되살아났다 — 선물 코드는 2026-10-14 에 없앴다.",
                strings(locale.dir).contains("""name="share_code_gift_body""""),
            )
        }
    }

    @Test
    fun `등록 경로는 실제 메뉴 이름을 그대로 댄다`() {
        for (locale in locales) {
            val text = body(locale.dir, "share_code_invite_body")
            val tab = body(locale.dir, "r3app_bottom_tab_menu")
            val row = body(locale.dir, "common_tab_code_register")
            // 하단 탭 → 행 순서로 댄다. 둘 다 그 언어의 화면 글자 그대로여야 받는 사람이 찾는다.
            val tabAt = text.indexOf(tab)
            val rowAt = text.indexOf(row)
            assertTrue("${locale.dir}: 공유 문구가 하단 탭 '$tab' 을 대지 않는다 — $text", tabAt >= 0)
            assertTrue("${locale.dir}: 공유 문구가 더보기 행 '$row' 을 대지 않는다 — $text", rowAt > tabAt)
        }
    }

    @Test
    fun `설치 링크는 스토어가 아니라 문구와 같은 언어의 랜딩이다`() {
        for (locale in locales) for (name in names) {
            val text = body(locale.dir, name)
            assertFalse("${locale.dir}/$name 에 Play 직링크가 있다", text.contains("play.google.com"))
            assertFalse("${locale.dir}/$name 에 App Store 직링크가 있다", text.contains("apps.apple.com"))
            // `\n` 표기는 백슬래시로 시작하므로 거기서 끊는다.
            val links = Regex("""https://[^\s\\]+""").findAll(text).map { it.value }.toList()
            assertEquals("${locale.dir}/$name 의 링크", listOf(locale.landing), links)
        }
    }

    @Test
    fun `줄바꿈은 실제 개행이 아니라 역슬래시 n 으로 쓴다`() {
        for (locale in locales) for (name in names) {
            val text = body(locale.dir, name)
            assertFalse(
                "${locale.dir}/$name 에 실제 줄바꿈이 있다 — aapt2 가 공백으로 뭉쳐 한 줄이 된다. \\n 으로 쓸 것.",
                text.contains('\n'),
            )
            // 안내 세 단계 + 코드 줄이 각자 줄에 있어야 한다.
            assertTrue("${locale.dir}/$name 의 줄바꿈 표기", text.split("\\n").size >= 6)
        }
    }

    @Test
    fun `코드 자리표시자는 그대로 하나다`() {
        // 링크를 고치다 코드 자리를 지우면 받는 사람이 코드 없이 안내만 받는다.
        for (locale in locales) for (name in names) {
            assertEquals("${locale.dir}/$name", 1, Regex("""%1\${'$'}s""").findAll(body(locale.dir, name)).count())
        }
    }
}
