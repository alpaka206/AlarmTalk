package com.alarmtalk.app.alarm

/**
 * 목소리 재생 게인.
 *
 * ⚠ **페이드인은 없다(2026-08-06 제거).** 예전에는 첫 재생을 target 의 15%(하한 10%)에서
 * 시작해 6초에 걸쳐 올렸는데, 그 6초가 TTS 한 문장보다 길어 **문장 전체가 램프 구간**이었다.
 * 첫 1초가 -16.5dB(체감 1/3)라 사용자에게는 "소리가 안 난다" 로 읽혔고, 실제로 그 문의가
 * 반복해서 들어왔다. 해제 후 한 번만 나오는 마무리 목소리는 만회할 회차조차 없었다.
 *
 * 램프를 다시 넣지 말 것. 넣어야 할 이유가 생기면 먼저 근거를 여기 적을 것 —
 * 도입 당시 커밋(9f1c0881·9803546f)에는 본문도 주석도 없어 무엇을 지키려던 것인지
 * 아무도 알 수 없었다. UI 가 페이드인을 약속한 적도 없다.
 *
 * 클릭 노이즈 걱정은 없다: 게인은 `start()` **이전에** 확정된다
 * (`RingingService.applyVoiceVolume` → `start()`). 알람 톤과 반복 재생 경로가 이미
 * 같은 순서로 target 부터 시작하고 있고 잡음 보고가 없다.
 */
internal object VoiceVolumeRamp {

    /** 저장된 퍼센트(0~100) → MediaPlayer 게인(0.0~1.0). */
    fun targetVolume(volumePercent: Int): Float =
        volumePercent.coerceIn(0, 100) / 100f
}
