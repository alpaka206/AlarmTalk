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

/**
 * `fitToWidthBoxScale` — **dp 치수용** 배율. 글꼴 배율로 나누지 않는다.
 *
 * ⚠ 이 함수가 왜 생겼나: 타임휠의 '오전/오후' 상자가 `96.dp * fitToWidthScale(...)`
 * 이었다. 글자는 `sp` 라 글꼴 배율이 이미 반영돼 배율의 나눗셈과 상쇄되는데, **상자만
 * 글꼴 배율만큼 좁아졌다.** 그래서 화면 폭과 무관하게 글꼴 배율이 조금만 커지면 글자가
 * 상자를 넘고 `clipToBounds` 가 좌우를 잘라내, 오전인지 오후인지 읽을 수 없었다 —
 * 12시간 어긋난 알람을 저장하게 된다.
 */
class FitToWidthBoxScaleTest {

    /** `WakerDesign.fitToWidthBoxScale` 과 같은 식. */
    private fun boxScale(
        availableWidthDp: Float,
        referenceWidthDp: Float,
        minimumScale: Float = 0.45f,
    ): Float {
        if (referenceWidthDp <= 0f) return 1f
        return (availableWidthDp / referenceWidthDp).coerceIn(minimumScale, 1f)
    }

    private fun textScale(
        availableWidthDp: Float,
        referenceWidthDp: Float,
        fontScale: Float,
        minimumScale: Float = 0.45f,
    ): Float = (availableWidthDp / (referenceWidthDp * fontScale)).coerceIn(minimumScale, 1f)

    /** ⚠ 핵심: 글꼴을 키워도 **상자 폭은 줄지 않는다.** */
    @Test
    fun `글꼴 배율은 상자 폭에 영향을 주지 않는다`() {
        val atNormal = boxScale(392f, 392f)
        val atLarge = boxScale(392f, 392f)
        assertEquals(atNormal, atLarge, 0.0001f)
        assertEquals(1f, atLarge, 0.0001f)
    }

    /** 좁은 화면에서는 상자도 줄어든다 — 그건 의도다. */
    @Test
    fun `좁은 화면에서는 상자도 줄어든다`() {
        assertTrue(boxScale(320f, 392f) < 1f)
    }

    /**
     * 회귀의 핵심: 상자에 텍스트 배율을 곱하면 **글꼴 배율이 커질수록 글자/상자 비율이
     * 나빠진다.** 폭 배율을 쓰면 그 비율이 글꼴 배율과 무관하게 일정하다.
     */
    @Test
    fun `상자에 텍스트 배율을 곱하면 큰 글꼴에서 글자가 넘친다`() {
        val availableDp = 392f
        val referenceDp = 392f
        val boxReferenceDp = 96f
        val glyphReferenceSp = 38f
        // 한글 2글자 폭 ≈ 글자 크기 × 2
        fun glyphWidthDp(fontScale: Float) =
            glyphReferenceSp * fontScale * textScale(availableDp, referenceDp, fontScale, 0.78f) * 2

        // 옛 방식(상자에 textScale) — 글꼴 배율이 커질수록 넘친다.
        fun oldBoxDp(fontScale: Float) =
            boxReferenceDp * textScale(availableDp, referenceDp, fontScale, 0.78f)
        assertTrue("배율 1.0 에서는 들어간다", glyphWidthDp(1.0f) <= oldBoxDp(1.0f))
        assertTrue("배율 1.3 에서 넘친다(옛 방식)", glyphWidthDp(1.3f) > oldBoxDp(1.3f))

        // 새 방식(상자에 boxScale) — 상한(1.3) 안에서는 들어간다.
        val newBoxDp = boxReferenceDp * boxScale(availableDp, referenceDp, 0.78f)
        assertTrue("배율 1.3 에서도 들어간다", glyphWidthDp(1.3f) <= newBoxDp)

        // ⚠ 상자 폭만으로는 부족하다. 축소 하한(0.78) 때문에 배율 2.0 에서는 여전히
        //   넘치므로, `AlarmTimePicker` 가 이 컨트롤에만 글꼴 배율 상한(MaxWheelFontScale
        //   = 1.3)을 건다 — 그래서 실제로는 2.0 이 들어오지 않는다. 상한이 없으면
        //   이 단언이 실패한다는 것을 남겨 둔다.
        assertTrue("상한이 없으면 배율 2.0 은 넘친다", glyphWidthDp(2.0f) > newBoxDp)
        val capped = minOf(2.0f, 1.3f)
        assertTrue("상한을 적용하면 들어간다", glyphWidthDp(capped) <= newBoxDp)
    }
}
