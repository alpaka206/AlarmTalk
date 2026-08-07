package com.alarmtalk.app.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * `fitToWidthScale` 의 셈. Compose 밖에서 검증할 수 있게 같은 식을 여기 옮겨 둔다.
 *
 * 왜 필요한가: 갤럭시 폴드 커버 화면에서 **울림 화면 시각이 겹쳐 보인다**는 제보가 있었다.
 * 104sp 고정 시계가 폭을 넘긴 것이고, 큰 글꼴을 켜면 더 심해진다.
 *
 * ⚠ **글꼴 배율로 나누는 것이 핵심이다.** 폭은 dp 라 사용자가 글꼴을 키워도 그대로인데
 * 글자만 커진다 — 폭만 보고 줄이면 큰 글꼴에서 그대로 넘친다.
 */
class FitToWidthScaleTest {

    /** `WakerDesign.fitToWidthScale` 과 같은 식. */
    private fun scale(
        availableWidthDp: Float,
        referenceWidthDp: Float,
        fontScale: Float,
        minimumScale: Float = 0.45f,
    ): Float {
        if (referenceWidthDp <= 0f || fontScale <= 0f) return 1f
        return (availableWidthDp / (referenceWidthDp * fontScale)).coerceIn(minimumScale, 1f)
    }

    @Test
    fun `넉넉한 폭에서는 줄이지 않는다`() {
        assertEquals(1f, scale(availableWidthDp = 411f, referenceWidthDp = 320f, fontScale = 1f), 0.001f)
    }

    @Test
    fun `폴드 커버 폭에서는 줄인다`() {
        // 커버 화면 ≈ 280dp. 320dp 가 필요하니 0.875 로 줄어야 한다.
        val s = scale(availableWidthDp = 280f, referenceWidthDp = 320f, fontScale = 1f)
        assertEquals(0.875f, s, 0.001f)
        assertTrue("줄어들어야 한다", s < 1f)
    }

    @Test
    fun `큰 글꼴은 폭이 넉넉해도 줄인다`() {
        // 폭은 411dp 로 충분하지만 글꼴이 1.8배면 글자가 320×1.8 = 576dp 를 요구한다.
        val s = scale(availableWidthDp = 411f, referenceWidthDp = 320f, fontScale = 1.8f)
        assertTrue("큰 글꼴에서 줄지 않으면 시각이 겹친다(제보된 증상)", s < 1f)
        assertEquals(411f / 576f, s, 0.001f)
    }

    @Test
    fun `하한 아래로는 줄이지 않는다`() {
        // 읽을 수 없을 만큼 줄이면 화면의 존재 이유가 사라진다.
        val s = scale(availableWidthDp = 100f, referenceWidthDp = 320f, fontScale = 2f)
        assertEquals(0.45f, s, 0.001f)
    }

    @Test
    fun `이상한 값이 와도 1을 돌려준다`() {
        assertEquals(1f, scale(300f, referenceWidthDp = 0f, fontScale = 1f), 0.001f)
        assertEquals(1f, scale(300f, referenceWidthDp = 320f, fontScale = 0f), 0.001f)
    }
}
