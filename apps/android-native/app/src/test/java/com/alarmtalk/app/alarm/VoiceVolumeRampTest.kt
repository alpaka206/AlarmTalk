package com.alarmtalk.app.alarm

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 목소리 게인은 **첫 샘플부터 target** 이다.
 *
 * ⚠ 예전에는 첫 재생을 15%(하한 10%)에서 시작해 6초에 걸쳐 올리는 램프가 있었고, 이 파일이
 * 그 동작을 고정하고 있었다(`firstPlaybackStartsQuietAndReachesTargetVolume` 등).
 * 그 6초가 TTS 한 문장보다 길어 문장 전체가 램프 구간이었고, 사용자에게 "소리가 안 난다" 로
 * 읽혀 문의가 반복됐다. 램프를 지웠으므로 그 테스트들도 함께 지운다 —
 * **정책이 바뀐 것이지 테스트가 깨진 게 아니다.**
 *
 * 램프를 다시 넣으려면 VoiceVolumeRamp 주석의 이력을 먼저 읽을 것.
 */
class VoiceVolumeRampTest {

    @Test
    fun targetVolumeMapsPercentToGain() {
        assertEquals(1f, VoiceVolumeRamp.targetVolume(100), 0.001f)
        assertEquals(0.30f, VoiceVolumeRamp.targetVolume(30), 0.001f)
        assertEquals(0f, VoiceVolumeRamp.targetVolume(0), 0.001f)
    }

    /** 저장값이 범위를 벗어나도 게인은 0..1 을 넘지 않는다. */
    @Test
    fun targetVolumeClampsOutOfRangePercent() {
        assertEquals(1f, VoiceVolumeRamp.targetVolume(140), 0.001f)
        assertEquals(0f, VoiceVolumeRamp.targetVolume(-20), 0.001f)
    }
}
