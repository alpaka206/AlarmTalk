import XCTest
@testable import VoiceAlarm

/// Phase 2-B5 — JSON 영속화 round-trip + 손상 파일 graceful degradation.
final class CharacterEventPersistenceTests: XCTestCase {

    func test_save_then_load_preservesAllFields() async {
        let url = makeURL()
        let persistence = CharacterEventPersistence(url: url)

        let now: Int64 = 1_700_000_000_000
        let original = [
            CharacterEventEntity(
                id: "id-1",
                eventType: CharacterEventType.alarmCompleted.rawValue,
                occurredAtMillis: now,
                clientNonce: "alarm-1-stop-\(now)",
                localDate: "2023-11-14",
                sourceAlarmId: "alarm-1",
                contextJson: "{\"alarmId\":\"alarm-1\"}",
                syncState: CharacterEventSyncState.synced.rawValue,
                attempts: 0,
                lastError: nil,
                createdAtMillis: now,
                syncedAtMillis: now + 5_000,
                updatedAtMillis: now + 5_000
            ),
            CharacterEventEntity(
                id: "id-2",
                eventType: CharacterEventType.alarmSnoozed.rawValue,
                occurredAtMillis: now + 60_000,
                clientNonce: "alarm-2-snooze-1",
                localDate: "2023-11-14",
                sourceAlarmId: "alarm-2",
                contextJson: nil,
                syncState: CharacterEventSyncState.failed.rawValue,
                attempts: 3,
                lastError: "network down",
                createdAtMillis: now + 60_000,
                syncedAtMillis: nil,
                updatedAtMillis: now + 70_000
            ),
        ]

        await persistence.save(events: original)
        let loaded = await persistence.load()

        XCTAssertEqual(loaded.count, 2)
        XCTAssertEqual(loaded, original)
    }

    func test_load_returnsEmpty_whenFileMissing() async {
        let url = makeURL()
        let persistence = CharacterEventPersistence(url: url)
        let loaded = await persistence.load()
        XCTAssertEqual(loaded, [])
    }

    func test_load_returnsEmpty_whenFileIsCorrupted() async {
        let url = makeURL()
        try? "this is not json".data(using: .utf8)?.write(to: url, options: .atomic)
        let persistence = CharacterEventPersistence(url: url)
        let loaded = await persistence.load()
        // graceful degradation: 손상된 파일을 만나도 crash 하지 않고 빈 배열을 반환.
        // 서버 측 nonce 가 살아 있으므로 다음 큐잉은 안전하게 진행된다.
        XCTAssertEqual(loaded, [])
    }

    func test_save_overwritesPreviousContents() async {
        let url = makeURL()
        let persistence = CharacterEventPersistence(url: url)
        let entityA = CharacterEventEntity(
            id: "A", eventType: CharacterEventType.alarmCompleted.rawValue,
            occurredAtMillis: 0, clientNonce: "A", localDate: "2024-01-01",
            sourceAlarmId: nil, contextJson: nil,
            syncState: CharacterEventSyncState.pending.rawValue, attempts: 0,
            lastError: nil, createdAtMillis: 0, syncedAtMillis: nil, updatedAtMillis: 0
        )
        let entityB = CharacterEventEntity(
            id: "B", eventType: CharacterEventType.alarmSnoozed.rawValue,
            occurredAtMillis: 1, clientNonce: "B", localDate: "2024-01-01",
            sourceAlarmId: nil, contextJson: nil,
            syncState: CharacterEventSyncState.synced.rawValue, attempts: 0,
            lastError: nil, createdAtMillis: 1, syncedAtMillis: 1, updatedAtMillis: 1
        )

        await persistence.save(events: [entityA])
        await persistence.save(events: [entityB])
        let loaded = await persistence.load()

        XCTAssertEqual(loaded, [entityB])
    }

    // MARK: - Helpers

    private func makeURL() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("character-events-test-\(UUID().uuidString).json")
    }
}
