import Foundation
import OSLog

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
    ///
    /// `reportFailure` 는 **이슈로 올리는 자리**다(기본은 `AlarmTalkLog.reportError`). 유닛
    /// 테스트는 Sentry 를 켜지 않아(`AlarmTalkLog.shouldStartCrashReporting`) 무엇이 이슈가
    /// 됐는지 SDK 로는 볼 수 없으므로, 이 자리를 주입해 「취소는 부르지 않고 실패는 부른다」
    /// 를 회귀 테스트가 직접 본다(`UsageEventUploaderTests`).
    func flush(
        session: AuthSession?,
        api: AlarmTalkAPI = .shared,
        queue: UsageEventQueue = .shared,
        maxBatches: Int? = nil,
        reportFailure: (String, Error) -> Void = { AlarmTalkLog.reportError($0, error: $1) }
    ) async {
        guard let session, !isUploading else { return }
        isUploading = true
        defer { isUploading = false }

        for _ in 0..<max(0, min(maxBatches ?? maxBatchesPerRun, maxBatchesPerRun)) {
            if Task.isCancelled { return }
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
                // ⚠ **어느 갈래로 가든 큐를 지우지 않는다.** 다음 기회에 그대로 다시 보낸다.
                //
                // ⚠ **취소는 실패가 아니다 — 이슈로 올리지 않는다.** BG 워치독(25초)·시스템
                // 만료가 전송 **도중** `work.cancel()` 을 부르면(`BackgroundSyncTask`), 이미
                // 날아간 URLSession 요청은 `CancellationError` 가 아니라 `URLError(.cancelled)`
                // 로 돌아온다(`UserFacingError.swift` 의 `isCancellation` 주석). 그 코드는
                // `AlarmTalkLog.isExpectedTransientFailure` 의 일시적 네트워크 목록에 **없어서**,
                // `reportError` 에 그대로 넘기면 브레드크럼이 아니라 **이슈**가 된다 — 큐는
                // 그대로라 잃는 것이 없는 허위 경보다. 형제 `RemoteAlarmPushSync` 와 같은
                // 방식으로 여기서 거른다: 취소 오류 자체(`isCancellation`)와, 다른 오류에
                // 감싸여 온 경우(`Task.isCancelled`) 둘 다 본다. 다음 배치로 넘어가지 않고
                // 회차를 끝낸다 — 취소된 회차가 계속 보내면 「끝났다」 고 통보한 뒤에도 요청이
                // 나간다.
                if Task.isCancelled || isCancellation(error) {
                    AlarmTalkLog.logger.info("사용 기록 전송 취소 — 큐에 남겨 둔다")
                    return
                }
                // ⚠ **동의 전(403 CONSENT_REQUIRED)은 이슈가 아니다 — 안드로이드와 같다.**
                //   로그인 직후 필수 동의를 아직 안 한 계정은 서버가 사용 기록을 받지 않는다.
                //   안드로이드 `SyncWorkerFailure` 의 CONSENT_PENDING 은 로그만 남기고 조용히
                //   끝낸다(큐 보존). iOS 만 이슈로 올리면 같은 상태가 두 앱에서 다르게 읽히고,
                //   동의 전 BG 사이클마다 한 건씩 허위 경보가 쌓인다. 큐는 그대로 두어 동의 뒤
                //   전송된다.
                if case APIError.server(403, _, let code) = error, code == "CONSENT_REQUIRED" {
                    AlarmTalkLog.logger.info("사용 기록 전송 보류 — 동의 전이라 큐에 남겨 둔다")
                    return
                }
                reportFailure("사용 기록 전송 실패 — 큐에 남겨 둔다", error)
                return
            }
        }
    }
}
