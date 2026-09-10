import Foundation

/**
 **로그아웃 중에 도착한 환불 통보를 적어 둔다.**

 ⚠ 이게 없으면 **환불이 영영 서버에 닿지 않는다**(코덱스 #733 4차). 세 가지가 겹친다:
 - 환불된 트랜잭션은 `Transaction.currentEntitlements` 에 **나오지 않는다.**
 - 구독은 구매 시점에 이미 `finish()` 돼 있어 `Transaction.unfinished` 에도 없다.
 - `Transaction.updates` 는 앞 프로세스가 흘려보낸 것을 다시 물어다 주지 않는다.

 그래서 그 순간 로그인돼 있지 않으면 다시 올릴 경로가 **하나도 없고**, 환불받은 소유자와
 그 그룹이 만료 크론까지 유료로 남는다. 애플에는 우리가 받는 서버 알림 라우트도 없다.

 서버의 환불 갈래는 **호출자가 아니라 트랜잭션에서** 대상 구독을 찾으므로, 나중에 아무
 계정으로 로그인해서 올려도 주인의 것을 정확히 회수한다.
 */
enum PendingRevokedTransactionStore {
    private static let key = "pending_revoked_transaction_ids"

    /// 담아 두는 최대 개수. 넘치면 **오래된 것부터** 버린다 — 서버가 영영 못 받는 id
    /// (앱 재설치로 계정을 잃은 경우 등)가 큐를 영구히 채우지 않게 한다.
    private static let limit = 20

    static func ids(defaults: UserDefaults = .standard) -> [String] {
        defaults.stringArray(forKey: key) ?? []
    }

    static func add(_ transactionID: String, defaults: UserDefaults = .standard) {
        var list = ids(defaults: defaults)
        guard !list.contains(transactionID) else { return }
        list.append(transactionID)
        if list.count > limit { list.removeFirst(list.count - limit) }
        defaults.set(list, forKey: key)
    }

    static func remove(_ transactionID: String, defaults: UserDefaults = .standard) {
        let list = ids(defaults: defaults).filter { $0 != transactionID }
        if list.isEmpty {
            defaults.removeObject(forKey: key)
        } else {
            defaults.set(list, forKey: key)
        }
    }

    /// ⚠ **로그아웃에서 비우지 않는다.** 주인이 로그아웃한 뒤에 온 환불이 정확히 이 큐가
    /// 있어야 하는 경우다 — 비우면 만들자마자 쓸모가 없어진다.
    static func clearAllForTests(defaults: UserDefaults = .standard) {
        defaults.removeObject(forKey: key)
    }
}
