import XCTest
@testable import AlarmTalk

/// **로그아웃 중에 온 환불 통보를 잃지 않는다**(코덱스 #733 4차).
final class PendingRevokedTransactionStoreTests: XCTestCase {
    private var defaults: UserDefaults!

    override func setUp() {
        super.setUp()
        defaults = UserDefaults(suiteName: "PendingRevokedTransactionStoreTests")!
        defaults.removePersistentDomain(forName: "PendingRevokedTransactionStoreTests")
    }

    func test_적고_읽는다() {
        PendingRevokedTransactionStore.add("tx-1", defaults: defaults)
        PendingRevokedTransactionStore.add("tx-2", defaults: defaults)
        XCTAssertEqual(PendingRevokedTransactionStore.ids(defaults: defaults), ["tx-1", "tx-2"])
    }

    func test_같은_id_는_두_번_담지_않는다() {
        // 스토어는 같은 트랜잭션을 여러 번 재전달한다.
        PendingRevokedTransactionStore.add("tx-1", defaults: defaults)
        PendingRevokedTransactionStore.add("tx-1", defaults: defaults)
        XCTAssertEqual(PendingRevokedTransactionStore.ids(defaults: defaults), ["tx-1"])
    }

    func test_올린_것은_지운다() {
        PendingRevokedTransactionStore.add("tx-1", defaults: defaults)
        PendingRevokedTransactionStore.add("tx-2", defaults: defaults)
        PendingRevokedTransactionStore.remove("tx-1", defaults: defaults)
        XCTAssertEqual(PendingRevokedTransactionStore.ids(defaults: defaults), ["tx-2"])
    }

    func test_상한을_넘으면_오래된_것부터_버린다() {
        // ⚠ 서버가 영영 못 받는 id(앱 재설치로 계정을 잃은 경우 등)가 큐를 영구히
        //   채우지 않게 한다.
        for index in 1...25 {
            PendingRevokedTransactionStore.add("tx-\(index)", defaults: defaults)
        }
        let ids = PendingRevokedTransactionStore.ids(defaults: defaults)
        XCTAssertEqual(ids.count, 20)
        XCTAssertEqual(ids.first, "tx-6")
        XCTAssertEqual(ids.last, "tx-25")
    }

    func test_비어_있으면_빈_배열() {
        XCTAssertEqual(PendingRevokedTransactionStore.ids(defaults: defaults), [])
    }
}
