package com.alarmtalk.app.data

/**
 * **목소리의 결** — 등록 '세부 정보' 단계의 '목소리 느낌'(자동 / 경쾌 / 차분, 이 순서로 그린다).
 *
 * 클론 문구(사전렌더·등록 미리듣기)의 말투와 태그를 이 결에 맞춘다
 * (`docs/spec/voice-and-message.md` 4-1·4-2). 서버 계약은 `@alarmtalk/shared` 의
 * `VoiceEnergySchema`(`'' | 'lively' | 'calm'`)이고, 초안을 만드는 클론 요청의 `voiceEnergy`
 * 폼 필드로 보낸다(`network/VoiceCloneRequest.kt`).
 *
 * - **자동은 빈 문자열이다.** 서버가 등록 녹음 전사로 추정한 결을 쓴다 — 앱이 따로 정하지 않는다.
 * - 선택 입력이다. 기본값이 자동이라 고르지 않아도 등록이 막히지 않는다.
 * - 이 셋 밖의 값은 서버가 400 `INVALID_VOICE_ENERGY` 로 거절한다. 화면은 이 셋만 고를 수 있게 그린다.
 */
object VoiceEnergy {
    const val AUTO = ""
    const val LIVELY = "lively"
    const val CALM = "calm"
}
