package com.alarmtalk.app.data

/**
 * 목소리 등록 한 건(= 초안 클론 요청 하나).
 *
 * ⚠ **목소리의 결(경쾌/차분)은 여기 없다**(2026-09-29 사용자 결정 — '목소리 느낌' 선택 제거).
 * 앱은 결을 고르게 하지도, 보내지도 않는다 — 서버가 등록 녹음 **전사**로 추정한 말투
 * (`speech_style.energy`)를 쓴다(`docs/spec/voice-and-message.md` 4-2). 되살리지 말 것.
 */
data class VoiceProfileCreationDraft(
    val name: String,
    val audio: CachedAlarmAudio,
    val shared: Boolean,
    val relationshipLabel: String,
    val listenerTitle: String,
    /** 미리듣기·사전렌더 문구 언어(ko/en/ja). null 이면 앱 로케일. */
    val language: String? = null,
)
