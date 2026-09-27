package com.alarmtalk.app.data

data class VoiceProfileCreationDraft(
    val name: String,
    val audio: CachedAlarmAudio,
    val shared: Boolean,
    val relationshipLabel: String,
    val listenerTitle: String,
    /** 미리듣기·사전렌더 문구 언어(ko/en/ja). null 이면 앱 로케일. */
    val language: String? = null,
    /**
     * 목소리의 결([VoiceEnergy]). 기본은 자동(빈 문자열).
     *
     * 동의 시트를 거쳐 등록을 이어 갈 때(`SensitiveConsentRequest.resumeVoiceDrafts`)도 이 값이
     * 그대로 실려 가야 한다 — 그래서 화면 상태가 아니라 이 초안에 둔다.
     */
    val voiceEnergy: String = VoiceEnergy.AUTO,
)
