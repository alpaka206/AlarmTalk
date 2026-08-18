import Foundation
import OSLog

// MARK: - RemoteAlarmSyncViewModel
//
// 외부 호출 시그니처 (`refresh(session:)`, `push(record:store:session:)`,
// `deleteRemote(record:session:)`) 는 유지하면서 내부 동기화 로직을
// `RemoteAlarmPullSync` / `RemoteAlarmPushSync` 에 위임한다.
//
// 의존성 주입:
//   - 메인 앱(`AlarmTalkApp`) 이 `configure(store:alarmKit:auth:)` 를
//     `task { ... }` 안에서 한 번 호출해 pull/push 인스턴스를 초기화한다.
//   - configure 가 호출되기 전이라도 기존 fallback (API 직접 호출) 으로 동작한다.
@MainActor
final class RemoteAlarmSyncViewModel: ObservableObject {
    @Published var remoteAlarms: [RemoteAlarm] = []
    @Published var voiceProfiles: [VoiceProfile] = []
    @Published var statusMessage: String?
    @Published var isBusy = false

    private let api: AlarmTalkAPI
    private var pull: RemoteAlarmPullSync?
    private var push: RemoteAlarmPushSync?

    init(api: AlarmTalkAPI = .shared) {
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
    /// 신규 receivedRemote 자동 스케줄링과 **그만받기 정리**까지 수행한다
    /// (서버 목록에서 사라졌다고 지우지는 않는다 — `RemoteAlarmPullSync` 헤더 참조).
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
            // ⚠ **성공을 알리지 말 것.** 이 동기화는 사용자가 누른 게 아니라 화면 진입·
            // 전경 복귀에서 자동으로 돈다. 성공은 알람 목록이 이미 보여 주므로, 여기에
            // 문구를 세우면 사용자가 한 적 없는 일의 결과가 매번 떠 있는다.
            // 안드로이드에는 이 문구가 아예 없다(strings.xml 에 대응 항목 없음).
            statusMessage = nil
        } catch {
            // ⚠ 취소는 표시하지 않는다 — 우리가 스스로 접은 것이다(아래 주석 참조).
            guard !isCancellation(error) else { return }
            statusMessage = userFacingErrorMessage(error, fallback: "알람 정보를 불러오지 못했어요")
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
            guard !isCancellation(error) else { return }
            statusMessage = userFacingErrorMessage(error, fallback: "알람 변경사항을 저장하지 못했어요")
        }
    }

    /// 풀 push 사이클 수동 실행. 백그라운드 task 외에 UI 의 "전체 동기화" 같은
    /// 후속 액션에서 호출 가능.
    ///
    /// Android `MainViewModel.syncNow` 와 동일하게 push → pull 순으로 돌리고,
    /// 부분 실패(개별 행 push/pull 실패)는 push-failed / pull-failed / 둘 다로
    /// 나눠 안내한다. 사이클 전체가 throw 된 경우(네트워크 단절 등)는 기존
    /// generic fallback 으로 폴백한다.
    func runFullSync() async {
        guard let push, let pull else { return }
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }
        do {
            let pushResult = try await push.runOnce()
            let pullResult = try await pull.runOnce()
            let failedMessage = alarmSyncPartialFailureMessage(
                pushFailed: pushResult.failed,
                pullFailed: pullResult.failed
            )
            // 부분 실패만 알린다 — 성공은 위와 같은 이유로 침묵한다.
            statusMessage = failedMessage
        } catch {
            // ⚠ **사이클 전체 실패는 사용자에게 띄우지 않는다 — 로그만 남긴다.**
            // `runFullSync` 는 사용자가 누른 것이 아니라 앱 시작·세션 변경·전경 복귀·
            // 알람 탭 진입에서 **자동으로** 돈다. 그래서 실패 문구를 띄우면 사용자가
            // 한 적 없는 일이 실패했다고 말하는 꼴이고, 다음 진입·주기 sync 가 알아서
            // 재시도한다. 특히 첫 로그인 직후 동의가 정착하기 전 `GET /alarm` 이 잠깐
            // `CONSENT_REQUIRED` 로 막히는 게 흔한데, 이건 정상 재시도로 곧 풀린다.
            //
            // 안드로이드가 같은 이유로 이미 이 토스트를 걷어냈다
            // (`MainViewModelAuthActions.kt` 의 `syncNow` onFailure) — iOS 만 남아 있었다.
            // ⚠ **부분 실패(`failedMessage`)는 그대로 띄운다.** 그건 개별 알람이 실제로
            // 안 올라간 것이라 사용자가 알아야 한다.
            // ⚠ 403 이라고 다 강등하지 말 것 — `error_code` 로 CONSENT_REQUIRED 만 고른다.
            // `CONSENT_STATE_UNAVAILABLE`·`ACCOUNT_PENDING_DELETION` 같은 실제 파손은
            // 로그에 error 로 남아야 한다(안드로이드도 같은 구분을 한다).
            let code: String? = if case let APIError.server(_, _, errorCode) = error { errorCode } else { nil }
            if code == AlarmTalkAPI.consentRequiredErrorCode {
                Self.syncLogger.info("자동 동기화 연기: 동의 정착 전이라 다음 회차에 재시도한다")
            } else {
                Self.syncLogger.error("자동 동기화 실패: \(String(describing: error), privacy: .public)")
            }
        }
    }

    private static let syncLogger = Logger(subsystem: "com.alarmtalk.app", category: "AlarmSync")

    /// push/pull 부분 실패 카운트를 사람이 읽는 안내로 변환. 실패가 없으면 nil.
    /// Android `alarmSyncFailureMessage` (strings.xml msg_sync_*_partial_failed) parity.
    private func alarmSyncPartialFailureMessage(pushFailed: Int, pullFailed: Int) -> String? {
        switch (pushFailed > 0, pullFailed > 0) {
        case (true, true):
            return "알람 변경사항 일부를 저장하지 못했고, 받은 알람 일부를 불러오지 못했어요."
        case (true, false):
            return "알람 변경사항 일부를 저장하지 못했어요. 이 기기의 알람은 그대로 울려요."
        case (false, true):
            return "받은 알람 일부를 불러오지 못했어요. 잠시 후 다시 동기화해 주세요."
        case (false, false):
            return nil
        }
    }

    /// 단일 원격 알람 삭제 (서버 측). 로컬 cascade 는 AlarmKitViewModel.cancel 이 수행.
    ///
    /// ⚠ **받은 알람은 지우는 게 아니라 '그만받기' 다.** `DELETE /alarm/:id` 는 서버가
    /// 소유자만 허용해서 받은 알람에는 404 가 나고, 그러면 그만받기가 기록되지 않아
    /// **다음 pull 이 그 알람을 다시 임포트한다** — 지웠는데 되살아난다.
    /// 서버 쪽 삭제. **성공 여부를 돌려준다** — 호출자가 갈래를 나눠야 하기 때문이다
    /// (받은 알람은 서버 기록이 없으면 로컬에서 지우면 안 된다. `AlarmsListView.deleteAlarm`).
    ///
    /// ⚠ **성공 뒤에 `refresh()` 를 부르지 말 것**(2026-08-18 제거). 알람 하나 지우자고
    /// **목록 전체와 TTS 음원**을 다시 받고 있었다 — 삭제를 눌러도 한참 뒤에야 행이
    /// 사라지던 체감 지연의 본체다. 지운 행은 호출자가 이미 로컬에서 없앴고, 서버 상태는
    /// 다음 정기 동기화가 맞춘다.
    /// - Parameter announceFailure: 실패를 배너로 알릴지. **뒤에서 도는 삭제는 false** —
    ///   행은 이미 사라졌는데 "삭제에 실패했어요" 만 뜨면 사용자는 무엇이 실패했는지 알 수 없다
    ///   (`statusMessage` 는 `AlarmsListView` 가 `actionMessage` 와 **별개로** 배너에 띄운다).
    @discardableResult
    func deleteRemote(
        record: LocalAlarmRecord,
        session: AuthSession?,
        announceFailure: Bool = true
    ) async -> Bool {
        // 서버에 사본이 없는 알람(로컬 전용)은 지울 것이 없으므로 성공으로 본다.
        guard let token = session?.token, let remoteID = record.remoteAlarmId else { return true }
        do {
            if record.originEnum == .receivedRemote {
                try await api.declineAlarm(id: remoteID, token: token)
            } else {
                try await api.deleteAlarm(id: remoteID, token: token)
            }
            return true
        } catch {
            guard !isCancellation(error) else { return false }
            // ⚠ **서버에 이미 없으면 성공이다(멱등).** 발신자가 먼저 지웠거나 앞선 시도가
            // 실제로는 통했는데 응답만 못 받은 경우다. 실패로 보면 지울 수 없는 알람이 되고,
            // 낙관적 삭제에서는 **행은 사라졌는데 실패 배너만 뜬다.**
            // 안드로이드 `MainViewModelAlarmActions.deleteAlarm` 이 decline 404 를 같은 규칙으로 다룬다.
            if case let APIError.server(status, _, errorCode) = error,
               status == 404 || errorCode == "ALARM_NOT_FOUND" {
                return true
            }
            if announceFailure {
                statusMessage = userFacingErrorMessage(error, fallback: "알람 삭제에 실패했어요")
            }
            return false
        }
    }

}

