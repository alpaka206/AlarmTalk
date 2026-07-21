package com.alarmtalk.app.core

import kotlinx.coroutines.flow.MutableSharedFlow

/**
 * 프로세스 전역 신호 버스 — FCM 서비스(비 Compose)가 UI 계층(MainViewModel)에 새로고침을
 * 요청할 때 쓴다. 구독자가 없으면(앱 UI 미기동) 신호는 버려지며, 다음 앱 시작 시
 * 초기 로드가 어차피 최신 상태를 가져오므로 유실이 문제되지 않는다.
 */
object AppSignals {
    /** 목소리 공유 on/off push 수신 — 공유 목소리 목록/스톡 매니페스트 즉시 새로고침 요청. */
    val voiceShareChanged = MutableSharedFlow<Unit>(extraBufferCapacity = 1)

    fun emitVoiceShareChanged() {
        voiceShareChanged.tryEmit(Unit)
    }
}
