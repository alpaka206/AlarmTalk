package com.alarmtalk.app

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.alarmtalk.app.core.AlarmTalkLog
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * 저장 버튼의 **로컬 확인** — 같은 직접 입력 문구로 만든 오디오가 이 폰에 이미 있는가.
 *
 * 무엇을 어떤 순서로 보는가는 `docs/spec/voice-and-message.md` §8 「저장할 때의 순서」(① 로컬 확인 →
 * ② 오프라인이면 막는다 → ③ 남은 횟수 → ④ 생성)이고, 이 클래스가 정하는 것은 ①을 **어디서·몇 번**
 * 하는가뿐이다(`docs/spec/alarm-editor.md` §6). 찾는 일 자체는 `AlarmAudioStore.findReusableTtsAudio`.
 *
 * 2026-10-10 Sentry 조사: 저장을 누르는 순간 이 확인(별칭 `.meta` 읽기 → 파일 찾기 →
 * `MediaMetadataRetriever` 로 길이 재기)이 **메인 스레드에서** 돌았고, 오프라인이면 저장 사유를 셀 때마다
 * (화면이 다시 그려질 때마다) 같은 파일을 또 읽었다. 그래서 셋을 지킨다:
 *  - **IO 에서 찾는다**([ioDispatcher]). 결과만 메인([scope] 의 디스패처)으로 가져와 적용한다.
 *  - **찾는 동안이 곧 '저장 중' 이다.** [inFlight] 가 서 있는 동안 편집기의 `busy` 가 버튼을 잠그고,
 *    그 사이 들어온 요청은 **버린다**(쌓지 않는다). 쌓아 두면 같은 알람이 두 번 저장되고 완료 콜백이
 *    두 번 팝해 검은 화면이 된다(`CLAUDE.md` 「저장 뒤 검은 화면」).
 *  - **잠금이 풀리는 틈이 없다.** [inFlight] 는 결과를 적용한 **뒤에** 내린다 — 적용이 곧바로 뷰모델의
 *    저장 중(`alarmSaving`)이나 편집기의 생성 중(`generating`)을 세우므로 `busy` 가 끊기지 않는다.
 *
 * 화면이 사라지면([scope] 취소) 결과를 적용하지 않는다 — 떠난 편집기가 저장하거나 팝하지 않는다.
 * 모양은 알람 관문(`DefaultVoiceGate`)과 같다.
 */
internal class ManualAudioReuseGate(
    private val scope: CoroutineScope,
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
) {
    /** 찾는 중인가. [scope] 의 디스패처(메인)에서만 쓴다 — 편집기의 `busy` 가 읽어 버튼을 잠근다. */
    var inFlight by mutableStateOf(false)
        private set

    /**
     * @param lookup 폰에서 찾는다 — [ioDispatcher] 에서 부른다. 편집기 상태는 읽지 말고 필요한 값을 미리
     *   잡아 넘길 것(누른 순간의 값이어야 한다).
     * @param onFound 찾았다 — 서버를 부르지 않고 저장한다. [scope] 의 디스패처에서 부른다.
     * @param onMissing 없다(찾다 실패한 것 포함) — 다음 단계(오프라인 판정·생성)로 간다.
     * @return 이번 요청을 받았는가. false 면 앞 요청이 아직 돌고 있어 **버렸다.**
     */
    fun <T : Any> request(
        lookup: () -> T?,
        onFound: (T) -> Unit,
        onMissing: () -> Unit,
    ): Boolean {
        if (inFlight) return false
        inFlight = true
        scope.launch {
            try {
                val found = try {
                    withContext(ioDispatcher) { lookup() }
                } catch (error: CancellationException) {
                    throw error
                } catch (error: Exception) {
                    // 찾다 실패하면 '없다' 로 본다 — 서버 경로가 다시 만든다. 예전에는 메인에서 던져
                    // 앱이 죽었을 자리다.
                    AlarmTalkLog.reportError("Local manual audio lookup failed", error)
                    null
                }
                if (found != null) onFound(found) else onMissing()
            } finally {
                inFlight = false
            }
        }
        return true
    }
}
