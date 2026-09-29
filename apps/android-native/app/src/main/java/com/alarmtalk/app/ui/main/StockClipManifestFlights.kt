package com.alarmtalk.app

import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.async

/** 매니페스트가 **얼마나 새것이어야** 하는가. 부르는 자리가 고른다. */
internal enum class ManifestNeed {
    /** 이번 세션에 한 번이라도 받아 공개했으면 된다 — 앱 시작. */
    SESSION,

    /**
     * [StockClipManifestFlights.FRESH_WINDOW_MS] 안에 출발해 공개된 것이면 된다 — 탭 새로고침·
     * 준비도처럼 "요즘 것" 이면 되는 자리.
     */
    RECENT,

    /**
     * **부른 뒤에 출발한** 요청이어야 한다 — 서버 쪽이 바뀌었다는 신호(공유 변경 푸시, 클론 생성
     * 완료) 뒤. 그 전에 출발한 요청에는 바뀐 내용이 없을 수 있다.
     */
    LATEST,
}

/** 조회 한 번의 결과. */
internal enum class ManifestFlightOutcome {
    /** 이미 충분히 새것이다 — 요청을 내지 않았다. */
    FRESH,

    /** 이 응답이 디스크 권위가 됐고 메모리에도 실렸다. */
    PUBLISHED,

    /** 더 새 표가 이미 공개됐다(또는 표가 무효화됐다). 실패는 아니다. */
    SUPERSEDED,

    /** 받지 못했거나 디스크에 못 남겼거나, 그사이 계정이 바뀌었다. */
    FAILED,
}

/**
 * 스톡 클립 매니페스트(`GET /tts/stock-clips`, 약 168KB) 조회를 **한 번에 하나**로 묶는다
 * (2026-09-29 효율 감사 M1).
 *
 * 예전에는 앱 시작·탭 새로고침·준비도·클론 다운로드가 저마다 받아, 콜드 스타트 한 번에 15번
 * 나갔다(`loadStockClips` 는 부를 때마다 앞선 응답을 버렸고, 준비도·클론 다운로드는 표 없이
 * 받아 **Codex #703 가드를 우회**했다). 이제 셋을 지킨다:
 *  - **떠 있는 요청을 나눠 쓴다.** 같은 계정이 이미 받고 있으면 새로 내지 않고 그 결과를 기다린다.
 *  - **신선도 창.** [ManifestNeed.RECENT] 는 [FRESH_WINDOW_MS] 안에 출발해 공개된 응답이 있으면
 *    요청을 내지 않는다. [ManifestNeed.SESSION] 은 그 세션에 한 번 공개했으면 된다.
 *  - **[ManifestNeed.LATEST] 는 부른 뒤에 출발한 요청만 쓴다.** 떠 있는 요청은 부르기 전에
 *    출발했으므로 그 뒤에 **한 번만** 줄을 세우고, 그사이 들어온 LATEST 는 전부 그 줄을 나눠 쓴다.
 *
 * ⚠ **요청 자체([run])는 언제나 표·세대 가드를 거친다**(`StockClipManifestStore.beginFetch`/`save`).
 * 이 클래스는 **몇 번** 받을지만 정한다 — 무엇을 공개할지는 표가 정한다. 신선도는 **공개된**
 * 응답만 센다. 물러났거나(SUPERSEDED) 실패한 회차는 다음 호출이 다시 받는다.
 *
 * ⚠ 워커(`StockClipPrefetchWorker`·`VoiceAccessSyncWorker`)의 조회는 여기 묶지 않는다. 뷰모델이
 * 없는 프로세스에서도 돌고, 교체 확정 판단에 **그 회차가 직접 받은** 매니페스트가 필요하다(의도).
 *
 * [scope] 의 디스패처(메인)에서만 부른다 — 상태를 잠그지 않는다.
 *
 * @param Owner 계정 + 세션 세대(`SessionEffectKey`). 다른 주인의 요청은 나눠 쓰지 않는다.
 */
internal class StockClipManifestFlights<Owner : Any>(
    private val scope: CoroutineScope,
    private val clock: () -> Long,
    private val freshWindowMs: Long = FRESH_WINDOW_MS,
) {
    private inner class Flight(val owner: Owner) {
        lateinit var result: Deferred<ManifestFlightOutcome>

        /** 요청을 이미 냈는가. 줄만 서 있는 동안은 false — 그동안 온 LATEST 가 나눠 쓸 수 있다. */
        var issued = false
    }

    /** 요청을 낸 채 끝나지 않은 것. */
    private var running: Flight? = null

    /** [running] 이 끝나면 출발할 것(LATEST 가 세운 줄). */
    private var queued: Flight? = null

    /** 마지막으로 **공개된** 응답의 주인과, 그 요청을 낸 시각. */
    private var freshOwner: Owner? = null
    private var freshIssuedAt: Long = 0L

    /** 지금까지 [run] 을 부른 수(= 낸 요청 수의 상한). 테스트용. */
    var runCount: Int = 0
        private set

    /**
     * [need] 만큼 새 매니페스트가 메모리에 실리도록 한다. 필요하면 [run] 으로 요청을 **하나** 낸다.
     *
     * @param run 요청 한 번(표 뽑기 → 조회 → 공개 → 메모리 반영). 떠 있는 요청을 나눠 쓰면
     *   이번 호출의 [run] 은 쓰이지 않는다 — 같은 주인의 [run] 은 같은 일을 해야 한다.
     */
    suspend fun ensure(
        owner: Owner,
        need: ManifestNeed,
        run: suspend () -> ManifestFlightOutcome,
    ): ManifestFlightOutcome {
        val fresh = freshOwner == owner && when (need) {
            ManifestNeed.SESSION -> true
            ManifestNeed.RECENT -> clock() - freshIssuedAt < freshWindowMs
            ManifestNeed.LATEST -> false
        }
        if (fresh) return ManifestFlightOutcome.FRESH
        // 부른 쪽이 취소돼도 요청은 끝까지 간다(다른 쪽이 기다리고 있다) — await 만 풀린다.
        return pick(owner, need, run).result.await()
    }

    private fun pick(owner: Owner, need: ManifestNeed, run: suspend () -> ManifestFlightOutcome): Flight {
        val active = running?.takeIf { it.owner == owner && it.result.isActive }
        // 줄만 서 있고 아직 요청을 안 낸 것 — 누가 와도 나눠 쓸 수 있다(LATEST 도: 부른 뒤에 출발한다).
        val waiting = queued?.takeIf { it.owner == owner && !it.issued && it.result.isActive }
        if (need == ManifestNeed.LATEST) {
            // 떠 있는 요청은 부르기 **전에** 출발했다 — 그 뒤에 선 줄을 나눠 쓰거나 새로 세운다.
            waiting?.let { return it }
            return start(owner, run, after = active)
        }
        // ⚠ 줄 선 것도 본다. 앞 요청이 막 끝나 [running] 이 비었는데 줄 선 것이 아직 출발 전인
        // 틈에 새로 내면, 같은 계정의 요청 둘이 동시에 뜬다.
        return active ?: waiting ?: start(owner, run, after = null)
    }

    private fun start(owner: Owner, run: suspend () -> ManifestFlightOutcome, after: Flight?): Flight {
        val flight = Flight(owner)
        flight.result = scope.async(start = CoroutineStart.LAZY) {
            // 앞 요청이 끝날 때까지 기다린다. 앞 요청의 성패는 상관없다(join 은 던지지 않는다).
            after?.result?.join()
            running = flight
            if (queued === flight) queued = null
            flight.issued = true
            runCount += 1
            val issuedAt = clock()
            try {
                val outcome = try {
                    run()
                } catch (error: CancellationException) {
                    throw error
                } catch (error: Exception) {
                    ManifestFlightOutcome.FAILED
                }
                if (outcome == ManifestFlightOutcome.PUBLISHED) {
                    freshOwner = owner
                    freshIssuedAt = issuedAt
                }
                outcome
            } finally {
                if (running === flight) running = null
            }
        }
        if (after == null) running = flight else queued = flight
        flight.result.start()
        return flight
    }

    companion object {
        /**
         * 신선도 창. 탭 새로고침 스로틀(60초)보다 짧게 둔다 — 알람 탭과 목소리 탭을 오가는
         * 사이에 같은 목록을 두 번 받지 않을 만큼이면 된다. 서버가 바뀐 것을 **아는** 자리는
         * 이 창을 쓰지 않는다([ManifestNeed.LATEST]).
         */
        const val FRESH_WINDOW_MS: Long = 45_000L
    }
}
