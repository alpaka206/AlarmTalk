package com.alarmtalk.app.data

data class VoiceProfileCreationDraft(
    val name: String,
    val audio: CachedAlarmAudio,
    val shared: Boolean,
    val relationshipLabel: String,
    val listenerTitle: String,
    /** 미리듣기·사전렌더 문구 언어(ko/en/ja). null 이면 앱 로케일. */
    val language: String? = null,
)
