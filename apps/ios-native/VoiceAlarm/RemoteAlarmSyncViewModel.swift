import Foundation

// MARK: - RemoteAlarmSyncViewModel
//
// 외부 호출 시그니처 (`refresh(session:)`, `push(record:store:session:)`,
// `deleteRemote(record:session:)`) 는 유지하면서 내부 동기화 로직을
// `RemoteAlarmPullSync` / `RemoteAlarmPushSync` 에 위임한다.
//
// 의존성 주입:
//   - 메인 앱(`VoiceAlarmApp`) 이 `configure(store:alarmKit:auth:)` 를
//     `task { ... }` 안에서 한 번 호출해 pull/push 인스턴스를 초기화한다.
//   - configure 가 호출되기 전이라도 기존 fallback (API 직접 호출) 으로 동작한다.
@MainActor
final class RemoteAlarmSyncViewModel: ObservableObject {
    @Published var remoteAlarms: [RemoteAlarm] = []
    @Published var voiceProfiles: [VoiceProfile] = []
    @Published var statusMessage: String?
    @Published var isBusy = false

    private let api: VoiceAlarmAPI
    private var pull: RemoteAlarmPullSync?
    private var push: RemoteAlarmPushSync?

    init(api: VoiceAlarmAPI = .shared) {
        self.api = api
    }

    func clearUserScopedRemoteState() {
        remoteAlarms = []
        voiceProfiles = []
        statusMessage = nil
    }

    /// 메인 앱 초기화 시 한 번 주입. 이후 refresh/push 는 새 동기화 컴포넌트를 사용.
    func configure(store: LocalAlarmStore, alarmKit: AlarmKitViewModel, auth: AuthViewModel) {
        if pull == nil {
            pull = RemoteAlarmPullSync(
                api: api,
                store: store,
                alarmKit: alarmKit,
                audioCache: .shared,
                auth: auth
            )
        }
        if push == nil {
            self.push = RemoteAlarmPushSync(api: api, store: store, auth: auth)
        }
    }

    /// 서버에서 알람/음성 프로필 목록을 동기화한다.
    /// configure 가 호출되었다면 `RemoteAlarmPullSync.runOnce` 를 통해
    /// 신규 receivedRemote 자동 스케줄링과 cascade 삭제까지 수행한다.
    func refresh(session: AuthSession?, force: Bool = false) async {
        guard let token = session?.token else { return }
        guard force || !isBusy else { return }
        let shouldManageBusy = !isBusy
        if shouldManageBusy {
            isBusy = true
        }
        defer {
            if shouldManageBusy {
                isBusy = false
            }
        }

        do {
            if let pull {
                try await pull.runOnce()
            }
            async let alarmsTask = api.listAlarms(token: token)
            async let profilesTask = api.listVoiceProfiles(token: token)
            remoteAlarms = try await alarmsTask
            voiceProfiles = try await profilesTask
            statusMessage = "서버 동기화 완료"
        } catch {
            statusMessage = Self.userFacingErrorMessage(error, fallback: "알람 정보를 불러오지 못했어요")
        }
    }

    /// 단일 알람 push (UI 액션 "서버에 저장").
    /// configure 된 경우 일관성을 위해 PushSync 의 한 cycle 을 돌리되, 실패 시
    /// 단건 push 로 폴백한다.
    func push(record: LocalAlarmRecord, store: LocalAlarmStore, session: AuthSession?) async {
        guard let token = session?.token else {
            statusMessage = "로그인이 필요해요."
            return
        }
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }

        do {
            let body = RemoteAlarmMapper.toRemoteRequest(record)
            let remote: RemoteAlarm
            if let remoteID = record.remoteAlarmId {
                remote = try await api.updateAlarm(id: remoteID, requestBody: body, token: token)
            } else {
                remote = try await api.createAlarm(body, token: token)
            }
            let nowMillis = Int64(Date().timeIntervalSince1970 * 1000)
            store.markRemote(
                localID: record.id,
                remoteID: remote.id,
                lastSyncedAtMillis: nowMillis,
                syncState: .synced
            )
            await refresh(session: session, force: true)
        } catch {
            store.markSyncFailed(id: record.id)
            statusMessage = Self.userFacingErrorMessage(error, fallback: "알람 변경사항을 저장하지 못했어요")
        }
    }

    /// 풀 push 사이클 수동 실행. 백그라운드 task 외에 UI 의 "전체 동기화" 같은
    /// 후속 액션에서 호출 가능.
    func runFullSync() async {
        guard let push, let pull else { return }
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }
        do {
            _ = try await push.runOnce()
            try await pull.runOnce()
            statusMessage = "전체 동기화 완료"
        } catch {
            statusMessage = Self.userFacingErrorMessage(
                error,
                fallback: "알람 정보를 불러오거나 변경사항을 저장하지 못했어요"
            )
        }
    }

    /// 단일 원격 알람 삭제 (서버 측). 로컬 cascade 는 AlarmKitViewModel.cancel 이 수행.
    func deleteRemote(record: LocalAlarmRecord, session: AuthSession?) async {
        guard let token = session?.token, let remoteID = record.remoteAlarmId else { return }
        do {
            try await api.deleteAlarm(id: remoteID, token: token)
            await refresh(session: session)
        } catch {
            statusMessage = Self.userFacingErrorMessage(error, fallback: "알람 삭제에 실패했어요")
        }
    }

    static func userFacingErrorMessage(_ error: Error, fallback: String) -> String {
        guard let apiError = error as? APIError else {
            let message = error.localizedDescription
            return message.containsKorean ? message : fallback
        }
        switch apiError {
        case .invalidResponse:
            return fallback
        case .server(_, let message, _):
            return message.containsKorean ? message : fallback
        }
    }
}

