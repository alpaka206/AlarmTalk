package com.alarmtalk.app

import org.junit.Assert.assertEquals
import org.junit.Test

class VoiceInputControlsTest {
    @Test
    fun rightHandleDragPastMaxDurationSlidesLeftHandleAlong() {
        val range = constrainedAudioCropRange(
            currentStartMillis = 30_000L,
            currentEndMillis = 150_000L,
            rawStartMillis = 30_000L,
            rawEndMillis = 210_000L,
            durationMillis = 240_000L,
            minDurationMillis = 60_000L,
            maxDurationMillis = 120_000L,
        )

        // 끝을 max(2분) 너머로 끌면 막지 않고 창 전체가 오른쪽으로 밀린다 — 시작도 따라온다.
        assertEquals(90_000L, range.startMillis)
        assertEquals(210_000L, range.endMillis)
    }

    @Test
    fun rightHandleSlideStopsAtFileEnd() {
        val range = constrainedAudioCropRange(
            currentStartMillis = 60_000L,
            currentEndMillis = 180_000L,
            rawStartMillis = 60_000L,
            rawEndMillis = 260_000L,
            durationMillis = 200_000L,
            minDurationMillis = 60_000L,
            maxDurationMillis = 120_000L,
        )

        // 파일 끝(200s)을 넘지는 못하고, 그 지점에서 max 폭 창으로 멈춘다.
        assertEquals(80_000L, range.startMillis)
        assertEquals(200_000L, range.endMillis)
    }

    @Test
    fun rightHandleDragWithinMaxDurationKeepsLeftHandleFixed() {
        val range = constrainedAudioCropRange(
            currentStartMillis = 30_000L,
            currentEndMillis = 150_000L,
            rawStartMillis = 30_000L,
            rawEndMillis = 110_000L,
            durationMillis = 240_000L,
            minDurationMillis = 60_000L,
            maxDurationMillis = 120_000L,
        )

        assertEquals(30_000L, range.startMillis)
        assertEquals(110_000L, range.endMillis)
    }

    @Test
    fun leftHandleDragPastMaxDurationSlidesRightHandleAlong() {
        val range = constrainedAudioCropRange(
            currentStartMillis = 30_000L,
            currentEndMillis = 150_000L,
            rawStartMillis = 0L,
            rawEndMillis = 150_000L,
            durationMillis = 240_000L,
            minDurationMillis = 60_000L,
            maxDurationMillis = 120_000L,
        )

        // 대칭 — 시작을 max 너머로 왼쪽으로 끌면 창 전체가 왼쪽으로 밀리고 끝도 따라온다.
        assertEquals(0L, range.startMillis)
        assertEquals(120_000L, range.endMillis)
    }

    @Test
    fun movingStartClampsToMinimumDurationWithoutMovingEnd() {
        val range = constrainedAudioCropRange(
            currentStartMillis = 30_000L,
            currentEndMillis = 150_000L,
            rawStartMillis = 140_000L,
            rawEndMillis = 150_000L,
            durationMillis = 240_000L,
            minDurationMillis = 60_000L,
            maxDurationMillis = 120_000L,
        )

        assertEquals(90_000L, range.startMillis)
        assertEquals(150_000L, range.endMillis)
    }

    @Test
    fun movingEndClampsToMinimumDurationWithoutMovingStart() {
        val range = constrainedAudioCropRange(
            currentStartMillis = 30_000L,
            currentEndMillis = 150_000L,
            rawStartMillis = 30_000L,
            rawEndMillis = 50_000L,
            durationMillis = 240_000L,
            minDurationMillis = 60_000L,
            maxDurationMillis = 120_000L,
        )

        assertEquals(30_000L, range.startMillis)
        assertEquals(90_000L, range.endMillis)
    }
}
