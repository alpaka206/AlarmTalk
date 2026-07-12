package com.alarmtalk.app.data

data class VoiceProfileCreationDraft(
    val name: String,
    val audio: CachedAlarmAudio,
    val shared: Boolean,
    val relationshipLabel: String,
    val listenerTitle: String,
)
