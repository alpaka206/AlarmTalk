package com.alarmtalk.app

import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalFocusManager

/**
 * **입력칸을 누른 탭**을 표시해 두는 자리 — 이 탭 하나만 '입력 종료' 에서 빠진다.
 *
 * 왜 부모가 스스로 판정하지 못하는가: Compose 에서 부모 modifier 는 **무엇이 눌렸는지**를
 * 알 수 없다. 소비 여부(`isConsumed`)로는 갈라지지 않는다 — 입력칸도, 버튼도, 목록 행도
 * 똑같이 소비하기 때문이다. iOS 는 `touch.view is UITextField` 로 히트 대상을 직접 보지만
 * (`KeyboardDismissGesture`), 안드로이드에는 그런 질의가 없다. 그래서 **입력칸이 스스로**
 * 표시한다.
 */
internal class TextInputTapTracker {
    /** 입력칸 위에서 시작한 down 의 uptime. 같은 제스처인지 이 값으로 대조한다. */
    var markedDownUptimeMillis: Long = -1L
}

internal val LocalTextInputTapTracker = staticCompositionLocalOf { TextInputTapTracker() }

/**
 * **입력칸에 붙인다** — 이 칸을 누르는 탭은 편집을 끝내지 않는다.
 *
 * `Initial` 패스에서 표시한다. 패스 순서가 Initial(부모→자식) → Main(자식→부모) →
 * Final(부모→자식) 이라, 부모가 [clearFocusOnOutsideTap] 에서 Final 로 볼 때는 이 표시가
 * **이미 찍혀 있다.** 이벤트를 소비하지 않으므로 칸 자체의 동작(커서 이동·선택)은 그대로다.
 */
internal fun Modifier.textInputTapTarget(): Modifier = composed {
    val tracker = LocalTextInputTapTracker.current
    pointerInput(Unit) {
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
            tracker.markedDownUptimeMillis = down.uptimeMillis
        }
    }
}

/**
 * **입력창 밖을 누르면 입력이 끝난다**(2026-08-27 지시, iOS `KeyboardDismissGesture` 와 같은 규칙).
 *
 * 규칙은 두 쪽이고 **둘을 같이** 지켜야 한다:
 *  - 밖을 눌렀는데 키보드가 남으면 요청한 동작이 아니고,
 *  - **입력칸을 눌렀는데 키보드가 내려가면 글자를 아예 못 친다.**
 *
 * ⚠ **`detectTapGestures` 로 만들지 말 것.** 그러면 입력칸 탭까지 이 부모가 받아 눌러도
 * 초점이 곧바로 풀린다(2026-08-27 실기기 재현 — 입력칸 재탭에서 `mInputShown` 이
 * true → false 로 뒤집혔다).
 *
 * ⚠ **소비 여부로 가르지 말 것**(2026-08-28 리뷰). 예전에는 '아무도 소비하지 않은 탭' 만
 * 받았는데, 그러면 **버튼·슬라이더·목록 행을 누를 때 키보드가 그대로 남는다** — 소비하는
 * 것은 입력칸만이 아니기 때문이다. 지시는 "입력창을 누르는 것이 아니라면 어디를 눌러도
 * 끝난다" 이므로, 판정은 소비가 아니라 **[textInputTapTarget] 표시**로 한다.
 *
 * ⚠ **뒤에 레이어를 까는 방식도 안 된다** — 스크롤 컨테이너가 탭을 소비해 닿지 않는다.
 *
 * ⚠ **창이 다르면 여기 것이 닿지 않는다.** 다이얼로그·모달 시트는 자기 창이라 그 컨테이너에
 * 따로 걸어야 한다(`IosAlertDialog`, `WakerModal` 의 두 시트, 목소리 등록 `Dialog`).
 */
internal fun Modifier.clearFocusOnOutsideTap(): Modifier = composed {
    val focusManager = LocalFocusManager.current
    val tracker = LocalTextInputTapTracker.current
    pointerInput(Unit) {
        awaitEachGesture {
            // 자식이 소비한 탭도 받아야 한다(버튼·목록 행) — requireUnconsumed = false.
            val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Final)
            // 입력칸이 Initial 패스에서 이미 표시했다면 그 칸을 누른 것이다 — 건드리지 않는다.
            if (tracker.markedDownUptimeMillis == down.uptimeMillis) return@awaitEachGesture
            var released = false
            while (true) {
                val event = awaitPointerEvent(PointerEventPass.Final)
                val change = event.changes.firstOrNull { it.id == down.id } ?: break
                if (!change.pressed) {
                    released = true
                    break
                }
            }
            if (released) focusManager.clearFocus()
        }
    }
}
