package com.alarmtalk.app.alarm

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class VoiceVolumeRampTest {
    @Test
    fun firstPlaybackStartsQuietAndReachesTargetVolume() {
        val plan = VoiceVolumeRamp.plan(volumePercent = 100, fadeIn = true)

        assertEquals(0.15f, plan.startVolume, 0.001f)
        assertEquals(VoiceVolumeRamp.FADE_STEPS, plan.stepVolumes.size)
        assertEquals(1f, plan.stepVolumes.last(), 0.001f)
        assertTrue(plan.stepVolumes.zipWithNext().all { (left, right) -> right > left })
    }

    @Test
    fun repeatedPlaybackStartsAtTargetVolume() {
        val plan = VoiceVolumeRamp.plan(volumePercent = 100, fadeIn = false)

        assertEquals(1f, plan.startVolume, 0.001f)
        assertTrue(plan.stepVolumes.isEmpty())
    }

    @Test
    fun lowConfiguredVoiceVolumeStillFadesWhenThereIsRoom() {
        val plan = VoiceVolumeRamp.plan(volumePercent = 30, fadeIn = true)

        assertTrue(plan.startVolume < 0.30f)
        assertEquals(VoiceVolumeRamp.FADE_STEPS, plan.stepVolumes.size)
        assertEquals(0.30f, plan.stepVolumes.last(), 0.001f)
    }

    @Test
    fun mutedVoiceStaysMuted() {
        val plan = VoiceVolumeRamp.plan(volumePercent = 0, fadeIn = true)

        assertEquals(0f, plan.startVolume, 0.001f)
        assertTrue(plan.stepVolumes.isEmpty())
    }
}
