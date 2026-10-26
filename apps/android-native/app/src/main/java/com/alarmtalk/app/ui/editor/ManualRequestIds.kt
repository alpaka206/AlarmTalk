package com.alarmtalk.app

import java.util.UUID

/**
 * 직접 입력 **'음성 만들기' 한 번의 id**(`request_id`, `docs/spec/voice-and-message.md` §8 「같은 요청」).
 *
 * 같은 입력(목소리·언어·문구)으로 다시 누르면 **같은 id** 를 준다 — 첫 요청이 아직 합성 중인데 응답이 끊겨 다시 누른 경우
 * 서버가 두 번 합성·차감하지 않고 409 `TTS_REQUEST_IN_PROGRESS` 로 기다리게 하거나, 끝난 결과를 세지 않고 준다. 입력이 바뀌면
 * 새 id 다(같은 id 에 다른 입력은 서버가 409 `TTS_REQUEST_ID_CONFLICT` 로 거절한다). 성공하면 잊는다 — 다음 만들기는 새
 * 요청이다. iOS 짝은 `VoiceStudioViewModel` 의 `manualRequestID`.
 */
internal class ManualRequestIds {
    private var key: String? = null
    private var id: String? = null

    fun idFor(voiceProfileId: String, language: String, text: String): String {
        val next = "$voiceProfileId\u0000$language\u0000$text"
        val current = id
        if (current != null && next == key) return current
        return UUID.randomUUID().toString().also {
            key = next
            id = it
        }
    }

    fun completed() {
        key = null
        id = null
    }
}
