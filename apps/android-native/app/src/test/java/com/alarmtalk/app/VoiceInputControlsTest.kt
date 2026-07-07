package com.alarmtalk.app

import org.junit.Assert.assertEquals
import org.junit.Test

class VoiceInputControlsTest {
    @Test
    fun rightHandleDragPastMaxDurationKeepsLeftHandleFixed() {
        val range = constrainedAudioCropRange(
            currentStartMillis = 30_000L,
            currentEndMillis = 150_000L,
            rawStartMillis = 30_000L,
            rawEndMillis = 210_000L,
            durationMillis = 240_000L,
            minDurationMillis = 60_000L,
            maxDurationMillis = 120_000L,
        )

        assertEquals(30_000L, range.startMillis)
        assertEquals(150_000L, range.endMillis)
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
    fun leftHandleDragPastMaxDurationKeepsRightHandleFixed() {
        val range = constrainedAudioCropRange(
            currentStartMillis = 30_000L,
            currentEndMillis = 150_000L,
            rawStartMillis = 0L,
            rawEndMillis = 150_000L,
            durationMillis = 240_000L,
            minDurationMillis = 60_000L,
            maxDurationMillis = 120_000L,
        )

        assertEquals(30_000L, range.startMillis)
        assertEquals(150_000L, range.endMillis)
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
