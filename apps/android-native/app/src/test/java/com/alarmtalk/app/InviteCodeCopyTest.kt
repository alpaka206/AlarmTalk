package com.alarmtalk.app

import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * **초대 코드 화면·코드 공유·되돌아가는 길의 문구**를 지킨다(2026-10-14).
 *
 * 선물 코드를 지운 뒤(App Store 지침 3.1.1 두 번째 반려 — `GiftCodeRemovalTest`)에도 문구가 '코드를 넣으면 이용권이
 * 바뀐다'·'코드를 받으면 돌아온다' 로 읽히는 자리가 남아 있었다(적대적 리뷰). 지키는 것 넷 — iOS 도 같은 글자를 쓴다
 * (`Localizable.xcstrings`, 스토어 이름만 App Store 다):
 *  1. **코드 화면은 초대 코드가 무엇이 되는지를 말한다.** 받는 것은 초대 코드 하나라 결과는 초대한 사람의 커플·가족
 *     이용권에 함께하는 것뿐이다 — "현재 이용권이 변경돼요"·"등록은 이용권이 종료된 다음" 처럼 코드가 이용권을 바꾸는
 *     수단으로 읽히는 말을 하지 않는다. 그 줄(`social_register_will_change_plan`)에는 플랜 이름 인자가 없다.
 *  2. **결제를 멈추는 길을 말한다.** 등록은 서버의 구독 행만 닫고 스토어 구독은 그대로 청구된다 — 확인 알럿이 Google
 *     Play 에서 해지하라고 말한다. 안드로이드 문구에는 다른 스토어 이름(App Store)을 쓰지 않는다.
 *  3. **공유하는 것은 초대 코드다.** '이용권 코드'·'plan code'·'利用券コード' 라고 부르면 코드가 이용권 자체로 읽힌다.
 *  4. **되돌아가는 길은 구독이다.** 공유가 끊긴 목소리·무료로 잠긴 목소리의 안내는 코드를 내밀거나 '등록' 이라고 하지
 *     않는다 — 구독하라고(그룹이면 다시 함께하라고) 말한다.
 *
 * 리소스를 런타임으로 해석하지 않고 **소스 XML 을 읽는다**(`PlanCardCopyTest` 와 같은 형태) — 세 벌을 한 번에 본다.
 */
class InviteCodeCopyTest {

    private val dirs = listOf("values", "values-en", "values-ja")

    private val inviteCodeWord = mapOf("values" to "초대 코드", "values-en" to "invite code", "values-ja" to "招待コード")
    private val planCodeWord = mapOf("values" to "이용권 코드", "values-en" to "plan code", "values-ja" to "利用券コード")
    private val registerWord = mapOf("values" to "등록", "values-en" to "regist", "values-ja" to "登録")
    private val codeWord = mapOf("values" to "코드", "values-en" to "code", "values-ja" to "コード")
    private val subscribeWord = mapOf("values" to "구독", "values-en" to "subscribe", "values-ja" to "購読")
    // 커플·가족 이용권을 그 언어로 부르는 말 — 확인 알럿이 어디로 옮겨 가는지를 말하는가를 본다.
    private val groupPlanWord = mapOf(
        "values" to "커플·가족 이용권",
        "values-en" to "Couple or Family plan",
        "values-ja" to "カップル・ファミリープラン",
    )

    private fun value(dir: String, name: String): String {
        // 테스트는 app/ 에서 돈다. 모듈 루트 기준 상대 경로.
        val file = File("src/main/res/$dir/strings.xml")
        assertTrue("$dir/strings.xml 을 못 찾았다(경로: ${file.absolutePath})", file.exists())
        return Regex("""<string name="$name"[^>]*>(.*?)</string>""", RegexOption.DOT_MATCHES_ALL)
            .find(file.readText())?.groupValues?.get(1)
            ?: error("$dir/strings.xml 에 $name 이 없다")
    }

    private fun String.has(word: String): Boolean = contains(word, ignoreCase = true)

    @Test
    fun `코드 화면은 이용권이 바뀐다고 하지 않고 초대 코드가 무엇이 되는지 말한다`() {
        for (dir in dirs) {
            val inUse = value(dir, "social_active_plan_in_use")
            assertTrue("$dir: 이용권 사용 중 줄에 플랜 이름 자리가 없다 — $inUse", inUse.contains("%1\$s"))
            assertFalse(
                "$dir: 이용권 사용 중 줄이 등록을 말한다 — 아래 '초대 코드 등록' 버튼과 어긋난다: $inUse",
                inUse.has(registerWord.getValue(dir)),
            )

            val willJoin = value(dir, "social_register_will_change_plan")
            // 호출부(`FamilyConnectionPanel`)는 인자를 넘기지 않는다 — 형식 자리가 돌아오면 화면에 '%1$s' 가 그대로 나온다.
            assertFalse("$dir: 인자 없는 줄에 형식 자리가 되살아났다 — $willJoin", willJoin.contains("%"))
            assertTrue("$dir: 초대 코드라고 말하지 않는다 — $willJoin", willJoin.has(inviteCodeWord.getValue(dir)))
        }
    }

    @Test
    fun `코드 화면의 플랜 이름은 화면 언어로 쓴다`() {
        // 서버 `plan.name` 은 한국어("개인")다 — 그대로 끼우면 영어 화면이 "Your 개인 plan is active." 가 된다.
        val panel = withoutLineComments(readSource("ui/social/SocialPanels.kt"))
        assertTrue("`FamilyConnectionPanel` 이 플랜 이름을 `passPlanName` 으로 옮기지 않는다.", panel.contains("passPlanName("))
    }

    @Test
    fun `등록 확인 알럿은 구독한 스토어에서 해지하라고 말하고 스토어 이름은 대지 않는다`() {
        // 구독한 스토어는 계정마다 다르다(iOS 에서 산 구독도 있다 — Codex #898). iOS 는 같은 알럿에서 다른 플랫폼
        // 이름을 쓸 수 없다(App Store 지침 2.3.10). 그래서 두 앱 모두 '구독한 스토어' 로만 말한다.
        val storeWord = mapOf("values" to "스토어", "values-en" to "store", "values-ja" to "ストア")
        for (dir in dirs) {
            val message = value(dir, "social_register_dialog_message_active")
            assertTrue("$dir: 지금 쓰는 플랜 이름 자리가 없다 — $message", message.contains("%1\$s"))
            assertTrue("$dir: 결제를 멈출 곳(구독한 스토어)을 말하지 않는다 — $message", message.contains(storeWord.getValue(dir)))
            assertFalse("$dir: 스토어 이름(Google Play)을 댄다 — $message", message.contains("Google Play"))
            assertFalse("$dir: 스토어 이름(App Store)을 댄다 — $message", message.contains("App Store"))
            assertTrue("$dir: 초대한 사람의 그룹으로 옮겨 간다고 말하지 않는다 — $message", message.has(groupPlanWord.getValue(dir)))
        }
    }

    @Test
    fun `공유하는 것은 초대 코드라고 부른다`() {
        val names = listOf(
            "billing_share_voucher_code",
            "billing_share_voucher_select_title",
            "billing_share_voucher_select_description",
        )
        for (dir in dirs) {
            for (name in names) {
                val text = value(dir, name)
                assertTrue("$dir/$name 이 초대 코드라고 부르지 않는다 — $text", text.has(inviteCodeWord.getValue(dir)))
                assertFalse("$dir/$name 이 코드를 이용권이라고 부른다 — $text", text.has(planCodeWord.getValue(dir)))
            }
        }
    }

    @Test
    fun `되돌아가는 길은 구독이고 코드를 내밀지 않는다`() {
        for (dir in dirs) {
            // 공유 목소리 안내는 구독을 권하지 않는다 — 구독해도 남의 목소리는 돌아오지 않는다(다시 공유받아야 한다).
            assertTrue(
                "$dir/msg_voice_locked_free_plan 이 구독하라고 말하지 않는다",
                value(dir, "msg_voice_locked_free_plan").has(subscribeWord.getValue(dir)),
            )
            for (name in listOf("downgrade_notice_shared_message", "msg_voice_locked_free_plan")) {
                val text = value(dir, name)
                assertFalse("$dir/$name 이 '등록' 이라고 한다 — 코드 입력으로 읽힌다: $text", text.has(registerWord.getValue(dir)))
                assertFalse("$dir/$name 이 돌아가는 길로 코드를 내민다 — $text", text.has(codeWord.getValue(dir)))
            }
        }
    }
}
