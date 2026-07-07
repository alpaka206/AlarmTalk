package com.alarmtalk.app.data

data class VoiceProfileCreationDraft(
    val name: String,
    val audio: CachedAlarmAudio,
    val shared: Boolean,
    val relationshipLabel: String,
    val listenerTitle: String,
    // 'male' | 'female' | 'neutral'
    val voiceGender: String = "neutral",
    // 'auto' | 'polite'
    val speechFormality: String = "auto",
)

data class VoiceProfilePromotionDraft(
    val name: String,
    val shared: Boolean,
    val relationshipLabel: String,
    val listenerTitle: String,
    val voiceGender: String = "neutral",
    val speechFormality: String = "auto",
)
