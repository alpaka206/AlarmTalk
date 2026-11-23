package com.alarmtalk.app

import android.os.Looper
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import kotlin.math.roundToInt
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * 인증 화면군의 칸과 버튼은 **모두 같은 높이**(`AuthControlHeight` = 52dp)다(2026-11-22 오너 "버튼 높이 안드로이드·아이폰 다른
 * 것도 적절한 크기로 통일"). iOS 도 같은 값이다(`AuthControlHeight`).
 *
 * 소스 글자로는 높이를 볼 수 없다 — 칸은 Material `OutlinedTextField` 가 스스로 거는 최소 56dp 를 피하려고 직접 짰고
 * (`AuthOutlinedField`), 누가 그 칸으로 되돌리면 소스에는 `AuthControlHeight` 가 그대로 남은 채 56 이 된다. 그래서 실제로
 * 그려서 잰다.
 */
@RunWith(RobolectricTestRunner::class)
// 글자 높이를 실제 기기처럼 잰다 — 기본(LEGACY) 그리기에서는 한글 글자의 줄 높이가 부풀어 글자로 자라는 버튼(주 버튼)이
// 52 대신 56 으로 재였다. 칸·버튼의 최소 높이를 보려는 것이라 글자 측정이 실제와 같아야 한다.
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34])
class AuthControlHeightTest {

    @Test
    fun `칸·주 버튼·간편 로그인·인증 버튼이 모두 52dp 다`() {
        val heights = measureHeights(
            "이메일 칸" to {
                AuthTextField(
                    label = "이메일",
                    value = "",
                    onValueChange = {},
                    keyboardType = KeyboardType.Email,
                    imeAction = ImeAction.Next,
                    enabled = true,
                    placeholderOnly = true,
                )
            },
            "비밀번호 칸" to {
                AuthTextField(
                    label = "비밀번호",
                    value = "abc12345",
                    onValueChange = {},
                    keyboardType = KeyboardType.Password,
                    imeAction = ImeAction.Done,
                    enabled = true,
                    passwordVisible = false,
                    placeholderOnly = true,
                )
            },
            "주 버튼" to { GradientCta(text = "로그인", onClick = {}) },
            "카카오" to { KakaoLoginButton(enabled = true, onClick = {}, modifier = Modifier.fillMaxWidth()) },
            "구글" to { GoogleSignInButton(enabled = true, onClick = {}, modifier = Modifier.fillMaxWidth()) },
            "인증 받기" to { EmailVerifyButton(verified = false, codeSent = false, enabled = true, onClick = {}) },
        )
        heights.forEach { (name, px) -> assertEquals("$name 높이(px)", heights.expected, px) }
    }

    @Test
    fun `가입 칸은 이름표가 칸 위에 붙고 칸 자체는 같은 52dp 다`() {
        // 이름표가 있는 칸(가입·재설정)은 이름표 + 6 + 칸이다 — 칸이 로그인 칸보다 커지면 안 된다.
        val heights = measureHeights(
            "이름표 없는 칸" to {
                AuthTextField(
                    label = "이메일",
                    value = "",
                    onValueChange = {},
                    keyboardType = KeyboardType.Email,
                    imeAction = ImeAction.Next,
                    enabled = true,
                    placeholderOnly = true,
                )
            },
            "이름표 있는 칸" to {
                AuthTextField(
                    label = "이메일",
                    value = "",
                    onValueChange = {},
                    keyboardType = KeyboardType.Email,
                    imeAction = ImeAction.Next,
                    enabled = true,
                )
            },
        )
        val bare = heights.getValue("이름표 없는 칸")
        val labelled = heights.getValue("이름표 있는 칸")
        assertEquals(heights.expected, bare)
        // 이름표가 붙은 만큼만 크다 — 칸이 56 으로 돌아가면 이 차이가 4dp 커진다.
        assert(labelled > bare) { "이름표가 칸 위에 붙지 않았다" }
    }

    private class Heights(val expected: Int, map: Map<String, Int>) : Map<String, Int> by map

    private fun measureHeights(vararg items: Pair<String, @Composable () -> Unit>): Heights {
        val activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().get()
        val measured = linkedMapOf<String, Int>()
        activity.setContent {
            Column {
                items.forEach { (name, content) ->
                    Box(Modifier.onGloballyPositioned { measured[name] = it.size.height }) { content() }
                }
            }
        }
        shadowOf(Looper.getMainLooper()).idle()
        val density = activity.resources.displayMetrics.density
        assertEquals("그려지지 않은 항목이 있다", items.size, measured.size)
        return Heights((52 * density).roundToInt(), measured)
    }
}
