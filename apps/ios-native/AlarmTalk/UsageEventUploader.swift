import Foundation

/// 쌓아 둔 사용 기록을 서버로 보낸다.
///
/// ⚠ **보내는 일만 한다 — 적는 일은 `UsageEventQueue` 가 한다.** 울림처럼 네트워크를
/// 부르면 안 되는 자리에서도 기록은 남아야 해서 둘을 갈라 두었다(CLAUDE.md 「Real alarm」).
///
/// 실패하면 큐를 비우지 않는다 — **성공한 배치만** 지운다. 그래서 응답을 못 받으면 같은
/// 배치가 다시 가는데, 서버가 클라 UUID 로 멱등 처리하므로 중복이 생기지 않는다.
/// 안드로이드 `UsageEventUploadWorker` 와 같은 규칙이다.
@MainActor
final class UsageEventUploader {
    static let shared = UsageEventUploader()

    private let batchSize = 100
    private let maxBatchesPerRun = 5
    /// 지금 보내는 중인가. 앱 복귀가 연달아 오면 같은 배치를 동시에 두 번 보내게 된다.
    private var isUploading = false

    private init() {}

    /// 밀린 기록을 올린다. 연결이 없거나 로그인 상태가 아니면 조용히 아무 일도 하지 않는다.
    func flush(session: AuthSession?, api: AlarmTalkAPI = .shared, queue: UsageEventQueue = .shared) async {
        guard let session, !isUploading else { return }
        isUploading = true
        defer { isUploading = false }

        for _ in 0..<maxBatchesPerRun {
            let batch = queue.oldest(userID: session.user.id, limit: batchSize)
            if batch.isEmpty { return }
            do {
                try await api.uploadUsageEvents(batch, authToken: session.token)
                queue.remove(ids: Set(batch.map { $0.id }))
            } catch {
                // ⚠ **큐를 지우지 않는다.** 다음 기회에 그대로 다시 보낸다.
                AlarmTalkLog.reportError("사용 기록 전송 실패 — 큐에 남겨 둔다", error: error)
                return
            }
        }
    }
}
