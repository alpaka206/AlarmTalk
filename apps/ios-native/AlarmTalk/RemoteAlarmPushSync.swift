import Foundation

protocol RemoteAlarmWriting: Sendable {
    func createAlarm(_ body: RemoteAlarmWriteRequest, token: String) async throws -> RemoteAlarm
    func updateAlarm(id: String, requestBody: RemoteAlarmWriteRequest, token: String) async throws -> RemoteAlarm
}

extension AlarmTalkAPI: RemoteAlarmWriting {}

// MARK: - RemoteAlarmPushSync
//
// Android `AlarmSyncService.kt` 의 push 흐름과 동등.
//
// 책임:
//   - origin == .localOwned 이고 syncState != .synced 인 모든 로컬 알람을 서버에 push.
//   - remoteAlarmId 가 nil 이면 POST /alarm (create), 있으면 PATCH /alarm/{id} (update).
//   - 성공 시 markRemote 로 서버 ID를 저장하고, 전송 중 편집된 행은 dirty로 보존.
//   - 실패 시 markSyncFailed 로 syncState = sync_failed 만 기록. 다음 사이클이 재시도.
//
// 호출 컨텍스트:
//   - `BackgroundSyncTask` 가 pull 보다 먼저 호출 (서버가 최신 상태를 응답하도록).
//   - 외부 UI 의 "서버에 저장" 단일 액션은 여전히
//     `RemoteAlarmSyncViewModel.push(record:)` 로 단건 push.
//
// Sendable 안전성:
//   - mutable state 는 `@MainActor` 격리지만 await 중에는 사용자 편집이 끼어들 수 있어
//     응답 커밋에서 스냅샷을 비교한다. `BGTaskScheduler.shared.register` 가 요구하는
//     `@Sendable` 클로저 안에서 인스턴스를 capture 해야 하므로 (Swift 6 strict
//     concurrency 대비), `@unchecked Sendable` 로 명시적 인증을 표기한다.
//     실제 transfer 는 MainActor 로 즉시 hop 한 뒤에만 사용된다.
@MainActor
final class RemoteAlarmPushSync: @unchecked Sendable {

    enum PushError: LocalizedError, Equatable {
        case noSession
        case localCommitFailed

        var errorDescription: String? {
            switch self {
            case .noSession: return "Push sync requires an active session."
            case .localCommitFailed: return "알람 변경사항을 저장하지 못했어요. 잠시 후 다시 시도해 주세요."
            }
        }
    }

    struct PushResult: Equatable {
        var attempted: Int
        var created: Int
        var updated: Int
        var failed: Int
    }

    private let api: any RemoteAlarmWriting
    private let store: LocalAlarmStore
    private let auth: AuthViewModel

    init(api: any RemoteAlarmWriting = AlarmTalkAPI.shared, store: LocalAlarmStore, auth: AuthViewModel) {
        self.api = api
        self.store = store
        self.auth = auth
    }

    /// 한 번의 push 사이클을 수행한다.
    /// **타입 단위** 겹침 가드. 인스턴스 플래그로는 못 막는다 — `RemoteAlarmSyncViewModel`
    /// 과 `AlarmTalkApp` 의 백그라운드 부트스트랩이 **서로 다른 인스턴스**를 만드는데
    /// `LocalAlarmStore` 는 하나뿐이다.
    ///
    /// 왜 필요한가(안드로이드 `1b5e3a84` 와 같은 버그): 아래 루프는 후보를 스냅샷한 뒤
    /// `await api.createAlarm` 을 거쳐 **응답이 와야** `remoteAlarmId` 를 커밋한다. 두 회차가
    /// 그 창 안에서 겹치면 둘 다 `remoteAlarmId == nil` 을 보고 **둘 다 create 로 가서
    /// 서버에 같은 알람이 두 행 생긴다.** 로컬 행은 하나라 앱에서는 정상으로 보이고,
    /// 가족 알람이면 수신자 기기에서 두 번 울린다.
    private static let serialGate = AsyncSerialGate()

    @discardableResult
    func runOnce() async throws -> PushResult {
        await Self.serialGate.acquire()
        defer { Self.serialGate.release() }
        try Task.checkCancellation()
        // 대기 호출이 자기 회차를 맡는다. 앞 BGTask의 취소·오류가 후속 전송을 버리지 않는다.
        return try await runCycle()
    }

    /// 한 회차. **세션은 회차마다, 그리고 건마다 다시 읽는다** — 미뤄 둔 회차는 앞 회차의
    /// 네트워크 왕복이 끝난 뒤에 도는데, 그 사이 로그아웃/계정 전환이 있었으면 옛 토큰으로
    /// 나간다(안드로이드 `2836ebcf`). rolling refresh 를 넣은 뒤로는 토큰이 더 자주 바뀌어,
    /// 회차 시작에 한 번 읽는 것만으로는 건이 여러 개일 때 뒤쪽이 옛 토큰을 쓴다.
    /// 다시 읽을 때는 **주인이 같은지 먼저 확인한다**(아래 `ownerID`).
    private func runCycle() async throws -> PushResult {
        guard let session = auth.session else { throw PushError.noSession }
        // 이 회차가 **누구의** 알람을 올리는지 고정한다. candidates 는 지금의 store 스냅샷이라
        // 도중에 계정이 바뀌면 그 알람들은 더 이상 현재 사용자의 것이 아니다.
        let ownerID = session.user.id

        let candidates = store.alarms.filter { record in
            LocalAlarmStore.isOutboundSyncCandidate(record, ownerUserID: ownerID)
        }

        var created = 0
        var updated = 0
        var failed = 0
        let nowMillis = Int64(Date().timeIntervalSince1970 * 1000)

        for candidate in candidates {
            try Task.checkCancellation()
            // 토큰은 **건마다 다시 읽는다.** 회차 시작에 한 번만 읽으면, 건이 여러 개일 때
            // 중간에 rolling refresh 로 토큰이 갱신돼도 뒤쪽 건이 옛 토큰으로 나가
            // 만료 직전이었다면 401 로 떨어진다.
            guard let current = auth.session else { throw PushError.noSession }
            // ⚠ **토큰만 다시 읽으면 더 위험하다.** 계정이 바뀌었는데 새 토큰을 쓰면
            // 앞 계정의 알람을 **새 계정에 써 넣는다.** 주인이 달라지면 회차를 멈춘다 —
            // 남은 건은 syncState 가 그대로라 다음 회차에 새 주인 기준으로 다시 걸러진다.
            guard current.user.id == ownerID else { break }
            // 최신 행의 소유자와 전송 보류도 건마다 확인한다.
            guard let record = store.outboundSyncRecord(id: candidate.id, ownerUserID: ownerID) else { continue }
            let token = current.token

            let body = RemoteAlarmMapper.toRemoteRequest(record)
            do {
                let remote: RemoteAlarm
                if let remoteID = record.remoteAlarmId {
                    remote = try await api.updateAlarm(id: remoteID, requestBody: body, token: token)
                } else {
                    remote = try await api.createAlarm(body, token: token)
                }
                // 성공 응답의 ID를 await 없이 디스크에 쓴 뒤 취소를 전파한다.
                // 특히 create는 이 순서를 뒤집으면 다음 회차가 중복 POST를 한다.
                guard store.markRemote(
                    snapshot: record,
                    remoteID: remote.id,
                    lastSyncedAtMillis: nowMillis
                ) else { throw PushError.localCommitFailed }
                if record.remoteAlarmId == nil { created += 1 }
                else { updated += 1 }
                try Task.checkCancellation()
            } catch is CancellationError {
                // ⚠ **취소는 실패가 아니다 — 회차를 멈춘다**(2026-08-18 Codex #697 P2).
                // 워치독·BGTask 만료가 이 회차를 접는 신호인데, 여기서 여느 실패처럼
                // 삼키면 **끝났다고 통보한 뒤에도** 남은 후보를 계속 밀어 넣는다.
                // 게다가 `markSyncFailed` 로 기록하면 멀쩡한 알람이 '동기화 실패' 로
                // 남아 다음 회차에 불필요하게 다시 걸리고, 사용자에게는 "일부를 저장하지
                // 못했어요" 가 뜬다 — 아무것도 실패하지 않았는데.
                throw CancellationError()
            } catch {
                // 취소가 다른 오류에 감싸여 올 수도 있다(URLSession 은 `NSURLErrorCancelled`).
                if Task.isCancelled { throw CancellationError() }
                failed += 1
                store.markSyncFailed(id: record.id)
                // ⚠ **삼키지 말 것.** 여기서 조용히 넘어가는 바람에 사용자에게는
                // "알람 변경사항 일부를 저장하지 못했어요" 가 계속 뜨는데 **왜인지 알
                // 방법이 없었다**(2026-08-11 지적). 실패한 건은 다음 회차에 또 걸리므로
                // 원인이 남지 않으면 같은 안내가 영원히 반복된다.
                // 알람 id 는 남기지 않는다(로컬 식별자라 쓸모 대비 노출이 크다) —
                // 무엇이 왜 실패했는지는 상태코드·error_code 가 말해 준다.
                let detail: String = if case let APIError.server(status, _, code) = error {
                    "status=\(status) code=\(code ?? "-")"
                } else {
                    String(describing: type(of: error))
                }
                AlarmTalkLog.reportError(
                    "알람 push 실패(\(record.remoteAlarmId == nil ? "create" : "update")): \(detail)",
                    error: error
                )
                // ⚠ **401 이면 회차를 끊는다**(2026-09-21 Sentry ALARMTALK-IOS-2, 700건).
                // 토큰이 죽었으면 남은 후보도 **전부 같은 401** 로 떨어진다 — 미동기 알람이
                // N개면 한 회차가 같은 보고를 N건 쏟는다. 중앙 처리기가 세션을 끊는 것은
                // 알림 디바운스 뒤라 그 사이 루프가 끝까지 돌고, 건마다 `markSyncFailed` 까지
                // 남겨 멀쩡한 행이 무더기로 '동기화 실패' 가 된다.
                // 계정 변경 `break` 와 같은 뜻이다 — **지금 이 회차로는 못 올린다.** 남은 건은
                // syncState 가 그대로라 다음 회차(재로그인 뒤)에 다시 걸린다.
                if case APIError.server(401, _, _) = error { break }
            }
        }

        // 계정이 바뀌어 중간에 멈췄으면 남은 건은 시도하지 않았다 —
        // `candidates.count` 를 그대로 쓰면 하지도 않은 시도를 셌다고 보고한다.
        return PushResult(
            attempted: created + updated + failed,
            created: created,
            updated: updated,
            failed: failed
        )
    }
}
