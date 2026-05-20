import Foundation

// MARK: - RemoteAlarmPushSync
//
// Android `AlarmSyncService.kt` 의 push 흐름과 동등.
//
// 책임:
//   - origin == .localOwned 이고 syncState != .synced 인 모든 로컬 알람을 서버에 push.
//   - remoteAlarmId 가 nil 이면 POST /alarm (create), 있으면 PATCH /alarm/{id} (update).
//   - 성공 시 markRemote 로 syncState = synced, lastSyncedAtMillis 갱신.
//   - 실패 시 markSyncFailed 로 syncState = sync_failed 만 기록. 다음 사이클이 재시도.
//
// 호출 컨텍스트:
//   - `BackgroundSyncTask` 가 pull 보다 먼저 호출 (서버가 최신 상태를 응답하도록).
//   - 외부 UI 의 "서버에 저장" 단일 액션은 여전히
//     `RemoteAlarmSyncViewModel.push(record:)` 로 단건 push.
//
// Sendable 안전성:
//   - 모든 mutable state 와 메서드가 `@MainActor` 격리되어 외부 race condition 이
//     본질적으로 발생하지 않는다. `BGTaskScheduler.shared.register` 가 요구하는
//     `@Sendable` 클로저 안에서 인스턴스를 capture 해야 하므로 (Swift 6 strict
//     concurrency 대비), `@unchecked Sendable` 로 명시적 인증을 표기한다.
//     실제 transfer 는 MainActor 로 즉시 hop 한 뒤에만 사용된다.
@MainActor
final class RemoteAlarmPushSync: @unchecked Sendable {

    enum PushError: LocalizedError, Equatable {
        case noSession

        var errorDescription: String? {
            switch self {
            case .noSession: return "Push sync requires an active session."
            }
        }
    }

    struct PushResult: Equatable {
        var attempted: Int
        var created: Int
        var updated: Int
        var failed: Int
    }

    private let api: VoiceAlarmAPI
    private let store: LocalAlarmStore
    private let auth: AuthViewModel

    init(api: VoiceAlarmAPI = .shared, store: LocalAlarmStore, auth: AuthViewModel) {
        self.api = api
        self.store = store
        self.auth = auth
    }

    /// 한 번의 push 사이클을 수행한다.
    @discardableResult
    func runOnce() async throws -> PushResult {
        guard let token = auth.session?.token else { throw PushError.noSession }

        let candidates = store.alarms.filter { record in
            record.originEnum == .localOwned && record.syncStateEnum != .synced
        }

        var created = 0
        var updated = 0
        var failed = 0
        let nowMillis = Int64(Date().timeIntervalSince1970 * 1000)

        for record in candidates {
            let body = RemoteAlarmMapper.toRemoteRequest(record)
            do {
                let remote: RemoteAlarm
                if let remoteID = record.remoteAlarmId {
                    remote = try await api.updateAlarm(id: remoteID, requestBody: body, token: token)
                    updated += 1
                } else {
                    remote = try await api.createAlarm(body, token: token)
                    created += 1
                }
                store.markRemote(
                    localID: record.id,
                    remoteID: remote.id,
                    lastSyncedAtMillis: nowMillis,
                    syncState: .synced
                )
            } catch {
                failed += 1
                store.markSyncFailed(id: record.id)
            }
        }

        return PushResult(
            attempted: candidates.count,
            created: created,
            updated: updated,
            failed: failed
        )
    }
}
