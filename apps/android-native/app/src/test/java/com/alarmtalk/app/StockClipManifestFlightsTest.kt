package com.alarmtalk.app

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 매니페스트 조회는 **한 번에 하나**이고, **신선도 창** 안이면 내지 않는다(2026-09-29 효율 감사 M1).
 *
 * 고치기 전에는 콜드 스타트 한 번에 `GET /tts/stock-clips`(약 168KB)가 15번 나갔다 — 앱 시작·
 * 탭 새로고침·준비도·클론 다운로드가 저마다 받았고, `loadStockClips` 는 부를 때마다 앞선 응답을
 * 버렸다. 여기서는 **몇 번** 받는가만 본다. 무엇을 공개할지는 여전히 표(`StockClipManifestStore`)가
 * 정한다 — 배선은 `StockClipManifestWiringTest` 가 본다.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class StockClipManifestFlightsTest {

    private class Clock(var now: Long = 1_000_000L)

    /** 요청 하나를 흉내 낸다 — [gate] 가 열릴 때까지 '네트워크' 에 머문다. */
    private class FakeRequests {
        var issued = 0
        var gate: CompletableDeferred<Unit>? = null
        var outcome = ManifestFlightOutcome.PUBLISHED

        suspend fun run(): ManifestFlightOutcome {
            issued += 1
            gate?.await()
            return outcome
        }
    }

    private fun TestScope.flights(clock: Clock, lastSeenPublished: () -> Boolean = { true }) =
        StockClipManifestFlights<String>(
            scope = this,
            clock = { clock.now },
            lastSeenPublished = lastSeenPublished,
        )

    @Test
    fun concurrentCallersShareOneRequest() = runTest {
        val clock = Clock()
        val flights = flights(clock)
        val requests = FakeRequests().apply { gate = CompletableDeferred() }

        // 콜드 스타트: 앱 시작(SESSION) · 알람 탭(RECENT) · 준비도(RECENT)가 같은 프레임에 부른다.
        val a = async { flights.ensure("u1", ManifestNeed.SESSION) { requests.run() } }
        val b = async { flights.ensure("u1", ManifestNeed.RECENT) { requests.run() } }
        val c = async { flights.ensure("u1", ManifestNeed.RECENT) { requests.run() } }
        runCurrent()
        requests.gate!!.complete(Unit)

        assertEquals(ManifestFlightOutcome.PUBLISHED, a.await())
        assertEquals(ManifestFlightOutcome.PUBLISHED, b.await())
        assertEquals(ManifestFlightOutcome.PUBLISHED, c.await())
        assertEquals("같이 부른 셋이 요청을 나눠 쓰지 않았다.", 1, requests.issued)
    }

    @Test
    fun recentReusesAPublishedResponseInsideTheWindowOnly() = runTest {
        val clock = Clock()
        val flights = flights(clock)
        val requests = FakeRequests()

        flights.ensure("u1", ManifestNeed.SESSION) { requests.run() }
        assertEquals(1, requests.issued)

        clock.now += StockClipManifestFlights.FRESH_WINDOW_MS - 1
        assertEquals(ManifestFlightOutcome.FRESH, flights.ensure("u1", ManifestNeed.RECENT) { requests.run() })
        assertEquals("신선도 창 안인데 또 받았다.", 1, requests.issued)

        clock.now += 1
        assertEquals(ManifestFlightOutcome.PUBLISHED, flights.ensure("u1", ManifestNeed.RECENT) { requests.run() })
        assertEquals("창이 지났는데 받지 않았다 — cron 이 만든 클립이 안 들어온다.", 2, requests.issued)
    }

    @Test
    fun sessionIsSatisfiedByAnyPublishedResponseOfThatSession() = runTest {
        val clock = Clock()
        val flights = flights(clock)
        val requests = FakeRequests()

        flights.ensure("u1", ManifestNeed.SESSION) { requests.run() }
        clock.now += 10 * StockClipManifestFlights.FRESH_WINDOW_MS
        assertEquals(ManifestFlightOutcome.FRESH, flights.ensure("u1", ManifestNeed.SESSION) { requests.run() })
        assertEquals(1, requests.issued)

        // 다른 주인(계정 전환, 또는 같은 계정의 새 세션 세대)은 '아직 안 받음' 이다.
        assertEquals(ManifestFlightOutcome.PUBLISHED, flights.ensure("u1#2", ManifestNeed.SESSION) { requests.run() })
        assertEquals(2, requests.issued)
    }

    @Test
    fun latestNeverReusesAResponseThatStartedBeforeTheCall() = runTest {
        val clock = Clock()
        val flights = flights(clock)
        val requests = FakeRequests()

        flights.ensure("u1", ManifestNeed.SESSION) { requests.run() }
        // 방금 받았어도(창 안이어도) LATEST 는 새로 받는다 — 서버가 바뀌었다는 신호 뒤다.
        assertEquals(ManifestFlightOutcome.PUBLISHED, flights.ensure("u1", ManifestNeed.LATEST) { requests.run() })
        assertEquals(2, requests.issued)
    }

    @Test
    fun latestCallersDuringARequestShareOneFollowUp() = runTest {
        val clock = Clock()
        val flights = flights(clock)
        val first = CompletableDeferred<Unit>()
        val second = CompletableDeferred<Unit>()
        val gates = ArrayDeque(listOf(first, second))
        var issued = 0
        val run: suspend () -> ManifestFlightOutcome = {
            issued += 1
            gates.removeFirst().await()
            ManifestFlightOutcome.PUBLISHED
        }

        val start = async { flights.ensure("u1", ManifestNeed.SESSION, run) }
        runCurrent()
        assertEquals(1, issued)

        // 첫 요청이 떠 있는 동안 신호가 셋 온다(공유 변경 푸시 · 목록 새로고침 · 드라이브 완료).
        val l1 = async { flights.ensure("u1", ManifestNeed.LATEST, run) }
        val l2 = async { flights.ensure("u1", ManifestNeed.LATEST, run) }
        val l3 = async { flights.ensure("u1", ManifestNeed.LATEST, run) }
        runCurrent()
        assertEquals("LATEST 가 떠 있는 요청(부르기 전에 출발)을 그대로 썼다.", 1, issued)

        first.complete(Unit)
        start.await()
        runCurrent()
        assertEquals("LATEST 셋이 뒤따르는 요청 하나를 나눠 쓰지 않았다.", 2, issued)

        // 첫 요청이 공개됐으니 RECENT 는 창 안 — 뒤따르는 요청이 떠 있어도 새로 내지 않는다.
        assertEquals(ManifestFlightOutcome.FRESH, flights.ensure("u1", ManifestNeed.RECENT, run))
        second.complete(Unit)
        listOf(l1, l2, l3).forEach { assertEquals(ManifestFlightOutcome.PUBLISHED, it.await()) }
        assertEquals(2, issued)
        assertEquals(2, flights.runCount)
    }

    @Test
    fun onlyConfirmedPublicationsCountAsFresh() = runTest {
        val clock = Clock()
        val flights = flights(clock)
        val requests = FakeRequests()

        // 실패(쓰기 실패·확인 못 한 superseded 포함)와, 실었지만 마지막인지 모르는 응답(더 새 표의 쓰기
        // 실패)은 신선도로 세지 않는다 — 다음 호출이 다시 받는다.
        requests.outcome = ManifestFlightOutcome.FAILED
        assertEquals(ManifestFlightOutcome.FAILED, flights.ensure("u1", ManifestNeed.SESSION) { requests.run() })
        requests.outcome = ManifestFlightOutcome.UNCONFIRMED
        assertEquals(ManifestFlightOutcome.UNCONFIRMED, flights.ensure("u1", ManifestNeed.RECENT) { requests.run() })
        assertEquals(2, requests.issued)

        // 이긴 것이 공개된 superseded 는 '받았다' 다(스펙 「공개 경합의 규칙」) — 이긴 것은 뒤에 출발했다.
        requests.outcome = ManifestFlightOutcome.SUPERSEDED
        assertEquals(ManifestFlightOutcome.SUPERSEDED, flights.ensure("u1", ManifestNeed.RECENT) { requests.run() })
        assertEquals(3, requests.issued)
        assertEquals(ManifestFlightOutcome.FRESH, flights.ensure("u1", ManifestNeed.RECENT) { requests.run() })
        assertEquals(ManifestFlightOutcome.FRESH, flights.ensure("u1", ManifestNeed.SESSION) { requests.run() })
        assertEquals(3, requests.issued)
    }

    @Test
    fun recentDoesNotShareARequestThatHasBeenInFlightLongerThanTheWindow() = runTest {
        val clock = Clock()
        val flights = flights(clock)
        val first = CompletableDeferred<Unit>()
        val second = CompletableDeferred<Unit>()
        val gates = ArrayDeque(listOf(first, second))
        var issued = 0
        val run: suspend () -> ManifestFlightOutcome = {
            issued += 1
            gates.removeFirst().await()
            ManifestFlightOutcome.PUBLISHED
        }

        val start = async { flights.ensure("u1", ManifestNeed.SESSION, run) }
        runCurrent()
        assertEquals(1, issued)

        // 창 안에 출발한 떠 있는 요청은 나눠 쓴다.
        clock.now += StockClipManifestFlights.FRESH_WINDOW_MS - 1
        val inside = async { flights.ensure("u1", ManifestNeed.RECENT, run) }
        runCurrent()
        assertEquals(1, issued)

        // 약한 망에서 창보다 오래 떠 있다 — 그 응답은 창 밖의 서버 상태다. RECENT 는 그 뒤에 줄을
        // 서고, 그사이 온 RECENT 는 그 줄을 나눠 쓴다(Codex #825).
        clock.now += 1
        val late1 = async { flights.ensure("u1", ManifestNeed.RECENT, run) }
        val late2 = async { flights.ensure("u1", ManifestNeed.RECENT, run) }
        runCurrent()
        assertEquals("떠 있는 요청이 끝나기 전에 줄 선 요청이 나갔다.", 1, issued)
        // SESSION 은 이번 세션의 요청이면 된다 — 오래 떠 있어도 나눠 쓴다.
        val session = async { flights.ensure("u1", ManifestNeed.SESSION, run) }

        first.complete(Unit)
        assertEquals(ManifestFlightOutcome.PUBLISHED, start.await())
        assertEquals(ManifestFlightOutcome.PUBLISHED, inside.await())
        assertEquals(ManifestFlightOutcome.PUBLISHED, session.await())
        runCurrent()
        assertEquals("창보다 오래 떠 있던 요청을 RECENT 가 그대로 썼다.", 2, issued)
        second.complete(Unit)
        listOf(late1, late2).forEach { assertEquals(ManifestFlightOutcome.PUBLISHED, it.await()) }
        assertEquals("늦은 RECENT 둘이 뒤따르는 요청 하나를 나눠 쓰지 않았다.", 2, flights.runCount)
    }

    @Test
    fun aLaterFailedWriteVoidsTheRecordedFreshness() = runTest {
        val clock = Clock()
        var lastSeenPublished = true
        val flights = flights(clock) { lastSeenPublished }
        val requests = FakeRequests()

        assertEquals(ManifestFlightOutcome.PUBLISHED, flights.ensure("u1", ManifestNeed.SESSION) { requests.run() })
        assertEquals(ManifestFlightOutcome.FRESH, flights.ensure("u1", ManifestNeed.RECENT) { requests.run() })
        assertEquals(1, requests.issued)

        // 신선도를 센 **뒤에** 워커의 더 새 표가 쓰기에 실패했다 — 기록은 그대로지만 그 회차는 공개되지
        // 않았으므로 창 안이라도, 세션에 이미 받았어도 다시 받는다(Codex #825).
        lastSeenPublished = false
        assertEquals(ManifestFlightOutcome.PUBLISHED, flights.ensure("u1", ManifestNeed.RECENT) { requests.run() })
        assertEquals(ManifestFlightOutcome.PUBLISHED, flights.ensure("u1", ManifestNeed.SESSION) { requests.run() })
        assertEquals("뒤의 쓰기가 실패했는데 앞의 신선도로 건너뛰었다.", 3, requests.issued)

        // 다시 공개가 확인되면 창이 되살아난다.
        lastSeenPublished = true
        assertEquals(ManifestFlightOutcome.FRESH, flights.ensure("u1", ManifestNeed.RECENT) { requests.run() })
        assertEquals(3, requests.issued)
    }

    @Test
    fun aThrowingRequestIsAFailureNotACrash() = runTest {
        val flights = flights(Clock())
        val outcome = flights.ensure("u1", ManifestNeed.SESSION) { error("disk full") }
        assertEquals(ManifestFlightOutcome.FAILED, outcome)
        // 다음 호출은 다시 받는다.
        var issued = 0
        flights.ensure("u1", ManifestNeed.SESSION) {
            issued += 1
            ManifestFlightOutcome.PUBLISHED
        }
        assertEquals(1, issued)
    }

    @Test
    fun anotherOwnersRequestIsNeverShared() = runTest {
        val clock = Clock()
        val flights = flights(clock)
        val gate = CompletableDeferred<Unit>()
        val seen = mutableListOf<String>()

        val a = async {
            flights.ensure("u1", ManifestNeed.SESSION) {
                seen += "u1"
                gate.await()
                ManifestFlightOutcome.PUBLISHED
            }
        }
        runCurrent()
        // 로그아웃 → 다른 계정. 앞 계정의 떠 있는 요청을 나눠 쓰면 **남의 목록**을 싣는다.
        val b = async {
            flights.ensure("u2", ManifestNeed.RECENT) {
                seen += "u2"
                ManifestFlightOutcome.PUBLISHED
            }
        }
        runCurrent()
        assertEquals(listOf("u1", "u2"), seen)
        assertEquals(ManifestFlightOutcome.PUBLISHED, b.await())
        gate.complete(Unit)
        a.await()
    }

    @Test
    fun anOldOwnersQueueDrainingDoesNotEvictTheNewOwnersRequest() = runTest {
        val flights = flights(Clock())
        val aFirst = CompletableDeferred<Unit>()
        val bGate = CompletableDeferred<Unit>()
        var bRuns = 0

        // 계정 A: 떠 있는 요청 + 그 뒤에 선 LATEST 줄.
        val a1 = async { flights.ensure("A", ManifestNeed.SESSION) { aFirst.await(); ManifestFlightOutcome.PUBLISHED } }
        runCurrent()
        val a2 = async { flights.ensure("A", ManifestNeed.LATEST) { ManifestFlightOutcome.FAILED } }
        runCurrent()
        // 로그아웃 → 계정 B 가 요청을 낸다.
        val b1 = async {
            flights.ensure("B", ManifestNeed.SESSION) {
                bRuns += 1
                bGate.await()
                ManifestFlightOutcome.PUBLISHED
            }
        }
        runCurrent()
        assertEquals(1, bRuns)

        // A 의 앞 요청이 끝나 줄 선 요청이 풀린다(세션이 바뀌어 곧바로 실패로 끝난다).
        aFirst.complete(Unit)
        a1.await()
        a2.await()
        runCurrent()

        // B 의 다음 호출은 B 의 떠 있는 요청을 나눠 써야 한다 — A 의 줄이 B 의 자리를 비우면 또 낸다.
        val b2 = async {
            flights.ensure("B", ManifestNeed.RECENT) {
                bRuns += 1
                ManifestFlightOutcome.PUBLISHED
            }
        }
        runCurrent()
        assertEquals("앞 계정의 줄이 풀리면서 새 계정의 떠 있는 요청을 밀어냈다.", 1, bRuns)
        bGate.complete(Unit)
        assertEquals(ManifestFlightOutcome.PUBLISHED, b1.await())
        assertEquals(ManifestFlightOutcome.PUBLISHED, b2.await())
    }

    @Test
    fun aCancelledCallerDoesNotCancelTheSharedRequest() = runTest {
        val flights = flights(Clock())
        val gate = CompletableDeferred<Unit>()
        var finished = false

        val leaving = async {
            flights.ensure("u1", ManifestNeed.SESSION) {
                gate.await()
                finished = true
                ManifestFlightOutcome.PUBLISHED
            }
        }
        val staying = async { flights.ensure("u1", ManifestNeed.RECENT) { error("나눠 쓰는 쪽은 부르지 않는다") } }
        runCurrent()
        // 목소리 탭을 떠나 그 효과가 취소돼도, 같은 요청을 기다리는 다른 쪽은 결과를 받는다.
        leaving.cancel()
        gate.complete(Unit)
        advanceUntilIdle()
        assertEquals(ManifestFlightOutcome.PUBLISHED, staying.await())
        assertTrue(finished)
    }
}
