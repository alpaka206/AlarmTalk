import XCTest
@testable import VoiceAlarm

/// Phase 2-B5 — CharacterEventStore 의 큐 멱등성, nonce 결정성, sync 성공/실패
/// 상태 전이, 자정 경계 처리.
@MainActor
final class CharacterEventStoreTests: XCTestCase {

    // MARK: - buildClientNonce: deterministic / day boundary

    func test_buildClientNonce_isDeterministic_forSameInputs() {
        let tz = TimeZone(identifier: "UTC")!
        let occurredAt: Int64 = 1_700_000_000_000

        let a = CharacterEventStore.buildClientNonce(
            alarmID: "alarm-A",
            eventType: .alarmCompleted,
            occurredAtMillis: occurredAt,
            timezone: tz
        )
        let b = CharacterEventStore.buildClientNonce(
            alarmID: "alarm-A",
            eventType: .alarmCompleted,
            occurredAtMillis: occurredAt,
            timezone: tz
        )

        XCTAssertEqual(a, b)
        XCTAssertEqual(a, "alarm_completed:alarm-A:2023-11-14")
    }

    func test_buildClientNonce_changesAcrossLocalDate() {
        // KST 2024-01-01 23:30 (UTC 14:30) → date "2024-01-01"
        // KST 2024-01-02 00:30 (UTC 15:30) → date "2024-01-02"
        let tz = TimeZone(identifier: "Asia/Seoul")!
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = tz

        let beforeMidnight = cal.date(from: DateComponents(
            timeZone: tz, year: 2024, month: 1, day: 1, hour: 23, minute: 30
        ))!
        let afterMidnight = cal.date(from: DateComponents(
            timeZone: tz, year: 2024, month: 1, day: 2, hour: 0, minute: 30
        ))!

        let nonceA = CharacterEventStore.buildClientNonce(
            alarmID: "X",
            eventType: .alarmCompleted,
            occurredAtMillis: Int64(beforeMidnight.timeIntervalSince1970 * 1000),
            timezone: tz
        )
        let nonceB = CharacterEventStore.buildClientNonce(
            alarmID: "X",
            eventType: .alarmCompleted,
            occurredAtMillis: Int64(afterMidnight.timeIntervalSince1970 * 1000),
            timezone: tz
        )

        XCTAssertNotEqual(nonceA, nonceB)
        XCTAssertTrue(nonceA.hasSuffix(":2024-01-01"))
        XCTAssertTrue(nonceB.hasSuffix(":2024-01-02"))
    }

    // MARK: - queue idempotency

    func test_queue_isIdempotent_forSameNonce() async {
        let api = MockCharacterAPI()
        let persistence = makeEphemeralPersistence()
        let store = CharacterEventStore(
            api: api,
            tokenProvider: { nil }, // 로그아웃 상태 — flush skip
            persistence: persistence,
            timeZone: TimeZone(identifier: "UTC")!
        )

        let occurredAt: Int64 = 1_700_000_000_000
        await store.queue(
            eventType: .alarmCompleted,
            occurredAtMillis: occurredAt,
            clientNonce: "alarm-1-stop-1700000000000",
            sourceAlarmId: "alarm-1",
            context: ["a": "b"]
        )
        await store.queue(
            eventType: .alarmCompleted,
            occurredAtMillis: occurredAt,
            clientNonce: "alarm-1-stop-1700000000000",
            sourceAlarmId: "alarm-1",
            context: ["a": "b"]
        )

        XCTAssertEqual(store.events.count, 1)
        XCTAssertEqual(store.events.first?.clientNonce, "alarm-1-stop-1700000000000")
    }

    // MARK: - flushPending: success path

    func test_flushPending_marksSynced_onAPISuccess() async {
        let api = MockCharacterAPI()
        api.response = .success(makeSuccessResponse(grantedXp: 25))
        let persistence = makeEphemeralPersistence()
        let store = CharacterEventStore(
            api: api,
            tokenProvider: { "valid-token" },
            persistence: persistence,
            timeZone: TimeZone(identifier: "UTC")!
        )

        await store.queue(
            eventType: .alarmCompleted,
            occurredAtMillis: 1_700_000_000_000,
            clientNonce: "n1"
        )

        // queue 가 백그라운드로 flush 트리거하므로 명시적으로 한 번 더 호출.
        let summary = await store.flushPending()

        XCTAssertEqual(api.calls.count, 1)
        XCTAssertEqual(api.calls.first?.event, "alarm_completed")
        XCTAssertEqual(api.calls.first?.clientNonce, "n1")
        XCTAssertEqual(api.calls.first?.localDate, "2023-11-14") // UTC
        XCTAssertEqual(store.events.first?.syncState, CharacterEventSyncState.synced.rawValue)
        XCTAssertNotNil(store.events.first?.syncedAtMillis)
        XCTAssertEqual(summary.synced + summary.total, summary.total * 2)
    }

    // MARK: - flushPending: failure path

    func test_flushPending_marksFailed_andIncrementsAttempts_onAPIError() async {
        let api = MockCharacterAPI()
        api.response = .failure(MockError.boom)
        let persistence = makeEphemeralPersistence()
        let store = CharacterEventStore(
            api: api,
            tokenProvider: { "valid-token" },
            persistence: persistence,
            timeZone: TimeZone(identifier: "UTC")!
        )

        await store.queue(
            eventType: .alarmSnoozed,
            occurredAtMillis: 1_700_000_000_000,
            clientNonce: "n-snooze-1"
        )
        _ = await store.flushPending()

        XCTAssertEqual(store.events.first?.syncState, CharacterEventSyncState.failed.rawValue)
        XCTAssertEqual(store.events.first?.attempts, 1)
        XCTAssertNotNil(store.events.first?.lastError)

        // 재시도가 또 실패하면 attempts 가 누적되어야 한다.
        _ = await store.flushPending()
        XCTAssertEqual(store.events.first?.attempts, 2)
    }

    func test_flushPending_recoversFromFailed_onNextSuccess() async {
        let api = MockCharacterAPI()
        api.response = .failure(MockError.boom)
        let persistence = makeEphemeralPersistence()
        let store = CharacterEventStore(
            api: api,
            tokenProvider: { "valid-token" },
            persistence: persistence,
            timeZone: TimeZone(identifier: "UTC")!
        )

        await store.queue(
            eventType: .alarmCompleted,
            occurredAtMillis: 1_700_000_000_000,
            clientNonce: "recover-1"
        )
        _ = await store.flushPending()
        XCTAssertEqual(store.events.first?.syncState, CharacterEventSyncState.failed.rawValue)

        api.response = .success(makeSuccessResponse(grantedXp: 10))
        _ = await store.flushPending()
        XCTAssertEqual(store.events.first?.syncState, CharacterEventSyncState.synced.rawValue)
        XCTAssertNil(store.events.first?.lastError)
    }

    func test_flushPending_skipsAlreadySynced() async {
        let api = MockCharacterAPI()
        api.response = .success(makeSuccessResponse(grantedXp: 25))
        let persistence = makeEphemeralPersistence()
        let store = CharacterEventStore(
            api: api,
            tokenProvider: { "valid-token" },
            persistence: persistence,
            timeZone: TimeZone(identifier: "UTC")!
        )

        await store.queue(
            eventType: .alarmCompleted,
            occurredAtMillis: 1_700_000_000_000,
            clientNonce: "once"
        )
        _ = await store.flushPending()
        let firstCallCount = api.calls.count

        // 두 번째 flush 는 SYNCED 만 있으므로 API 호출이 늘어나서는 안 된다.
        _ = await store.flushPending()
        XCTAssertEqual(api.calls.count, firstCallCount)
    }

    func test_flushPending_isNoop_whenTokenMissing() async {
        let api = MockCharacterAPI()
        api.response = .success(makeSuccessResponse(grantedXp: 25))
        let persistence = makeEphemeralPersistence()
        let store = CharacterEventStore(
            api: api,
            tokenProvider: { nil }, // logged out
            persistence: persistence,
            timeZone: TimeZone(identifier: "UTC")!
        )

        await store.queue(
            eventType: .alarmCompleted,
            occurredAtMillis: 1_700_000_000_000,
            clientNonce: "n-logged-out"
        )
        let summary = await store.flushPending()

        XCTAssertEqual(api.calls.count, 0)
        XCTAssertEqual(store.events.first?.syncState, CharacterEventSyncState.pending.rawValue)
        XCTAssertEqual(summary.synced, 0)
    }

    // MARK: - CharacterEventQueueing protocol bridging

    func test_queueAlarmEvent_protocolBridge_capturesSourceAlarmId() async {
        let api = MockCharacterAPI()
        api.response = .success(makeSuccessResponse(grantedXp: 10))
        let persistence = makeEphemeralPersistence()
        let store = CharacterEventStore(
            api: api,
            tokenProvider: { "token" },
            persistence: persistence,
            timeZone: TimeZone(identifier: "UTC")!
        )

        await store.queueAlarmEvent(
            eventType: .alarmCompleted,
            occurredAtMillis: 1_700_000_000_000,
            clientNonce: "alarm-X-stop-1700000000000",
            context: [
                "alarmId": "alarm-X",
                "alarmKitId": "ABC-123",
                "playMode": "sound_then_voice",
            ]
        )

        XCTAssertEqual(store.events.count, 1)
        XCTAssertEqual(store.events.first?.sourceAlarmId, "alarm-X")
        XCTAssertEqual(store.events.first?.eventType, CharacterEventType.alarmCompleted.rawValue)
        XCTAssertNotNil(store.events.first?.contextJson)
    }

    // MARK: - Helpers

    private func makeEphemeralPersistence() -> CharacterEventPersistence {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("character-events-test-\(UUID().uuidString).json")
        return CharacterEventPersistence(url: url)
    }

    private func makeSuccessResponse(grantedXp: Int) -> CharacterGrantResponse {
        CharacterGrantResponse(
            character: CharacterPayload(
                id: "c", name: "Naro", level: 1, xp: grantedXp, affection: 0,
                stage: "egg", dailyXp: grantedXp
            ),
            progress: CharacterProgress(
                xpIntoLevel: grantedXp, xpToNextLevel: 100, levelSpan: 100, progressRatio: 0.25
            ),
            streak: CharacterStreak(current: 1, longest: 1, lastWakeupDate: "2023-11-14"),
            stats: CharacterStats(diligence: 1, health: 1, consistency: 1),
            achievements: nil,
            grant: CharacterGrant(
                event: "alarm_completed",
                grantedXp: grantedXp,
                affection: 0,
                capped: false,
                remainingCap: 200,
                duplicated: false
            )
        )
    }
}

// MARK: - Mocks

private enum MockError: Error { case boom }

private final class MockCharacterAPI: CharacterXPGranting, @unchecked Sendable {
    struct Call: Equatable {
        let event: String
        let clientNonce: String
        let localDate: String
        let token: String
    }

    var calls: [Call] = []
    var response: Result<CharacterGrantResponse, Error> = .failure(MockError.boom)

    func grantCharacterXP(
        event: String,
        clientNonce: String,
        localDate: String,
        token: String
    ) async throws -> CharacterGrantResponse {
        calls.append(Call(event: event, clientNonce: clientNonce, localDate: localDate, token: token))
        return try response.get()
    }
}
