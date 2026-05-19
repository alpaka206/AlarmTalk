package com.voicealarm.nativeapp.data

data class VoiceProfileCreationDraft(
    val name: String,
    val audio: CachedAlarmAudio,
    val shared: Boolean,
    val relationshipLabel: String,
)
