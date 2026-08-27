package com.alarmtalk.app

import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalFocusManager

/**
 * **입력창 밖을 누르면 입력이 끝난다**(2026-08-27 지시, iOS `RootView` 와 같은 규칙).
 *
 * ⚠ **`detectTapGestures` 로 만들지 말 것.** 그렇게 하면 **입력칸을 누르는 탭까지** 이
 * 부모가 받아 초점을 풀어, 칸을 눌러도 키보드가 곧바로 내려간다(2026-08-27 실기기 재현 —
 * 입력칸 재탭에서 `mInputShown` 이 true → false 로 뒤집혔다).
 *
 * 그래서 **Final 패스**에서 본다. 이 패스는 자식이 먼저 처리한 **뒤**에 오므로, 입력칸·버튼이
 * 소비한 탭은 `isConsumed` 로 걸러지고 **아무도 가져가지 않은 빈 자리 탭**만 남는다.
 * 눌렀다 뗄 때만(위로 이벤트) 반응하므로 스크롤·스와이프도 그대로다.
 */
internal fun Modifier.clearFocusOnOutsideTap(): Modifier = composed {
    val focusManager = LocalFocusManager.current
    pointerInput(Unit) {
        awaitEachGesture {
            // 자식이 소비했는지 보려면 requireUnconsumed=false 로 받아야 한다.
            val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Final)
            if (down.isConsumed) return@awaitEachGesture
            var released = false
            while (true) {
                val event = awaitPointerEvent(PointerEventPass.Final)
                val change = event.changes.firstOrNull { it.id == down.id } ?: break
                if (change.isConsumed) return@awaitEachGesture
                if (!change.pressed) {
                    released = true
                    break
                }
            }
            if (released) focusManager.clearFocus()
        }
    }
}
