package com.alarmtalk.app.alarm

internal object VoiceVolumeRamp {
    const val FADE_IN_MS = 6_000L
    const val FADE_STEPS = 12

    private const val START_RATIO = 0.15f
    private const val MIN_START_VOLUME = 0.10f

    fun targetVolume(volumePercent: Int): Float =
        volumePercent.coerceIn(0, 100) / 100f

    fun plan(volumePercent: Int, fadeIn: Boolean): VoiceVolumeRampPlan {
        val target = targetVolume(volumePercent)
        if (!fadeIn || target <= 0f) {
            return VoiceVolumeRampPlan(
                startVolume = target,
                stepVolumes = emptyList(),
            )
        }

        val start = maxOf(
            MIN_START_VOLUME,
            target * START_RATIO,
        ).coerceAtMost(target)
        if (start >= target) {
            return VoiceVolumeRampPlan(
                startVolume = target,
                stepVolumes = emptyList(),
            )
        }

        val stepVolumes = (1..FADE_STEPS).map { step ->
            val progress = step.toFloat() / FADE_STEPS
            start + ((target - start) * progress)
        }
        return VoiceVolumeRampPlan(
            startVolume = start,
            stepVolumes = stepVolumes,
        )
    }
}

internal data class VoiceVolumeRampPlan(
    val startVolume: Float,
    val stepVolumes: List<Float>,
)
