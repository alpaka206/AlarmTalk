package com.alarmtalk.app

import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.sync.StockClipPrefetchWorker
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * 알람 설정 화면(새로 만들기·고치기)을 열기 전의 **기본 목소리 관문** — 세는 일은 메인 밖에서,
 * 한 번에 하나만 한다.
 *
 * **무엇을 막는가**는 `docs/spec/voice-and-message.md` 「기본 목소리를 다 받아야 알람을 설정한다」
 * 그대로이고, 판정식은 `StockClipPrefetchWorker.defaultVoicesReady` 하나다. 이 클래스가 정하는
 * 것은 **어디서·몇 번** 세는가뿐이다 — 판정을 여기서 다시 쓰지 말 것.
 *
 * 2026-09-29 A32 실측: ＋ 를 누르면 이 판정이 **메인 스레드에서** 돌았고 한 번에 1.4~1.8초였다.
 * ＋ 는 그걸 두 번(`requestCreateAlarm` → `startCreateAlarm`) 불러 약 3.5초 멎었고, 멎은 동안
 * 쌓인 탭이 판정을 줄줄이 이어 붙여 15.8초까지 멎었다. 그래서 셋을 지킨다:
 *  - **IO 에서 센다.** 결과만 메인으로 가져와 적용한다.
 *  - **탭 하나에 한 번.** 막히면 센 값 그대로 알럿 퍼센트를 쓴다(다시 세지 않는다).
 *  - **도는 동안 들어온 탭은 버린다.** 쌓아 두면 판정이 끝날 때마다 화면이 또 열린다.
 *
 * ⚠ 세는 동안 **자리가 바뀌었으면 결과를 버린다**(Codex #821). 메인 밖에서 세는 순간 탭과
 * 결과 사이에 틈이 생긴다 — 그 사이 다른 탭으로 옮겼거나 계정이 바뀌었으면, 옛 탭의 결과로
 * 편집기를 열거나 알럿을 띄우면 **새 화면 위에** 뜬다. 판정은 호출자가 넘기는 `isStillCurrent`
 * 하나이고, 메인에서 결과를 적용하기 **직전에** 본다.
 *
 * iOS 는 한 번 세는 데 디렉터리를 한 번만 읽어(`AudioCacheStore.missingOrStaleCacheKeys`)
 * 이만큼 멎지 않는다.
 */
internal class DefaultVoiceGate(
    private val scope: CoroutineScope,
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
) {
    /** 판정이 도는 중인가. [scope] 의 디스패처(메인)에서만 읽고 쓴다. */
    var inFlight: Boolean = false
        private set

    /**
     * @param progress 기본 목소리 진행률(done to total, 모르면 null). [ioDispatcher] 에서 부른다.
     * @param onReady 다 받았다 — 화면을 연다. [scope] 의 디스패처에서 부른다.
     * @param onBlocked 아직이다(또는 셀 수 없었다) — 이유를 말한다. 센 값을 그대로 받는다.
     * @param isStillCurrent 탭한 화면·계정이 아직 그대로인가. 다 센 뒤 [scope] 의 디스패처에서
     *   부르고, false 면 [onReady]·[onBlocked] 둘 다 부르지 않는다(결과를 버린다).
     * @return 이번 요청을 받았는가. false 면 앞 판정이 아직 돌고 있어 **버렸다.**
     */
    fun request(
        progress: () -> Pair<Int, Int>?,
        onReady: () -> Unit,
        onBlocked: (Pair<Int, Int>?) -> Unit,
        isStillCurrent: () -> Boolean = { true },
    ): Boolean {
        if (inFlight) return false
        inFlight = true
        scope.launch {
            try {
                val counted = try {
                    withContext(ioDispatcher) { progress() }
                } catch (error: CancellationException) {
                    throw error
                } catch (error: Exception) {
                    // 셀 수 없으면 '모른다' 다 — 관문은 모르면 막는다(스펙). 예전에는 메인에서
                    // 던져 앱이 죽었을 자리다.
                    AlarmTalkLog.reportError("Default voice readiness check failed", error)
                    null
                }
                // 탭한 뒤 다른 화면·계정으로 옮겼으면 옛 탭의 결과다 — 열지도, 알럿을 띄우지도 않는다.
                if (!isStillCurrent()) return@launch
                if (StockClipPrefetchWorker.defaultVoicesReady(counted)) onReady() else onBlocked(counted)
            } finally {
                inFlight = false
            }
        }
        return true
    }
}
