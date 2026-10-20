package com.alarmtalk.app

import com.alarmtalk.app.billing.PlayBillingProducts
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * **선물 코드는 없다** — 2026-10-14 에 지웠고, 되살아나면 안 된다(초대 코드도 2026-10-20 에 커플·가족 이용권과 함께 지웠다).
 *
 * iOS 1.2.12 가 App Store 지침 3.1.1 로 두 번째 반려됐다("선물 코드로 디지털 기능을 연다"). 1.2.11 의 첫 반려는
 * 프로모 코드였는데, 그때 고친 것은 사례(프로모 코드)였지 종류(코드를 쳐서 유료 기능을 여는 것)가 아니었다.
 * 이 테스트는 그 종류가 안드로이드로 다시 들어오는 길을 막는다:
 *  1. **파는 상품** — Play 상품은 개인 구독 하나뿐이다(1회성 선물 상품 없음, 1회성 결제·재전송 경로 없음).
 *  2. **유료 게이트의 코드 입력** — 막힌 기능 바로 옆에 코드 칸을 다시 붙이지 않는다(`PlanGateDialog`).
 *  3. **선물 화면·공유** — 개인 카드의 '선물하기', 선물 코드 공유가 없다.
 *  4. **화면 문구** — 세 언어 어디에도 선물 문구와 그 리소스가 없다.
 *  5. **되돌아가는 길은 구독이다** — 잠긴 목소리의 안내가 코드를 내밀거나 '등록' 이라고 하지 않는다.
 *
 * 할인·무료 이용은 스토어 오퍼 코드로 준다. 초대 코드 낱말과 그룹 상품 id 는 CI lint(`scripts/check-paid-unlock-codes.py`)가 막는다.
 *
 * 이 모듈에는 Compose UI 테스트 하네스가 없어 게이트·배선은 소스 글자로 본다(`SourceWiring.kt` 머리말 —
 * 소스 검사는 호출이 거기 있는가만 본다). 경고 주석은 옛 이름을 인용하므로 주석을 걷은 본문만 본다.
 */
class GiftCodeRemovalTest {

    @Test
    fun `Play 상품은 개인 구독 하나뿐이다`() {
        assertEquals(listOf(PlayBillingProducts.PERSONAL_MONTHLY), PlayBillingProducts.all)
        assertTrue(
            "선물 상품이 Play 상품 목록에 되살아났다: ${PlayBillingProducts.all}",
            PlayBillingProducts.all.none { it.contains("gift") },
        )
    }

    @Test
    fun `결제 매니저에 1회성 상품 경로가 없다`() {
        val billing = codeOnly(readSource("billing/PlayBillingManager.kt"))
        // 조회·결제 시트·미확인 재전송 어디에도 INAPP 이 없어야 한다 — 1회성 상품은 선물 하나였다.
        assertFalse("1회성(INAPP) 상품 경로가 되살아났다.", billing.contains("ProductType.INAPP"))
        assertFalse("선물 상품 ID 가 되살아났다.", billing.contains("personal_gift"))
        // ⚠ 이건 남아야 한다 — billing 8.0.0 의 `PendingPurchasesParams.Builder.build()` 가 없으면 던진다.
        assertTrue(
            "`enableOneTimeProducts()` 가 빠졌다 — 결제 매니저를 만드는 순간 IllegalArgumentException 으로 죽는다.",
            billing.contains("enableOneTimeProducts()"),
        )
    }

    @Test
    fun `유료 게이트에는 코드 입력이 없다`() {
        val gate = codeOnly(readSource("ui/components/PlanGateDialog.kt"))
        for (needle in listOf("onRedeemCode", "redeemBusy", "IosAlertField", "sanitizeRedeemCode", "plan_gate_redeem")) {
            assertFalse("유료 게이트에 코드 입력(`$needle`)이 되살아났다.", gate.contains(needle))
        }
        // 액션은 [닫기][이용권 보기] 둘이다(스펙 plan-gates §2 — 상태별 확인 버튼은 그대로). 순서는 아래 테스트가 본다.
        assertEquals("유료 게이트의 액션 수", 2, Regex("""\bIosAlertAction\(""").findAll(gate).count())

        for (caller in listOf(
            "ui/editor/AlarmEditorScreen.kt",
            "ui/voices/VoiceProfileManagementPanel.kt",
            "ui/app/AlarmTalkApp.kt",
        )) {
            val source = codeOnly(readSource(caller))
            for (needle in listOf("onRedeemCode", "redeemBusy", "navigateOnSuccess")) {
                assertFalse("$caller 가 유료 게이트에 코드 입력(`$needle`)을 다시 넘긴다.", source.contains(needle))
            }
        }
        // 편집기·목소리 패널은 코드 등록 콜백을 아예 받지 않는다 — 앱 어디에도 코드 입력칸은 없다.
        for (panel in listOf("ui/editor/AlarmEditorScreen.kt", "ui/voices/VoiceProfileManagementPanel.kt")) {
            assertFalse("$panel 이 코드 등록 콜백을 다시 받는다.", codeOnly(readSource(panel)).contains("onRegisterCode"))
        }
    }

    /**
     * 유료 게이트의 순서는 **[닫기][이용권 보기]** 다 — 닫기가 앞(왼쪽), 강조한 확인이 끝(오른쪽).
     *
     * 2026-08-15 의 순서([코드 액션][이용권 보기][닫기] — 닫기가 맨 끝)는 코드 액션까지 셋을 세로로 쌓던 때의 것이다
     * (세로에서는 iOS 가 `.cancel` 을 맨 아래로 내린다). 코드 액션을 지워 언제나 두 버튼 한 줄이고, 한 줄에서는 iOS 시스템
     * 알럿이 `.cancel` 을 앞에 둔다 — 앱의 다른 두 액션 알럿도 취소·닫기가 앞이다. 이유는 `PlanGateDialog` 의 액션 목록 위 주석.
     */
    @Test
    fun `유료 게이트는 닫기가 앞이고 강조한 확인이 끝이다`() {
        val gate = codeOnly(readSource("ui/components/PlanGateDialog.kt"))
        val starts = Regex("""\bIosAlertAction\(""").findAll(gate).map { it.range.first }.toList()
        assertEquals("유료 게이트의 액션 수", 2, starts.size)
        val first = gate.substring(starts[0], starts[1])
        val last = gate.substring(starts[1])

        assertTrue(
            "유료 게이트의 첫 액션이 닫기가 아니다 — 순서는 [닫기][이용권 보기] 다.\n$first",
            first.contains("R.string.r3dlg_modal_dialog_close") && first.contains("onClick = onDismiss"),
        )
        assertFalse("유료 게이트의 닫기가 강조돼 있다 — 강조는 확인 하나다.\n$first", first.contains("emphasized = true"))
        assertTrue(
            "유료 게이트의 끝 액션이 강조한 확인이 아니다 — 순서는 [닫기][이용권 보기] 다.\n$last",
            last.contains("label = confirmLabel") &&
                last.contains("emphasized = true") &&
                last.contains("onClick = onConfirm"),
        )
    }

    @Test
    fun `선물 구매와 선물 공유 경로가 없다`() {
        val banned = listOf(
            "startGiftPurchase",
            "onGiftPersonal",
            "launchOneTimePurchase",
            "PERSONAL_GIFT_1M",
            "RedeemCodeKind",
            "billing_gift",
            "share_code_gift_body",
            "\"GIFT-",
            "INVALID_GIFT_PLAN",
        )
        for (path in listOf(
            "ui/billing/BillingPanels.kt",
            "ui/main/MainViewModelBillingActions.kt",
            "ui/alarms/AlarmListScreen.kt",
            "ui/app/AlarmTalkApp.kt",
            "ui/app/SnackbarSeverity.kt",
        )) {
            val source = codeOnly(readSource(path))
            for (needle in banned) {
                assertFalse("$path 에 선물 경로(`$needle`)가 되살아났다.", source.contains(needle))
            }
        }
    }

    @Test
    fun `세 언어 어디에도 선물 문구가 없다`() {
        val bannedWords = mapOf(
            "values" to listOf("선물"),
            "values-en" to listOf("gift"),
            "values-ja" to listOf("ギフト", "贈"),
        )
        for ((dir, words) in bannedWords) {
            // 테스트는 app/ 에서 돈다. 모듈 루트 기준 상대 경로.
            val file = File("src/main/res/$dir/strings.xml")
            assertTrue("$dir/strings.xml 을 못 찾았다(경로: ${file.absolutePath})", file.exists())
            val entries = Regex("""<string name="([^"]+)"[^>]*>(.*?)</string>""", RegexOption.DOT_MATCHES_ALL)
                .findAll(file.readText())
                .map { it.groupValues[1] to it.groupValues[2] }
                .toList()
            assertTrue("$dir/strings.xml 에서 문구를 못 읽었다", entries.isNotEmpty())
            for ((name, text) in entries) {
                assertFalse("$dir/$name — 선물 리소스가 되살아났다", name.contains("gift"))
                assertFalse("$dir/$name — 유료 게이트의 코드 입력 문구가 되살아났다", name.startsWith("plan_gate_redeem"))
                for (word in words) {
                    assertFalse("$dir/$name 에 '$word' 가 있다 — $text", text.lowercase().contains(word))
                }
            }
        }
    }

    @Test
    fun `되돌아가는 길은 구독이고 코드를 내밀지 않는다`() {
        val subscribeWord = mapOf("values" to "구독", "values-en" to "subscribe", "values-ja" to "購読")
        val registerWord = mapOf("values" to "등록", "values-en" to "regist", "values-ja" to "登録")
        val codeWord = mapOf("values" to "코드", "values-en" to "code", "values-ja" to "コード")
        for (dir in listOf("values", "values-en", "values-ja")) {
            // 무료로 잠긴 목소리는 다시 구독하면 돌아온다 — 안내가 그 길을 말한다.
            assertTrue(
                "$dir/msg_voice_locked_free_plan 이 구독하라고 말하지 않는다",
                stringValue(dir, "msg_voice_locked_free_plan").contains(subscribeWord.getValue(dir), ignoreCase = true),
            )
            for (name in listOf("downgrade_notice_message", "msg_voice_locked_free_plan")) {
                val text = stringValue(dir, name)
                assertFalse(
                    "$dir/$name 이 '등록' 이라고 한다 — 코드 입력으로 읽힌다: $text",
                    text.contains(registerWord.getValue(dir), ignoreCase = true),
                )
                assertFalse("$dir/$name 이 돌아가는 길로 코드를 내민다 — $text", text.contains(codeWord.getValue(dir), ignoreCase = true))
            }
        }
    }

    /** [dir](`values`·`values-en`·`values-ja`)의 strings.xml 에서 [name] 의 글. 테스트는 app/ 에서 돈다. */
    private fun stringValue(dir: String, name: String): String {
        val file = File("src/main/res/$dir/strings.xml")
        assertTrue("$dir/strings.xml 을 못 찾았다(경로: ${file.absolutePath})", file.exists())
        return Regex("""<string name="$name"[^>]*>(.*?)</string>""", RegexOption.DOT_MATCHES_ALL)
            .find(file.readText())?.groupValues?.get(1)
            ?: error("$dir/strings.xml 에 $name 이 없다")
    }

    // 주석을 걷은 본문 — 경고 주석이 옛 이름을 인용해도 걸리지 않게 한다. 블록 주석은 줄 머리에서 시작하는
    // 것만 걷는다 — MIME 문자열(오디오 와일드카드처럼 슬래시 뒤에 별이 오는 것)을 주석 시작으로 읽지 않게.
    // ⚠ 이 설명을 KDoc 으로 옮기면서 그 문자열을 그대로 적지 말 것 — 코틀린 블록 주석은 겹쳐져서 닫히지 않는다.
    private fun codeOnly(source: String): String =
        withoutLineComments(source.replace(Regex("""(?ms)^\s*/\*.*?\*/"""), ""))
}
