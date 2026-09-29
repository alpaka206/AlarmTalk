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

    /**
     * 더 새 표의 응답이 **이미 공개됐고**, 그 이긴 매니페스트를 메모리에 실었다. 실패는 아니다 —
     * 이긴 것은 이 요청보다 **뒤에** 출발했으므로 신선도로도 센다. (이긴 것이 공개됐는지 확인하지
     * 못하면 [FAILED] 다.)
     */
    SUPERSEDED,

    /**
     * 이 응답은 공개됐고 메모리에도 실었지만, **그 뒤에 본 더 새 표의 쓰기가 실패해** 이게 마지막인지
     * 확인하지 못했다(Codex #825). 쓸 수는 있지만 신선도로 세지 않는다 — 다음 호출이 다시 받는다.
     *
     * ⚠ **부른 자리(준비도·클론 다운로드)에는 실패가 아니다** — [FAILED] 와 달리 막지 말 것(Codex #825).
     * 메모리에는 **이 요청 자신의 응답**(또는 그 뒤의 공개본)이 실려 있고, 이 요청은 부른 자리가 원한
     * 새로움을 이미 채웠다([ManifestNeed.LATEST] 면 부른 **뒤에** 출발했다). 더 새 표의 쓰기가 실패한
     * 것은 그 요청이 아직 안 돌아온 것과 같다 — 그때도 이 응답으로 셌다([PUBLISHED]). 물러난 회차가
     * 확인을 못 하면 [FAILED] 인 것과 다르다: 그때 디스크의 공개본은 이 요청보다 **앞서** 출발했을 수 있다.
     */
    UNCONFIRMED,

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
 *    요청을 내지 않는다. 떠 있는 요청도 창 안에 출발한 것만 나눠 쓴다 — 더 오래 떠 있으면 그 뒤에
 *    줄을 선다. [ManifestNeed.SESSION] 은 그 세션에 한 번 공개했으면 된다.
 *  - **[ManifestNeed.LATEST] 는 부른 뒤에 출발한 요청만 쓴다.** 떠 있는 요청은 부르기 전에
 *    출발했으므로 그 뒤에 **한 번만** 줄을 세우고, 그사이 들어온 LATEST 는 전부 그 줄을 나눠 쓴다.
 *
 * ⚠ **요청 자체([run])는 언제나 표·세대 가드를 거친다**(`StockClipManifestStore.beginFetch`/`save`).
 * 이 클래스는 **몇 번** 받을지만 정한다 — 무엇을 공개할지는 표가 정한다. 신선도는 **공개가
 * 확인된** 응답만 센다([ManifestFlightOutcome.PUBLISHED], 또는 이긴 것이 공개된
 * [ManifestFlightOutcome.SUPERSEDED] — 스펙 「공개 경합의 규칙」의 '새로 받았는가'). 실패한
 * 회차는 다음 호출이 다시 받는다.
 *
 * ⚠ 워커(`StockClipPrefetchWorker`·`VoiceAccessSyncWorker`)의 조회는 여기 묶지 않는다. 뷰모델이
 * 없는 프로세스에서도 돌고, 교체 확정 판단에 **그 회차가 직접 받은** 매니페스트가 필요하다(의도).
 *
 * [scope] 의 디스패처(메인)에서만 부른다 — 상태를 잠그지 않는다.
 *
 * @param Owner 계정 + 세션 세대(`SessionEffectKey`). 다른 주인의 요청은 나눠 쓰지 않는다.
 * @param lastSeenPublished 디스크에서 **가장 최근에 본 표의 응답이 공개됐는가**
 *   (`StockClipManifestStore.latestPublishedTicket() != null`). 아니면 기록해 둔 신선도를 쓰지 않는다
 *   (Codex #825) — 신선도를 센 **뒤에** 워커의 더 새 표가 쓰기에 실패하면 이 기록은 그대로인데, 그
 *   회차는 공개되지 않았으므로 다음 호출은 다시 받아야 한다(스펙 「공개 경합의 규칙」).
 */
internal class StockClipManifestFlights<Owner : Any>(
    private val scope: CoroutineScope,
    private val clock: () -> Long,
    private val freshWindowMs: Long = FRESH_WINDOW_MS,
    private val lastSeenPublished: () -> Boolean = { true },
) {
    private inner class Flight(val owner: Owner) {
        lateinit var result: Deferred<ManifestFlightOutcome>

        /** 요청을 이미 냈는가. 줄만 서 있는 동안은 false — 그동안 온 LATEST 가 나눠 쓸 수 있다. */
        var issued = false

        /** 요청을 낸 시각([issued] 와 함께 선다). RECENT 가 오래 떠 있는 요청을 나눠 쓸지 가른다. */
        var issuedAt: Long? = null
    }

    /**
     * 주인마다 요청을 낸 채 끝나지 않은 것. ⚠ **주인별로** 둔다(Codex #825) — 하나로 두면 계정이 바뀐
     * 뒤 앞 계정의 줄 선 요청이 풀리면서 새 계정의 떠 있는 요청을 덮어, 새 계정이 같은 요청을 또 낸다.
     */
    private val running = HashMap<Owner, Flight>()

    /** 주인마다 [running] 이 끝나면 출발할 것(LATEST 가 세운 줄). */
    private val queued = HashMap<Owner, Flight>()

    /** 주인마다 마지막으로 **공개가 확인된** 응답의 요청을 낸 시각. */
    private val freshIssuedAt = HashMap<Owner, Long>()

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
        val issuedAt = freshIssuedAt[owner]
        // 기록한 뒤 더 새 표의 쓰기가 실패했으면 그 기록은 '확인된 마지막' 이 아니다(생성자 주석).
        val fresh = issuedAt != null && lastSeenPublished() && when (need) {
            ManifestNeed.SESSION -> true
            ManifestNeed.RECENT -> clock() - issuedAt < freshWindowMs
            ManifestNeed.LATEST -> false
        }
        if (fresh) return ManifestFlightOutcome.FRESH
        // 부른 쪽이 취소돼도 요청은 끝까지 간다(다른 쪽이 기다리고 있다) — await 만 풀린다.
        return pick(owner, need, run).result.await()
    }

    private fun pick(owner: Owner, need: ManifestNeed, run: suspend () -> ManifestFlightOutcome): Flight {
        val active = running[owner]?.takeIf { it.result.isActive }
        // 줄만 서 있고 아직 요청을 안 낸 것 — 누가 와도 나눠 쓸 수 있다(LATEST 도: 부른 뒤에 출발한다).
        val waiting = queued[owner]?.takeIf { !it.issued && it.result.isActive }
        // 떠 있는 요청이 이 자리가 원하는 새로움을 못 채우면 그 뒤에 선 줄을 나눠 쓰거나 새로 세운다.
        //  - LATEST: 떠 있는 요청은 부르기 **전에** 출발했다.
        //  - RECENT: 창보다 오래 떠 있다(약한 망에서 조회는 60초까지 기다린다) — 그 응답은 창 밖의
        //    서버 상태라, 나눠 쓰면 준비도·탭 새로고침이 허용보다 낡은 목록을 곧바로 쓴다(Codex #825).
        val activeTooOld = active != null && when (need) {
            ManifestNeed.LATEST -> true
            ManifestNeed.RECENT -> active.issuedAt?.let { clock() - it >= freshWindowMs } ?: false
            ManifestNeed.SESSION -> false
        }
        if (activeTooOld) {
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
            running[owner] = flight
            if (queued[owner] === flight) queued.remove(owner)
            flight.issued = true
            runCount += 1
            val issuedAt = clock()
            flight.issuedAt = issuedAt
            try {
                val outcome = try {
                    run()
                } catch (error: CancellationException) {
                    throw error
                } catch (error: Exception) {
                    ManifestFlightOutcome.FAILED
                }
                // 이긴 것(SUPERSEDED)은 이 요청보다 뒤에 출발했다 — 이 요청의 출발 시각으로 세면 보수적이다.
                if (outcome == ManifestFlightOutcome.PUBLISHED || outcome == ManifestFlightOutcome.SUPERSEDED) {
                    freshIssuedAt[owner] = maxOf(issuedAt, freshIssuedAt[owner] ?: Long.MIN_VALUE)
                }
                outcome
            } finally {
                if (running[owner] === flight) running.remove(owner)
            }
        }
        if (after == null) running[owner] = flight else queued[owner] = flight
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
