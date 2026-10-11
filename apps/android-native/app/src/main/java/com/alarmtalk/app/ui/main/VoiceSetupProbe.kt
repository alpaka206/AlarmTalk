package com.alarmtalk.app

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * 기본 목소리 **받기 화면**을 띄울지·닫을지 — 기기에 기본 목소리 클립 파일이 몇 개 있는가로 본다
 * (`MainViewModel.checkVoiceSetupFor`·`completeVoiceSetupIfDownloaded`). 판정은 그 둘의 KDoc 그대로이고,
 * 이 클래스가 정하는 것은 **어디서** 세는가뿐이다.
 *
 * ⚠ **세는 일은 [ioDispatcher] 에서 한다**(2026-10-10 Sentry 조사). 세기는 캐시 디렉터리를 통째로 읽고
 * 항목마다 stat 한다(`AlarmAudioStore.cachedStockClipCount`) — 기본 목소리만 76개(본체+메타 150여 개)인
 * 폴더다. 예전에는 세션이 시작되는 콜드 스타트의 `LaunchedEffect` 에서 메인 스레드로 셌다.
 *
 * '나중에 받기' 를 누른 계정은 세지 않는다 — 파일이 몇 개든 화면을 띄우지 않으므로 셀 이유가 없다.
 */
internal class VoiceSetupProbe(
    private val countCachedStockClips: () -> Int,
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
) {
    /** 받기 화면을 띄울 것인가 — 클립 파일이 하나도 없고, '나중에 받기' 를 누른 적이 없을 때. */
    suspend fun needsSetup(skipped: Boolean): Boolean = !skipped && count() == 0

    /** 받기가 끝나 화면을 닫아도 되는가 — **실제로 파일이 생겼을 때만**(워커는 받을 게 없어도 성공한다). */
    suspend fun anyDownloaded(): Boolean = count() > 0

    private suspend fun count(): Int = withContext(ioDispatcher) { countCachedStockClips() }
}
