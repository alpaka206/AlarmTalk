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

    /// ⚠ **읽고-고치고-쓰기를 직렬화한다**(코덱스 #733 8차). `add` 는 `Transaction.updates`
    /// 리스너의 `Task.detached` 에서, `remove` 는 MainActor 의 flush 에서 돈다 — 겹치면
    /// remove 가 읽은 `[A]` 위에 add 가 `[A, B]` 를 쓰고 remove 가 `[]` 로 덮어 **B 가 영영
    /// 사라진다.** 환불된 트랜잭션은 `currentEntitlements` 에도 `unfinished` 에도 없어
    /// 그 id 는 다시 만들 방법이 없다.
    private static let lock = NSLock()

    /// 담아 두는 최대 개수. 넘치면 **오래된 것부터** 버린다 — 서버가 영영 못 받는 id
    /// (앱 재설치로 계정을 잃은 경우 등)가 큐를 영구히 채우지 않게 한다.
    private static let limit = 20

    static func ids(defaults: UserDefaults = .standard) -> [String] {
        lock.lock()
        defer { lock.unlock() }
        return stored(defaults)
    }

    static func add(_ transactionID: String, defaults: UserDefaults = .standard) {
        lock.lock()
        defer { lock.unlock() }
        var list = stored(defaults)
        guard !list.contains(transactionID) else { return }
        list.append(transactionID)
        if list.count > limit { list.removeFirst(list.count - limit) }
        defaults.set(list, forKey: key)
    }

    static func remove(_ transactionID: String, defaults: UserDefaults = .standard) {
        lock.lock()
        defer { lock.unlock() }
        let list = stored(defaults).filter { $0 != transactionID }
        if list.isEmpty {
            defaults.removeObject(forKey: key)
        } else {
            defaults.set(list, forKey: key)
        }
    }

    /// 락을 **이미 쥔 상태**에서만 부른다.
    private static func stored(_ defaults: UserDefaults) -> [String] {
        defaults.stringArray(forKey: key) ?? []
    }

    /// ⚠ **로그아웃에서 비우지 않는다.** 주인이 로그아웃한 뒤에 온 환불이 정확히 이 큐가
    /// 있어야 하는 경우다 — 비우면 만들자마자 쓸모가 없어진다.
    static func clearAllForTests(defaults: UserDefaults = .standard) {
        lock.lock()
        defer { lock.unlock() }
        defaults.removeObject(forKey: key)
    }
}
