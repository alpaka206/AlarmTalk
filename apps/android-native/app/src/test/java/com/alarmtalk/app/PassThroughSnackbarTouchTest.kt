package com.alarmtalk.app

import android.os.Looper
import android.os.SystemClock
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import java.time.Duration
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * **화면 아래 알람 켜기 안내는 누르는 것을 아래 행에 넘긴다**(`docs/spec/alarm-editor.md` §7 「누르거나 화면을 옮겨도 막지
 * 않는다」).
 *
 * 그 안내는 ＋ 버튼 바로 위, 폭 전체·높이 약 48dp 띠에 3초쯤 떠 있고 그 띠는 목록의 마지막 행 위에 얹힌다. M3 `Snackbar` 로
 * 그리면 그 안의 `Surface` 가 자기 영역의 터치를 받아, 그동안 그 행의 스위치를 눌러도 아무 일이 없었다. 소스 글자로는
 * "터치가 내려가는가" 를 볼 수 없어 실제로 그려 놓고 눌러 본다 — `AlarmTalkApp` 과 같은 짜임(`Scaffold` 의 `snackbarHost` 에
 * 실린 `SnackbarHost`)으로 안내를 띄우고, 그 밑에 화면 전체가 눌리는 판을 깔아 안내의 한가운데를 누른다.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class PassThroughSnackbarTouchTest {

    @Test
    fun `아래 안내의 한가운데를 눌러도 그 밑의 행이 눌린다`() {
        assertEquals(1, tapsReachingTheRowBeneath { RingInCapsule(message = it) })
    }

    @Test
    fun `M3 스낵바 카드는 그 자리의 누름을 받는다 — 아래 안내만 따로 그리는 이유`() {
        // 위쪽 안내가 쓰는 기본 모양. 이게 깨지면(M3 가 터치를 넘기게 바뀌면) 두 카드를 하나로 합쳐도 된다.
        assertEquals(0, tapsReachingTheRowBeneath { PrettySnackbar(message = it) })
    }

    private fun tapsReachingTheRowBeneath(card: @Composable (String) -> Unit): Int {
        val activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().get()
        var taps = 0
        var cardBounds: Rect? = null
        activity.setContent {
            val hostState = remember { SnackbarHostState() }
            LaunchedEffect(Unit) { hostState.showSnackbar("1분 후에 울려요.", duration = SnackbarDuration.Indefinite) }
            Scaffold(
                snackbarHost = {
                    SnackbarHost(hostState = hostState) { data ->
                        Box(Modifier.onGloballyPositioned { cardBounds = it.boundsInRoot() }) {
                            card(data.visuals.message)
                        }
                    }
                },
            ) { _ ->
                // 목록 자리 — 알람 목록처럼 `Scaffold` 여백과 상관없이 아래까지 그리고, 어디를 눌러도 눌린다.
                Box(Modifier.fillMaxSize().clickable { taps += 1 })
            }
        }
        settle()
        val bounds = checkNotNull(cardBounds) { "안내가 그려지지 않았다" }
        val composeView = activity.findViewById<ViewGroup>(android.R.id.content).getChildAt(0)
        tap(composeView, bounds.center.x, bounds.center.y)
        settle()
        return taps
    }

    /** 컴포지션·배치·안내 등장·눌림 처리를 끝까지 돌린다. */
    private fun settle() {
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(500))
    }

    private fun tap(view: View, x: Float, y: Float) {
        val downAt = SystemClock.uptimeMillis()
        view.dispatchTouchEvent(MotionEvent.obtain(downAt, downAt, MotionEvent.ACTION_DOWN, x, y, 0))
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(50))
        view.dispatchTouchEvent(MotionEvent.obtain(downAt, SystemClock.uptimeMillis(), MotionEvent.ACTION_UP, x, y, 0))
    }
}
