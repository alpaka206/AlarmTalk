import XCTest
@testable import VoiceAlarm

@MainActor
final class AlarmAppContextTests: XCTestCase {

    private var store: LocalAlarmStore!
    private var mockQueue: MockCharacterEventQueue!
    private var ctx: AlarmAppContext!
    private var fixedNow: Date!

    override func setUp() async throws {
        // 디스크 storage 정리: LocalAlarmStore 가 documentDirectory 에 쓰므로
        // 새 store 를 만들기 전에 파일을 미리 지운다.
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let url = dir.appendingPathComponent("voice-alarm-ios-alarms.json")
        try? FileManager.default.removeItem(at: url)

        store = LocalAlarmStore()
        // init 이 띄운 비동기 load Task 가 완료될 시간을 보장. 디스크 read 1회.
        try? await Task.sleep(nanoseconds: 50_000_000)
        // 안전망: load 가 남긴 게 있으면 비운다.
        for r in store.alarms { store.delete(r) }

        mockQueue = MockCharacterEventQueue()
        ctx = AlarmAppContext(store: store, characterEvents: mockQueue)
        fixedNow = Date(timeIntervalSince1970: 1_700_000_000)
        ctx.nowProvider = { [fixedNow] in fixedNow! }
    }

    override func tearDown() async throws {
        AlarmAppContext.shared = nil
        ctx = nil
        mockQueue = nil
        store = nil
    }

    // MARK: - Stop

    func test_handleAlarmStopped_marksStoreAndQueuesEvent() async throws {
        let kitID = UUID().uuidString
        let record = makeArmedRecord(alarmKitID: kitID)
        store.upsert(record)

        await ctx.handleAlarmStopped(alarmKitIDString: kitID)

        // store: dismissed 로 전이.
        let stored = try XCTUnwrap(store.record(id: record.id))
        XCTAssertEqual(stored.state, AlarmRuntimeState.dismissed.rawValue)
        XCTAssertFalse(stored.enabled)

        // event queue: 1회 enqueue.
        XCTAssertEqual(mockQueue.events.count, 1)
        let evt = try XCTUnwrap(mockQueue.events.first)
        XCTAssertEqual(evt.eventType, .alarmCompleted)
        XCTAssertEqual(evt.context?["alarmId"], record.id)
        XCTAssertEqual(evt.context?["alarmKitId"], kitID)
        XCTAssertEqual(evt.context?["playMode"], record.playMode)
    }

    func test_handleAlarmStopped_idempotentNonce_acrossDuplicateCalls() async throws {
        let kitID = UUID().uuidString
        let record = makeArmedRecord(alarmKitID: kitID)
        store.upsert(record)

        await ctx.handleAlarmStopped(alarmKitIDString: kitID)
        await ctx.handleAlarmStopped(alarmKitIDString: kitID)

        // 호출은 두 번 enqueue 되었지만 nonce 가 동일해야 한다.
        XCTAssertEqual(mockQueue.events.count, 2)
        XCTAssertEqual(mockQueue.events[0].clientNonce, mockQueue.events[1].clientNonce)
        // 실제 dedup 은 CharacterEventStore (B5) 의 책임. 본 테스트는 nonce
        // 값이 stable 함만 보장한다.
        let expectedNonce = "\(record.id)-stop-\(record.fireAtMillis)"
        XCTAssertEqual(mockQueue.events.first?.clientNonce, expectedNonce)
    }

    func test_handleAlarmStopped_unknownKitID_noQueue() async {
        let unknown = UUID().uuidString
        await ctx.handleAlarmStopped(alarmKitIDString: unknown)
        XCTAssertEqual(mockQueue.events.count, 0)
    }

    // MARK: - Snooze

    func test_handleAlarmSnoozed_advancesFireAndIncrementsCount() async throws {
        let kitID = UUID().uuidString
        var record = makeArmedRecord(alarmKitID: kitID)
        record.snoozeMinutes = 7
        record.snoozeCount = 1
        store.upsert(record)

        await ctx.handleAlarmSnoozed(alarmKitIDString: kitID, snoozeMinutesOverride: nil)

        let updated = try XCTUnwrap(store.record(id: record.id))
        XCTAssertEqual(updated.state, AlarmRuntimeState.snoozed.rawValue)
        XCTAssertEqual(updated.snoozeCount, 2)
        let expectedFire = Int64(fixedNow.timeIntervalSince1970 * 1000) + 7 * 60_000
        XCTAssertEqual(updated.fireAtMillis, expectedFire)

        XCTAssertEqual(mockQueue.events.count, 1)
        let evt = try XCTUnwrap(mockQueue.events.first)
        XCTAssertEqual(evt.eventType, .alarmSnoozed)
        XCTAssertEqual(evt.context?["snoozeMinutes"], "7")
        XCTAssertEqual(evt.context?["snoozeCount"], "2")
        // nonce 는 호출 전 count 기준 +1.
        XCTAssertEqual(evt.clientNonce, "\(record.id)-snooze-2")
    }

    func test_handleAlarmSnoozed_overridesSnoozeMinutes() async throws {
        let kitID = UUID().uuidString
        let record = makeArmedRecord(alarmKitID: kitID)
        store.upsert(record)

        await ctx.handleAlarmSnoozed(alarmKitIDString: kitID, snoozeMinutesOverride: 12)

        let updated = try XCTUnwrap(store.record(id: record.id))
        let expectedFire = Int64(fixedNow.timeIntervalSince1970 * 1000) + 12 * 60_000
        XCTAssertEqual(updated.fireAtMillis, expectedFire)
        XCTAssertEqual(mockQueue.events.first?.context?["snoozeMinutes"], "12")
    }

    func test_handleAlarmSnoozed_unknownKitID_noMutation_noQueue() async {
        let unknown = UUID().uuidString
        await ctx.handleAlarmSnoozed(alarmKitIDString: unknown, snoozeMinutesOverride: 5)
        XCTAssertEqual(mockQueue.events.count, 0)
    }

    // MARK: - Helpers

    private func makeArmedRecord(alarmKitID: String) -> LocalAlarmRecord {
        let now = Int64(fixedNow.timeIntervalSince1970 * 1000)
        return LocalAlarmRecord(
            label: "test",
            hour: 7,
            minute: 30,
            fireAtMillis: now + 60_000,
            playMode: AlarmPlayMode.soundThenVoice.rawValue,
            voiceProfileId: "profile-1",
            state: AlarmRuntimeState.armed.rawValue,
            createdAtMillis: now,
            updatedAtMillis: now,
            alarmKitID: alarmKitID
        )
    }
}

// MARK: - Mock

@MainActor
final class MockCharacterEventQueue: CharacterEventQueueing {
    struct Captured {
        let eventType: CharacterEventKind
        let occurredAtMillis: Int64
        let clientNonce: String
        let context: [String: String]?
    }
    private(set) var events: [Captured] = []

    func queueAlarmEvent(
        eventType: CharacterEventKind,
        occurredAtMillis: Int64,
        clientNonce: String,
        context: [String: String]?
    ) async {
        events.append(.init(
            eventType: eventType,
            occurredAtMillis: occurredAtMillis,
            clientNonce: clientNonce,
            context: context
        ))
    }
}
