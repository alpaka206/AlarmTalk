import XCTest
@testable import AlarmTalk

final class ReceivedAlarmBadgeStoreTests: XCTestCase {
    private var suiteName: String!
    private var defaults: UserDefaults!
    private var store: ReceivedAlarmBadgeStore!

    override func setUp() {
        super.setUp()
        suiteName = "ReceivedAlarmBadgeStoreTests-\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        store = ReceivedAlarmBadgeStore(defaults: defaults)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        store = nil
        defaults = nil
        suiteName = nil
        super.tearDown()
    }

    func test_readWithoutBaselineReturnsZero() {
        XCTAssertFalse(store.hasBaseline(userID: "user-1"))
        XCTAssertEqual(store.readSeenAtMillis(userID: "user-1"), 0)
    }

    func test_markSeenStoresLatestReceivedRemoteCreatedAt() {
        let seenAt = store.markSeen(
            userID: "user-1",
            alarms: [
                alarm(id: "local", origin: .localOwned, createdAtMillis: 9_000),
                alarm(id: "received-old", origin: .receivedRemote, createdAtMillis: 1_000),
                alarm(id: "received-new", origin: .receivedRemote, createdAtMillis: 4_000),
            ]
        )

        XCTAssertEqual(seenAt, 4_000)
        XCTAssertTrue(store.hasBaseline(userID: "user-1"))
        XCTAssertEqual(store.readSeenAtMillis(userID: "user-1"), 4_000)
    }

    func test_baselineIsUserScoped() {
        _ = store.markSeen(
            userID: "user-1",
            alarms: [alarm(id: "received", origin: .receivedRemote, createdAtMillis: 3_000)]
        )

        XCTAssertEqual(store.readSeenAtMillis(userID: "user-1"), 3_000)
        XCTAssertEqual(store.readSeenAtMillis(userID: "user-2"), 0)
        XCTAssertFalse(store.hasBaseline(userID: "user-2"))
    }

    private func alarm(
        id: String,
        origin: AlarmOrigin,
        createdAtMillis: Int64
    ) -> LocalAlarmRecord {
        LocalAlarmRecord(
            id: id,
            label: id,
            hour: 7,
            minute: 30,
            fireAtMillis: createdAtMillis + 60_000,
            origin: origin.rawValue,
            createdAtMillis: createdAtMillis,
            updatedAtMillis: createdAtMillis
        )
    }
}
