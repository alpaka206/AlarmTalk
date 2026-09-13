import Foundation

/// MainActor의 await 사이 재진입을 직렬화한다. 대기자는 자기 호출의 취소 상태·인자를 유지한다.
@MainActor
final class AsyncSerialGate {
    private var locked = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    func acquire() async {
        if !locked {
            locked = true
            return
        }
        await withCheckedContinuation { waiters.append($0) }
    }

    func release() {
        if waiters.isEmpty { locked = false }
        else { waiters.removeFirst().resume() }
    }
}
