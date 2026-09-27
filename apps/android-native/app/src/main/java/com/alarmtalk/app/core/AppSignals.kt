package com.alarmtalk.app.core

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

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

    /**
     * plan_changed push 수신 — 구독/플랜/가족 상태 즉시 재조회 요청. 앱이 포그라운드로 살아 있으면
     * MainViewModel 의 live state(구독·플랜·가족)를 새로고침해 UI 가 만료된 유료 플랜을 계속
     * 보여주지 않게 한다(강등 워커는 SharedPreferences 만 쓰므로 live state 는 이 신호로 갱신).
     * 구독자가 없으면(앱 UI 미기동) 버려지고 워커+다음 앱 시작이 폴백.
     */
    val planChanged = MutableSharedFlow<Unit>(extraBufferCapacity = 1)

    fun emitPlanChanged() {
        planChanged.tryEmit(Unit)
    }

    private val appEntryCount = MutableStateFlow(0L)

    /**
     * **앱에 들어온 횟수**(프로세스 기준). 콜드 스타트와 백그라운드에서 돌아온 순간마다 1씩
     * 오른다 — `ProcessLifecycleOwner` 의 ON_START(`AlarmTalkApplication`).
     *
     * 화면 이동·회전으로는 오르지 않는다: 액티비티 수명이 아니라 **프로세스** 수명을 보고,
     * 그 수명은 마지막 화면이 내려간 뒤 잠깐의 유예를 두고서야 멈춤으로 넘어간다.
     * '진입할 때마다' 뜨는 안내(기간 한정 개인 플랜 종료 안내)가 이 번호를 기준으로
     * 진입 한 번에 한 번만 뜬다. 0 은 '아직 진입하지 않았다' 다.
     *
     * ⚠ 컴포지션에서 옵저버를 직접 걸지 말 것 — 회전으로 다시 걸리는 순간 이미 STARTED 인
     *   수명이 ON_START 를 곧바로 한 번 더 보내 **회전이 진입으로 세어진다.**
     */
    val appEntries: StateFlow<Long> = appEntryCount.asStateFlow()

    fun markAppEntered() {
        appEntryCount.update { it + 1 }
    }
}
