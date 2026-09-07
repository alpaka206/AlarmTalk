import Foundation
import Testing
@testable import AlarmTalk

/// 사용 기록 큐 — **오프라인에서 쌓았다가 성공한 것만 지운다** 는 계약을 지킨다.
struct UsageEventQueueTests {
    /// 로그인 계정은 **주입한다** — 테스트가 기기의 진짜 키체인을 읽지 않게.
    private func makeQueue(currentUserID: String? = "u1") -> (UsageEventQueue, URL) {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("usage-events-\(UUID().uuidString).json")
        return (UsageEventQueue(fileURL: url, currentUserID: { currentUserID }), url)
    }

    @Test("적은 순서대로 꺼낸다 — 오래된 것이 먼저 간다")
    func ordersOldestFirst() throws {
        let (queue, url) = makeQueue()
        defer { try? FileManager.default.removeItem(at: url) }
        let now = Date()
        queue.record(.alarmCreated, alarmID: "a", userID: "u1", occurredAt: now)
        queue.record(.alarmRang, alarmID: "b", userID: "u1", occurredAt: now.addingTimeInterval(-60))
        // 파일 쓰기는 비동기 큐라 값이 보일 때까지 기다린다.
        try waitUntil { queue.count == 2 }

        let batch = queue.oldest(userID: "u1", limit: 10)
        #expect(batch.map(\.alarmID) == ["b", "a"])
    }

    @Test("성공한 것만 지운다 — 실패한 배치는 그대로 남아 다시 간다")
    func removesOnlyAcknowledged() throws {
        let (queue, url) = makeQueue()
        defer { try? FileManager.default.removeItem(at: url) }
        queue.record(.alarmCreated, alarmID: "a", userID: "u1")
        queue.record(.alarmDeleted, alarmID: "b", userID: "u1")
        try waitUntil { queue.count == 2 }

        let batch = queue.oldest(userID: "u1", limit: 10)
        queue.remove(ids: [batch[0].id])
        try waitUntil { queue.count == 1 }
        #expect(queue.oldest(userID: "u1", limit: 10).first?.id == batch[1].id)
    }

    @Test("다른 계정의 기록은 보내지 않는다 — 서버는 토큰의 주인으로 적는다")
    func filtersByAccount() throws {
        let (queue, url) = makeQueue()
        defer { try? FileManager.default.removeItem(at: url) }
        queue.record(.alarmCreated, alarmID: "mine", userID: "u1")
        queue.record(.alarmCreated, alarmID: "theirs", userID: "u2")
        try waitUntil { queue.count == 2 }

        let batch = queue.oldest(userID: "u1", limit: 10)
        #expect(batch.map(\.alarmID) == ["mine"])
    }

    @Test("계정을 안 넘겨도 그때의 계정에 묶인다 — 울림·삭제 경로가 빠뜨리지 못한다")
    func bindsCurrentAccountWithoutExplicitUserID() throws {
        let (queue, url) = makeQueue(currentUserID: "u1")
        defer { try? FileManager.default.removeItem(at: url) }
        // 울림·삭제 경로는 계정을 넘기지 않는다. 그래도 u1 것이어야 한다 —
        // 비어 있으면 다음에 로그인한 u2 의 기록으로 올라간다(서버가 토큰 주인으로 적는다).
        queue.record(.alarmRang, alarmID: "a")
        try waitUntil { queue.count == 1 }

        #expect(queue.oldest(userID: "u2", limit: 10).isEmpty)
        #expect(queue.oldest(userID: "u1", limit: 10).first?.alarmID == "a")
    }

    @Test("계정은 적는 순간에 정해진다 — 그 뒤에 바뀌어도 남의 이름으로 가지 않는다")
    func stampsAccountAtRecordTime() throws {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("usage-events-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: url) }
        let box = AccountBox("u1")
        let queue = UsageEventQueue(fileURL: url, currentUserID: { box.read() })

        queue.record(.alarmRang, alarmID: "a")
        // 파일 쓰기는 비동기여도 **계정은 이미 정해져 있어야 한다.** 큐 안에서 읽으면
        // 이 시점에 아직 0이고, 그 사이 로그아웃·로그인이 끼어들면 남의 기록이 된다.
        #expect(box.readCount == 1)

        box.set("u2")
        try waitUntil { queue.count == 1 }
        #expect(queue.oldest(userID: "u2", limit: 10).isEmpty)
        #expect(queue.oldest(userID: "u1", limit: 10).first?.alarmID == "a")
    }

    @Test("계정이 없으면 아예 적지 않는다 — 다음에 로그인한 사람 것이 되면 안 된다")
    func skipsRecordingWithoutAccount() throws {
        let (queue, url) = makeQueue(currentUserID: nil)
        defer { try? FileManager.default.removeItem(at: url) }

        queue.record(.alarmRang, alarmID: "a")

        // 비동기 쓰기가 없다는 것을 보이려면 잠깐 기다렸다 세는 수밖에 없다.
        usleep(200_000)
        #expect(queue.count == 0)
    }

    @Test("적힌 뒤에 알린다 — 표시를 먼저 남기면 적히지 않은 울림을 삼킨다")
    func notifiesOnlyAfterTheEventIsOnDisk() throws {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("usage-events-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: url) }
        let queue = UsageEventQueue(fileURL: url, currentUserID: { "u1" })
        let seen = AccountBox(nil)

        queue.record(.alarmRang, alarmID: "a", onPersisted: {
            // 콜백이 온 시점에 파일에 이미 있어야 한다.
            let data = (try? Data(contentsOf: url)) ?? Data()
            seen.set(String(data: data, encoding: .utf8) ?? "")
        })

        try waitUntil { seen.read() != nil }
        #expect(seen.read()?.contains("alarm_rang") == true)
    }

    @Test("적지 못했으면 알리지 않는다 — 못 적은 것을 적힌 것으로 알리면 삼킨다")
    func doesNotNotifyWhenTheWriteFails() throws {
        // 없는 디렉터리 아래로 쓰게 해서 파일 쓰기를 실패시킨다.
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("no-such-dir-\(UUID().uuidString)")
            .appendingPathComponent("usage-events.json")
        let queue = UsageEventQueue(fileURL: url, currentUserID: { "u1" })
        let notified = AccountBox(nil)

        queue.record(.alarmRang, alarmID: "a", onPersisted: { notified.set("yes") })

        // 같은 직렬 큐를 타는 `count` 로 배리어를 건다.
        _ = queue.count
        #expect(notified.read() == nil)
    }

    /// 기록 도중 계정이 바뀌는 상황을 만든다. 큐가 다른 스레드에서 읽을 수 있어 잠근다.
    private final class AccountBox: @unchecked Sendable {
        private let lock = NSLock()
        private var value: String?
        private var reads = 0

        init(_ value: String?) { self.value = value }

        func read() -> String? {
            lock.lock()
            defer { lock.unlock() }
            reads += 1
            return value
        }

        func set(_ next: String?) {
            lock.lock()
            defer { lock.unlock() }
            value = next
        }

        var readCount: Int {
            lock.lock()
            defer { lock.unlock() }
            return reads
        }
    }

    @Test("넘긴 계정이 이긴다 — 편집기는 메모리에 든 세션을 쓴다")
    func explicitUserIDWins() throws {
        let (queue, url) = makeQueue(currentUserID: "u1")
        defer { try? FileManager.default.removeItem(at: url) }
        queue.record(.alarmCreated, alarmID: "b", userID: "u9")
        try waitUntil { queue.count == 1 }

        #expect(queue.oldest(userID: "u1", limit: 10).isEmpty)
        #expect(queue.oldest(userID: "u9", limit: 10).first?.alarmID == "b")
    }

    @Test("자유 문자열은 길이를 자른다 — 이벤트는 식별자만 나른다")
    func trimsDetail() throws {
        let (queue, url) = makeQueue()
        defer { try? FileManager.default.removeItem(at: url) }
        queue.record(.alarmSnoozed, alarmID: "a", detail: String(repeating: "x", count: 300), userID: "u1")
        try waitUntil { queue.count == 1 }
        #expect(queue.oldest(userID: "u1", limit: 1).first?.detail?.count == 120)
    }

    /// 파일 쓰기가 비동기라 값이 보일 때까지 짧게 기다린다.
    private func waitUntil(_ condition: () -> Bool, timeout: TimeInterval = 2) throws {
        let deadline = Date().addingTimeInterval(timeout)
        while !condition() {
            if Date() > deadline { throw TestFailure.timedOut }
            usleep(20_000)
        }
    }

    private enum TestFailure: Error { case timedOut }
}
