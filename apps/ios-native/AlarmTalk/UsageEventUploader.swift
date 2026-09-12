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
            // ⚠ **계정이 바뀌었으면 그 자리에서 멈춘다**(`docs/spec/usage-events.md` §4).
            // 배치를 꺼낸 뒤·보내기 전에 본다 — 안드로이드 `UsageEventUploadWorker` 의
            // 세대 검사와 같은 자리다. iOS 에는 세대 카운터가 없어 **토큰을 에폭으로** 쓴다.
            // `await` 마다 다른 일이 끼어들 수 있어(같은 MainActor 의 로그아웃이 그렇다)
            // 한 번 받아 둔 세션만 믿고 남은 배치를 계속 보내면, 떠난 계정의 기록이
            // 그 뒤에도 계속 올라간다.
            guard KeychainStore.runIfCurrentSession(
                userID: session.user.id,
                token: session.token,
                action: {}
            ) else { return }
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
