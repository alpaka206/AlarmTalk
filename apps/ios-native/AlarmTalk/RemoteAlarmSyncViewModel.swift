import Foundation
import OSLog

// MARK: - RemoteAlarmSyncViewModel
//
// 내 알람을 서버에 올린다 — `push(record:store:session:)`(단건), `runFullSync()`(일괄),
// `deleteRemote(record:session:)`. 일괄 동기화는 `RemoteAlarmPushSync` 에 위임한다.
// 서버에서 받아 오는 알람은 없다(받은 알람은 커플·가족 이용권과 함께 없앴다).
//
// 의존성 주입:
//   - 메인 앱(`AlarmTalkApp`) 이 `configure(store:auth:)` 를 `task { ... }` 안에서 호출해
//     push 인스턴스를 초기화한다. configure 전 일괄 동기화는 조용히 건너뛴다.
@MainActor
final class RemoteAlarmSyncViewModel: ObservableObject {
    @Published var statusMessage: String?
    @Published private(set) var isBusy = false
    private var busyOperations = 0 {
        didSet { isBusy = busyOperations > 0 }
    }
    private let syncGate = AsyncSerialGate()

    private let api: AlarmTalkAPI
    private weak var auth: AuthViewModel?
    private var store: LocalAlarmStore?
    private var push: RemoteAlarmPushSync?

    init(api: AlarmTalkAPI = .shared) {
        self.api = api
    }

    func clearUserScopedRemoteState() {
        statusMessage = nil
    }

    /// 메인 앱 초기화 시 주입한다. 멱등이다 — 이미 꽂혀 있으면 그대로 둔다.
    func configure(store: LocalAlarmStore, auth: AuthViewModel) {
        self.auth = auth
        if push == nil {
            self.store = store
            self.push = RemoteAlarmPushSync(api: api, store: store, auth: auth)
        }
    }

    /// 단일 알람 push (UI 액션 "서버에 저장").
    /// 응답 커밋은 일괄 push와 같은 스냅샷 비교·디스크 저장 경계를 사용한다.
    func push(record: LocalAlarmRecord, store: LocalAlarmStore, session: AuthSession?) async {
        guard !store.isServerSyncDeferred(id: record.id) else { return }
        guard let requestedOwner = session?.user.id else {
            statusMessage = String(localized: "로그인이 필요해요.")
            return
        }
        guard !isBusy else { return }
        // 전체 동기화가 단건 create의 응답 전에 같은 행을 다시 create하지 않게 한다.
        await syncGate.acquire()
        defer { syncGate.release() }
        guard !Task.isCancelled else { return }
        let currentSession = if let auth { auth.session } else { session }
        guard let currentSession, currentSession.user.id == requestedOwner,
              let record = store.outboundSyncRecord(id: record.id, ownerUserID: requestedOwner) else { return }
        let token = currentSession.token
        busyOperations += 1
        defer { busyOperations -= 1 }

        do {
            let body = RemoteAlarmMapper.toRemoteRequest(record)
            let remote: RemoteAlarm
            if let remoteID = record.remoteAlarmId {
                remote = try await api.updateAlarm(id: remoteID, requestBody: body, token: token)
            } else {
                remote = try await api.createAlarm(body, token: token)
            }
            let nowMillis = Int64(Date().timeIntervalSince1970 * 1000)
            guard store.markRemote(
                snapshot: record,
                remoteID: remote.id,
                lastSyncedAtMillis: nowMillis
            ) else { throw RemoteAlarmPushSync.PushError.localCommitFailed }
            try Task.checkCancellation()
            // ⚠ **성공을 알리지 말 것.** 행이 이미 그 결과를 보여 준다(안드로이드에도 이 문구가 없다).
            statusMessage = nil
        } catch {
            guard !isCancellation(error) else { return }
            store.markSyncFailed(id: record.id)
            statusMessage = userFacingErrorMessage(error, fallback: String(localized: "알람 변경사항을 저장하지 못했어요"))
        }
    }

    /// 일괄 push 사이클. 앱 시작·전경 복귀·알람 탭 진입·동의 직후에 돈다.
    ///
    /// Android `MainViewModel.syncNow` 와 같다. 부분 실패(개별 행 push 실패)만 안내한다.
    /// 사이클 전체가 throw 된 경우(네트워크 단절 등)는 로그만 남긴다(아래 catch 주석).
    ///
    /// - Returns: 회차가 **완결됐는가** — 알람 저장소가 디스크에서 올라왔고, push 가 던지지 않았고,
    ///   행 단위 실패도 없었다. 의존성 전(`configure` 전)·저장소 로드 전·취소·사이클 실패·부분 실패는
    ///   false 다. 알람 탭의 60초 스로틀(`AlarmTabSyncThrottle`)이 이걸 보고 완결되지 않은 회차의
    ///   칸을 지운다 — 그래야 다음 진입이 곧바로 다시 돈다(코덱스 #823 7차).
    /// - Parameter storeLoadTimeout: 저장소 로드를 기다리는 상한(`LocalAlarmStore.waitUntilLoadedFromDisk`).
    @discardableResult
    func runFullSync(storeLoadTimeout: TimeInterval = 3) async -> Bool {
        guard let push, let store else { return false }
        // 표시용 busy 가드에서 버리지 않는다 — 앞 회차의 실패/취소 뒤에도 호출별로 차례를 넘긴다.
        await syncGate.acquire()
        defer { syncGate.release() }
        guard !Task.isCancelled else { return false }
        busyOperations += 1
        defer { busyOperations -= 1 }
        // ⚠ **알람이 디스크에서 올라온 뒤에 올린다**(`BackgroundSyncTask` 와 같다). 로드 전이면 올릴 행이
        //   없어 빈손으로 끝나는데, 그걸 완결로 세면 알람 탭 스로틀이 60초 동안 다시 돌지 않는다.
        await store.waitUntilLoadedFromDisk(timeout: storeLoadTimeout)
        guard !Task.isCancelled else { return false }
        let storeReady = store.hasLoadedFromDisk
        do {
            let pushResult = try await push.runOnce()
            let failedMessage = alarmSyncPartialFailureMessage(pushFailed: pushResult.failed)
            // ⚠ **부분 실패만 알린다 — 성공은 침묵한다.** 이 동기화는 사용자가 누른 게 아니라
            // 화면 진입·전경 복귀에서 자동으로 돈다. 성공은 알람 목록이 이미 보여 준다.
            statusMessage = failedMessage
            return storeReady && failedMessage == nil
        } catch {
            // ⚠ **사이클 전체 실패는 사용자에게 띄우지 않는다 — 로그만 남긴다.**
            // `runFullSync` 는 사용자가 누른 것이 아니라 앱 시작·세션 변경·전경 복귀·
            // 알람 탭 진입에서 **자동으로** 돈다. 그래서 실패 문구를 띄우면 사용자가
            // 한 적 없는 일이 실패했다고 말하는 꼴이고, 다음 진입·주기 sync 가 알아서
            // 재시도한다. 특히 첫 로그인 직후 동의가 정착하기 전 알람 요청이 잠깐
            // `CONSENT_REQUIRED` 로 막히는 게 흔한데, 이건 정상 재시도로 곧 풀린다.
            //
            // 안드로이드가 같은 이유로 이미 이 토스트를 걷어냈다
            // (`MainViewModelAuthActions.kt` 의 `syncNow` onFailure) — iOS 만 남아 있었다.
            // ⚠ **부분 실패(`failedMessage`)는 그대로 띄운다.** 그건 개별 알람이 실제로
            // 안 올라간 것이라 사용자가 알아야 한다.
            // ⚠ 403 이라고 다 강등하지 말 것 — `error_code` 로 CONSENT_REQUIRED 와 탈퇴 유예만 고른다.
            // `CONSENT_STATE_UNAVAILABLE` 같은 실제 파손은 로그에 error 로 남아야 한다(안드로이드도 같은
            // 구분을 한다). 탈퇴 유예(`ACCOUNT_PENDING_DELETION`)는 사용자가 고른 계정 상태라 복구 화면이
            // 이미 말한다(`AlarmTalkLog.isAccountPendingDeletion`).
            let code: String? = if case let APIError.server(_, _, errorCode) = error { errorCode } else { nil }
            if code == AlarmTalkAPI.consentRequiredErrorCode {
                Self.syncLogger.info("자동 동기화 연기: 동의 정착 전이라 다음 회차에 재시도한다")
            } else if AlarmTalkLog.isAccountPendingDeletion(error) {
                Self.syncLogger.info("자동 동기화 중단: 탈퇴 유예 계정이라 철회 전에는 서버가 막는다")
            } else {
                Self.syncLogger.error("자동 동기화 실패: \(String(describing: error), privacy: .public)")
            }
            return false
        }
    }

    private static let syncLogger = Logger(subsystem: "com.alarmtalk.app", category: "AlarmSync")

    /// push 부분 실패 카운트를 사람이 읽는 안내로 변환. 실패가 없으면 nil.
    /// Android `alarmSyncFailureMessage` 와 같은 문구다.
    private func alarmSyncPartialFailureMessage(pushFailed: Int) -> String? {
        guard pushFailed > 0 else { return nil }
        return String(localized: "알람 변경사항 일부를 저장하지 못했어요. 이 기기의 알람은 그대로 울려요.")
    }

    /// 단일 원격 알람 삭제 (서버 측). 로컬 cascade 는 AlarmKitViewModel.cancel 이 수행.
    /// **성공 여부를 돌려준다** — 호출자가 실패를 알릴지 정한다.
    ///
    /// ⚠ **성공 뒤에 목록을 다시 받지 말 것**(2026-08-18 제거). 알람 하나 지우자고
    /// **목록 전체와 TTS 음원**을 다시 받고 있었다 — 삭제를 눌러도 한참 뒤에야 행이
    /// 사라지던 체감 지연의 본체다. 지운 행은 호출자가 이미 로컬에서 없앴다.
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
        guard let remoteID = record.remoteAlarmId else { return true }
        guard let token = session?.token else {
            if announceFailure { statusMessage = String(localized: "로그인이 필요해요.") }
            return false
        }
        do {
            try await api.deleteAlarm(id: remoteID, token: token)
            return true
        } catch {
            guard !isCancellation(error) else { return false }
            // ⚠ **서버에 이미 없으면 성공이다(멱등).** 다른 기기가 먼저 지웠거나 앞선 시도가
            // 실제로는 통했는데 응답만 못 받은 경우다. 실패로 보면 지울 수 없는 알람이 되고,
            // 낙관적 삭제에서는 **행은 사라졌는데 실패 배너만 뜬다.**
            if case let APIError.server(status, _, errorCode) = error,
               status == 404 || errorCode == "ALARM_NOT_FOUND" {
                return true
            }
            if announceFailure {
                statusMessage = userFacingErrorMessage(error, fallback: String(localized: "알람 삭제에 실패했어요"))
            }
            return false
        }
    }

}
