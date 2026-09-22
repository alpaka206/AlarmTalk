import Foundation

/// 비동기 작업이 **총 대기 상한**을 넘겼을 때 `withTimeout` 이 던지는 오류.
///
/// `URLSessionConfiguration.timeoutIntervalForRequest`(`AlarmTalkAPI.makeDefaultSession` 의
/// 60초)는 "다음 바이트를 기다리는" 유휴 시간이지 호출 전체의 상한이 아니다. 서버가 응답을
/// 만드는 동안 한 바이트도 보내지 않는 엔드포인트(`GET /tts/prerender-variant` 처럼 뒤에서
/// 외부 API 를 순차로 부르는 것)를 사용자가 **눈앞에서** 기다리는 자리에는 이 상한을 따로 건다.
struct AsyncTimeoutError: Error, Equatable {
    let seconds: TimeInterval
}

/// [operation] 을 [seconds] 안에 끝내지 못하면 `AsyncTimeoutError` 를 던진다.
///
/// 먼저 끝난 쪽이 답이다 — 작업이 먼저 끝나면 그 값(또는 그 오류)이고, 시계가 먼저 끝나면
/// `AsyncTimeoutError` 다. **어느 쪽이든 나머지는 취소하고 그 결과는 버린다.** 그래서 상한을
/// 넘긴 뒤 뒤늦게 온 값이 호출자에게 닿을 길이 없다(호출자는 한 번만 돌아온다).
///
/// 이미 날아간 URLSession 요청은 취소되면 `URLError(.cancelled)` 로 돌아온다
/// (`isCancellation`). 그 오류는 여기서 버려지지만, 어느 경로로 새더라도 이슈가 되지 않는다 —
/// `AlarmTalkLog.transientURLErrorCodes` 에 `.cancelled` 가 있다.
///
/// ⚠ **작업이 취소에 협력해야 상한이 지켜진다.** 구조화 동시성이라 두 자식이 모두 끝나야
/// 돌아오는데, URLSession 은 취소하면 곧바로 `.cancelled` 로 끝나므로 문제없다. 취소를
/// 무시하는 작업을 넣으면 값은 버려지되 돌아오는 시점은 그 작업이 끝날 때다.
///
/// 바깥 Task 가 취소되면 두 자식이 함께 취소되고, 먼저 끝난 쪽의 오류(`CancellationError`
/// 또는 `URLError(.cancelled)`)가 그대로 올라간다 — 상한 오류로 바꾸지 않는다.
func withTimeout<T: Sendable>(
    seconds: TimeInterval,
    operation: @escaping @Sendable () async throws -> T
) async throws -> T {
    try await withThrowingTaskGroup(of: T.self) { group in
        group.addTask { try await operation() }
        group.addTask {
            try await Task.sleep(nanoseconds: UInt64(max(0, seconds) * 1_000_000_000))
            throw AsyncTimeoutError(seconds: seconds)
        }
        do {
            guard let first = try await group.next() else {
                throw AsyncTimeoutError(seconds: seconds)
            }
            group.cancelAll()
            return first
        } catch {
            group.cancelAll()
            throw error
        }
    }
}
