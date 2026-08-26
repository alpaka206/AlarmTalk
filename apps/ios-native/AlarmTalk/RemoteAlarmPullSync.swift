import Foundation
import os

// MARK: - RemoteAlarmPullSync
//
// Android `RemoteAlarmPullSyncService.kt` 와 동등 기능.
//
// 책임:
//   1. 서버에서 알람 목록을 받아 로컬과 머지한다.
//   2. 신규 receivedRemote 알람은 자동으로 AlarmKit 에 스케줄한다.
//   3. 서버에 남아 있는 알람에 한해 TTS 음원을 캐싱한다.
//   4. **수신자가 그만받기 한** receivedRemote 알람만 로컬에서도 지운다.
//      ⚠ '서버 목록에서 사라졌으니 지운다' 가 **아니다.** 발신자가 지워도 받은 알람은
//      남긴다 — 내가 기대고 자는 알람이 남의 조작으로 사라지면 그날 못 일어난다.
//      판별은 `GET /alarm/declined`(그만받기 기록)로 하고, 그 조회가 실패하면
//      아무것도 지우지 않는다. 자세한 갈래는 `pruneRecipientState` 의 주석에 있다.
//
// 충돌 정책:
//   - 로컬이 dirty 면 서버 응답을 덮어쓰지 않는다 (다음 push 에서 로컬 변경을 반영).
//   - **받은 알람을 수신자가 한 번이라도 고쳤으면 서버 응답을 다시 입히지 않는다**
//     (`locallyEditedByRecipient`). 받은 뒤로는 그 알람이 수신자 것이고, 보낸 사람에게는
//     고칠 수단이 없어 서버 값은 최초 씨앗일 뿐이다 → docs/spec/family-alarm.md 1-1절.
//     받은 알람은 항상 `.synced` 로 파생되므로(`nextLocalSyncState`) dirty 로는 못 지킨다.
//   - 그 외에는 last write wins: lastSyncedAtMillis 가 더 최신인 쪽을 채택한다.
//
// 호출 컨텍스트:
//   - `BackgroundSyncTask` 가 15분 주기로 호출 (pull 먼저, push 뒤)
//   - 로그인 직후 / 포그라운드 진입 시 `RemoteAlarmSyncViewModel.refresh()` 가 호출
//
// Sendable 안전성:
//   - 모든 mutable state 와 메서드가 `@MainActor` 격리되어 외부 race condition 이
//     본질적으로 발생하지 않는다. `BGTaskScheduler.shared.register` 가 요구하는
//     `@Sendable` 클로저 안에서 인스턴스를 capture 해야 하므로 (Swift 6 strict
//     concurrency 대비), `@unchecked Sendable` 로 명시적 인증을 표기한다.
//     실제 transfer 는 MainActor 로 즉시 hop 한 뒤에만 사용된다.
@MainActor
final class RemoteAlarmPullSync: @unchecked Sendable {

    enum PullError: LocalizedError, Equatable {
        case noSession

        var errorDescription: String? {
            switch self {
            case .noSession: return "Pull sync requires an active session."
            }
        }
    }

    /// 한 pull 사이클의 집계. Android `RemoteAlarmPullResult` 와 동일한 카운터를
    /// 가지며, `PushResult` 와 같은 스타일을 따른다.
    ///   - imported: 신규 import (로컬에 없던 receivedRemote 를 새로 저장)
    ///   - updated:  기존 receivedRemote 갱신
    ///   - skipped:  time 등이 유효하지 않아 mapped 가 nil 인 행 (07:00 보정 없이 skip)
    ///   - failed:   단일 알람 머지 실패 또는 음원·OS 예약·전달 버전 미완료
    struct PullResult: Equatable, Sendable {
        var imported: Int
        var updated: Int
        var skipped: Int
        var failed: Int
    }

    /// 단일 remote 알람 머지의 결과 분류. 카운터 집계와 **수신 확인(ack) 판정**에 쓰인다.
    ///
    /// `deliveryComplete` 는 "서버 행을 지워도 되는가" 다 — 로컬 행·음원·켜진 알람의
    /// OS 예약과 전달 버전이 모두 확보됐을 때만 true. 반영하지 않은 회차(`unchanged`)는
    /// 애초에 ack 대상이 아니다.
    private enum MergeOutcome {
        case imported(deliveryComplete: Bool)
        case updated(deliveryComplete: Bool)
        /// 이 전달 세대는 이전 회차에서 이미 음원·예약까지 확보했고 ACK만 재시도하면 된다.
        case alreadyApplied
        /// 구형 전달의 음원 또는 현재 편집본의 OS 예약을 아직 확보하지 못해 재시도가 필요하다.
        case incomplete
        /// 충돌 정책(`shouldApplyRemote == false`)·계정 이탈·울리는 중 등으로 서버 응답을
        /// 적용하지 않음. Android 와 동일하게 imported/updated/failed 어디에도 포함되지 않는다.
        case unchanged

        /// 서버 행을 지워도 되는가. `unchanged` 는 언제나 false 다 — 반영한 것이 없으므로
        /// 서버 행이 다음 회차의 유일한 재시도 근거로 남아야 한다.
        var deliveryComplete: Bool {
            switch self {
            case let .imported(complete), let .updated(complete): return complete
            case .alreadyApplied: return true
            case .incomplete, .unchanged: return false
            }
        }
    }

    /// - Parameter conflictsCleared: 같은 시각 충돌 정리(`clearSameTimeConflicts`)까지
    ///   끝났는가. ⚠ **정리는 전달의 일부다** — 여기서 빼면 취소에 실패한 옛 예약이 살아
    ///   있는데 ACK 가 서버 행을 지워, 다시 시도할 근거 자체가 사라진다.
    static func receivedAlarmDeliveryComplete(
        audioSecured: Bool,
        enabled: Bool,
        scheduleSucceeded: Bool,
        conflictsCleared: Bool,
        deliveryVersion: String?
    ) -> Bool {
        audioSecured
            // ⚠ **정리는 꺼진 알람에도 요구한다**(Codex #703 P1). 서버가 받은 알람을 끄면
            // 새로 걸 것은 없지만 **옛 예약은 지워야 한다** — 그 취소가 실패했는데 그냥
            // ACK 하면 꺼진 행 뒤에 살아 있는 예약이 남고, 서버 행이 없어 다시 시도할
            // 근거도 사라진다. 예약 성공(`scheduleSucceeded`)만 켜진 알람의 조건이다.
            && conflictsCleared
            && (!enabled || scheduleSucceeded)
            && deliveryVersion?.isEmpty == false
    }

    /// 음원 확보를 마친 레코드와 그 성패. `recordWithCachedTTSIfNeeded` 의 반환형이다.
    private struct PreparedRecord {
        let record: LocalAlarmRecord
        /// 음원을 실제로 손에 넣었는가. 받을 음원이 애초에 없는 알람(알람음 전용)도 true.
        let audioSecured: Bool
    }

    private let api: AlarmTalkAPI
    private let store: LocalAlarmStore
    private let alarmKit: AlarmKitViewModel
    private let audioCache: AudioCacheStore
    private let auth: AuthViewModel

    /// 캐싱 실패 등 비정상 경로 기록용. 코드베이스에 공용 로깅 유틸이 없어
    /// os.Logger 를 직접 사용한다 (print 금지 — 콘솔/Instruments 에서 필터 가능).
    private static let logger = Logger(
        subsystem: Bundle.main.bundleIdentifier ?? "AlarmTalk",
        category: "RemoteAlarmPullSync"
    )

    init(
        api: AlarmTalkAPI = .shared,
        store: LocalAlarmStore,
        alarmKit: AlarmKitViewModel,
        audioCache: AudioCacheStore = .shared,
        auth: AuthViewModel
    ) {
        self.api = api
        self.store = store
        self.alarmKit = alarmKit
        self.audioCache = audioCache
        self.auth = auth
    }

    /// **타입 단위** 겹침 가드. push 쪽(`RemoteAlarmPushSync`)과 같은 이유다 —
    /// 인스턴스는 둘(`RemoteAlarmSyncViewModel` / `AlarmTalkApp` 백그라운드)인데
    /// `LocalAlarmStore` 는 하나다.
    ///
    /// pull 쪽 증상은 push 보다 직접적이다: `mergeRemote` 가 기존 행을 찾은 뒤
    /// `recordWithCachedTTSIfNeeded` 에서 **음원을 통째로 내려받고**(수 초) 그 다음에야
    /// upsert 한다. 그 창에서 겹치면 같은 받은-알람이 **로컬에 두 행**으로 들어오고 둘 다
    /// 예약돼 **같은 알람이 두 번 울린다.** 하나를 꺼도 다른 하나가 울린다.
    private static var isRunning = false
    private static var requestedWhileRunning = false

    /// pull 사이클을 수행한다. **동시 호출은 이 함수가 직렬화한다** — 호출자가 막지
    /// 않아도 된다(예전 주석은 "호출자가 동시 호출을 방지해야 한다" 였는데, 실제로는
    /// 아무도 막고 있지 않았다).
    ///
    /// 반환하는 `PullResult` 는 Android `RemoteAlarmPullSyncService.pullReceivedAlarms`
    /// 의 카운터와 동일한 의미를 가진다. `BackgroundSyncTask` 가 retry 판단에 사용한다.
    /// 미뤄 둔 회차가 함께 돌면 카운터는 **합산**된다.
    @discardableResult
    func runOnce() async throws -> PullResult {
        if Self.isRunning {
            Self.requestedWhileRunning = true
            return PullResult(imported: 0, updated: 0, skipped: 0, failed: 0)
        }
        Self.isRunning = true
        defer { Self.isRunning = false }

        var total = PullResult(imported: 0, updated: 0, skipped: 0, failed: 0)
        do {
            repeat {
                Self.requestedWhileRunning = false
                let cycle = try await runCycle()
                total = PullResult(
                    imported: total.imported + cycle.imported,
                    updated: total.updated + cycle.updated,
                    skipped: total.skipped + cycle.skipped,
                    failed: total.failed + cycle.failed
                )
            } while Self.requestedWhileRunning
        } catch {
            // ⚠ **회차가 던져도 회수는 한다**(Codex #703 P1). 이 일은 통째로 로컬이라
            // 네트워크 성패와 무관한데, 실패로 건너뛰면 회수된 목소리를 문 예약이 다음
            // 성공 회차나 전경 복귀까지 살아남는다. `defer` 로는 못 한다(`await` 불가).
            await alarmKit.retryPendingCancellations(store: store)
            throw error
        }
        // ⚠ **못 끊은 예약을 배경에서도 되짚는다**(Codex #703 P1). 전경 sweep
        // (`AlarmTalkApp` 의 `retryPendingCancellations`)는 앱을 열어야 돈다 — 백그라운드
        // pull 로 정리에 실패한 예약은 사용자가 앱을 열기 전에 울 수 있고, 목소리를 회수한
        // 행처럼 **다음 pull 이 다시 집지 못하는** 갈래도 있다.
        // (BGTask 는 push/pull 앞에서 **독립적으로** 한 번 더 돈다 — push 가 먼저 실패하면
        // 이 함수에 들어오지도 못하기 때문이다.)
        await alarmKit.retryPendingCancellations(store: store)
        return total
    }

    /// 한 회차. **세션은 회차마다 다시 읽는다**(안드로이드 `2836ebcf`) — 미뤄 둔 회차가
    /// 앞 회차의 왕복 뒤에 도는데, 그 사이 로그아웃/계정 전환이 있었으면 옛 토큰으로 나간다.
    private func runCycle() async throws -> PullResult {
        guard let session = auth.session else { throw PullError.noSession }
        let userID = session.user.id
        let token = session.token

        let remoteAlarms = try await api.listAlarms(token: token)
        let receivedRemoteAlarms = remoteAlarms.filter {
            Self.isReceivedRemoteCandidate($0, currentUserID: userID)
        }
        let nowMillis = Int64(Date().timeIntervalSince1970 * 1000)

        // 1. 신규/갱신 처리.
        // Android `buildLocalAlarm` 과 동일하게, time 이 유효하지 않은 행(mapped == nil)은
        // 07:00 같은 디폴트로 보정하지 않고 그대로 skip 하고 카운트만 남긴다.
        var imported = 0
        var updated = 0
        var skipped = 0
        var failed = 0
        for remote in receivedRemoteAlarms {
            guard let mapped = RemoteAlarmMapper.toLocalRecord(
                remote,
                currentUserID: userID,
                nowMillis: nowMillis
            ) else {
                skipped += 1
                continue
            }
            // Android 의 per-alarm `runCatching` 와 동일하게, 단일 알람 머지 실패가
            // 사이클 전체를 중단시키지 않도록 격리하고 failed 만 누적한다. (현재 iOS
            // 머지 경로는 throw 하지 않으므로 failed 는 0 이지만, Android 카운터 의미를
            // 보존하고 향후 throwing 작업이 추가돼도 retry 판단이 그대로 동작한다.)
            do {
                let outcome = try await mergeRemote(remote: remote, mapped: mapped, token: token, pullOwnerUserID: userID)
                switch outcome {
                case .imported:
                    imported += 1
                    if !outcome.deliveryComplete { failed += 1 }
                case .updated:
                    updated += 1
                    if !outcome.deliveryComplete { failed += 1 }
                case .alreadyApplied:
                    break
                case .incomplete:
                    failed += 1
                case .unchanged:
                    break
                }
                // ⚠ **다 받았을 때만 서버 행을 지우게 한다**(안드로이드 pull 과 같은 지점).
                //
                // 서버의 알람 행은 전달 수단이면서 동시에 **음원을 받을 권리**다 —
                // `GET /tts/messages/:id/audio` 의 수신자 갈래가 `EXISTS (SELECT 1 FROM alarms
                // WHERE message_id = ? AND target_user_id = 나)` 로 판정한다(routes/tts.ts).
                // 그래서 음원 확보에 실패한 회차나 아예 반영하지 않은 회차(`unchanged`)에
                // ack 하면 그 알람은 **영영 목소리를 못 받는다** — 행이 없으니 다음 pull
                // 목록에도 안 실리고 음원 요청은 404 다.
                //
                // ack 자체의 실패는 삼킨다. 행이 남는 쪽이 안전한 실패다(재전달은 멱등하다).
                if outcome.deliveryComplete, let deliveryVersion = remote.deliveryVersion {
                    // ⚠ **ACK보다 먼저, 디스크까지 쓰고 확인한다.** 네트워크 실패 뒤 사용자가
                    // 편집해도 다음 pull 이 정확히 이 세대만 병합 없이 ACK 를 재시도할 수 있어야
                    // 하는데, 그 판단 근거가 이 값이다. 비동기 저장으로 두면 백그라운드 실행이
                    // 쓰기 전에 끝났을 때 다음 실행이 값을 잃은 채 되살아나고, 그 뒤의 편집이
                    // 병합과 ACK 를 함께 막아 **서버 행과 생성 음원이 영원히 남는다**
                    // (다른 기기가 그걸 또 임포트한다). 안드로이드도 같은 자리에서 Room 쓰기를
                    // 기다린다(`NonCancellable`).
                    guard store.markRemoteDeliveryVersion(
                        remoteID: remote.id,
                        deliveryVersion: deliveryVersion
                    ) else {
                        // 저장을 확인하지 못했으면 ACK 하지 않는다 — 서버 행이 남는 쪽이
                        // 안전한 실패다(재전달은 멱등하고, 다음 pull 이 다시 시도한다).
                        Self.logger.warning(
                            "Pull sync: delivery version not persisted, deferring ACK (id: \(remote.id, privacy: .public))"
                        )
                        continue
                    }
                    try? await AlarmTalkAPI.shared.markAlarmReceived(
                        id: remote.id,
                        deliveryVersion: deliveryVersion,
                        token: token
                    )
                } else {
                    Self.logger.warning(
                        "Pull sync: kept server row (delivery incomplete) for remote alarm (id: \(remote.id, privacy: .public))"
                    )
                }
            } catch is CancellationError {
                // ⚠ **취소는 실패가 아니다 — 회차를 멈춘다**(2026-08-18 Codex #697 P2).
                // 워치독·BGTask 만료가 이 회차를 접는 신호인데 건별 실패로 삼키면,
                // "끝났다" 고 통보한 뒤에도 남은 알람과 수신 상태를 계속 만진다.
                throw CancellationError()
            } catch {
                if Task.isCancelled { throw CancellationError() }
                failed += 1
                Self.logger.error(
                    "Pull sync: failed to merge remote alarm (id: \(remote.id, privacy: .public)): \(error.localizedDescription, privacy: .public)"
                )
            }
        }

        if skipped > 0 {
            Self.logger.warning(
                "Pull sync: skipped \(skipped, privacy: .public) remote alarm(s) with invalid time"
            )
        }

        // 2. 수신자 상태 반영 — 그만받기(삭제) vs 목소리 철회(목소리만 제거).
        //
        // 목록(`GET /alarm`)은 그만받기 한 알람을 빼서 내려주므로 "목록에서 사라짐" 만으로는
        // 이유를 알 수 없다. 서버에 따로 물어 셋을 구분한다(`GET /alarm/declined`).
        // **못 물어보면 아무것도 지우지 않는다** — 네트워크 실패를 이유로 남의 알람을 지우는
        // 쪽으로 기울면 안 된다.
        try await applyRecipientState(
            servedReceivedIDs: Set(receivedRemoteAlarms.map(\.id)),
            allRemoteIDs: Set(remoteAlarms.map(\.id)),
            token: token,
            pullOwnerUserID: userID
        )

        return PullResult(imported: imported, updated: updated, skipped: skipped, failed: failed)
    }

    // MARK: Merge

    /// 단일 remote 알람을 로컬 store 와 머지하고, 집계용 결과를 반환한다.
    @discardableResult
    /// - Parameter pullOwnerUserID: 이 pull 이 **첫 네트워크 호출 전에** 잡아 둔 계정.
    ///   반영 직전에 지금 계정과 대조해, 그 사이에 로그아웃·계정 전환이 끝났으면 물러선다.
    private func mergeRemote(
        remote: RemoteAlarm,
        mapped initialMapped: LocalAlarmRecord,
        token: String,
        pullOwnerUserID: String
    ) async throws -> MergeOutcome {
        var mapped = initialMapped
        var audioSecured = false
        if let existing = store.alarms.first(where: { $0.remoteAlarmId == remote.id }) {
            // ── 1차 거르기(다운로드 전). 통과해도 **확정이 아니다.**
            // ⚠ **재전송은 편집을 보존하지 않는다**(2026-08-26 확정). 다른 세대가 왔다는 것은
            // 발신자가 **다시 보냈다**는 뜻이고, 막으면 그 슬롯이 이후 모든 전달을 영구히
            // 거부한다(실기기 재현). 아래 일반 경로로 내려가 덮어쓴다.
            if Self.locallyEditedByRecipient(existing),
               !Self.isResendOfDifferentDelivery(existing, remote.deliveryVersion) {
                if Self.receivedDeliveryVersionAlreadyApplied(
                    existing: existing,
                    deliveryVersion: remote.deliveryVersion
                ) {
                    return .alreadyApplied
                }
                // ⚠ **적용 세대를 모르는 편집본은 지금 세대로도 마칠 수 있다**(Codex #703 P2).
                // 첫 예약이 실패해 `remoteDeliveryVersion` 이 비어 있는 채 수신자가 그 알람을
                // 고치면, 예전에는 #104 backfill(32자리 hex)만 이 갈래를 통과해 **일반
                // UUID 세대는 영영 ACK 되지 못했다** — 서버 행과 그 생체 음원이 무기한
                // 여기 오는 것은 **같은 전달 세대**다(재전송은 위에서 덮기로 갈렸다).
                // 복구는 #104 backfill(32자리 hex)에만 허용한다 — `isLegacyBackfilledDelivery`.
                guard Self.isRecoverableSameDelivery(existing, remote.deliveryVersion),
                      remote.deliveryVersion?.nilIfBlank != nil else { return .unchanged }
            } else {
                guard Self.shouldApplyRemote(existing: existing, mapped: mapped) else { return .unchanged }
            }
            guard !Self.isInFlight(existing) else { return .unchanged }

            // 여기가 유일한 서스펜션이다 — 음원을 통째로 내려받으므로 수 초가 걸린다.
            let prepared = try await recordWithCachedTTSIfNeeded(mapped, token: token)
            mapped = prepared.record
            audioSecured = prepared.audioSecured
            // 위 신규 import 갈래와 같은 이유 — 떠난 뒤에 반영하면 그 계정 알람을 되살린다.
            guard auth.session?.user.id.nilIfBlank == pullOwnerUserID else { return .unchanged }

            // ⚠ **쓰기 직전에 취소를 다시 본다**(2026-08-18 Codex #697 P2).
            // 취소는 협력적이라 요청이 **성공한 직후**에 올 수 있다 — 그러면 `catch` 에
            // 걸리지 않고 이 아래 반영 구간이 그대로 돈다. 즉 "끝났다" 고 통보한 뒤에
            // 알람을 upsert 하고 재예약한다. 아래 반영 구간이 이 회차의 파괴적 쓰기다.
            try Task.checkCancellation()

            // ── 반영 구간: 위 `existing` 은 **다운로드 전 값**이다. 그걸로 판단·머지하면
            // 그 사이에 사용자가 한 일이 조용히 뒤집힌다. 전부 최신 행에서 다시 가져온다.
            guard let current = store.alarms.first(where: { $0.remoteAlarmId == remote.id }) else {
                // 대기 중 지워졌다 — **되살리지 않는다.** 받아 둔 음성은 주인이 없으니 정리한다.
                if let key = mapped.audioCacheKey?.nilIfBlank, store.countByAudioCacheKey(key) == 0 {
                    try? audioCache.deleteCachedAudio(cacheKey: key)
                }
                Self.logger.info("Pull sync: row deleted during download; skipping (remoteId: \(remote.id, privacy: .public))")
                return .unchanged
            }
            // 대기 중 울리기 시작했거나 스누즈로 넘어갔으면 건드리지 않는다.
            guard !Self.isInFlight(current) else { return .unchanged }
            // 대기 중 로컬 편집이 붙었으면 로컬이 우선한다(그 dirty 를 여기서 처음 본다).
            if Self.locallyEditedByRecipient(current),
               !Self.isResendOfDifferentDelivery(current, remote.deliveryVersion) {
                return await outcomeForEditedDelivery(
                    existing: current,
                    prepared: prepared,
                    deliveryVersion: remote.deliveryVersion
                )
            }
            guard Self.shouldApplyRemote(existing: current, mapped: mapped) else { return .unchanged }

            // ⚠ **재전송이면 수신자 값을 물려받지 않는다**(docs/spec/family-alarm.md).
            // `merge` 는 받은 알람의 시각·꺼짐 같은 수신자 편집을 지켜 주는데, 그대로 두면
            // 새로 보낸 알람이 옛 시각에 **꺼진 채로** 앉는다 — 그 상태로 ACK 되면 서버 행까지
            // 지워져 보낸 알람이 영영 울리지 않는다. 행의 정체(id·예약 핸들)만 잇는다.
            let merged = Self.isResendOfDifferentDelivery(current, remote.deliveryVersion)
                ? Self.rebuiltFromResend(existing: current, mapped: mapped)
                : Self.merge(existing: current, mapped: mapped)
            // `syncedNow` — 서버본을 그대로 쓴 행이므로 '수신자가 손대지 않았다' 로 남긴다.
            // ([locallyEditedByRecipient] 가 두 시각의 등호로 판정한다.)
            store.upsert(merged, syncedNow: true)

            // receivedRemote 라면 일정 변경이 있을 수 있으므로 다시 스케줄.
            let reschedule = merged.enabled
                ? await rescheduleReceivedRemote(record: merged, existing: current)
                : await releaseDisabledReceivedReservation(merged)
            // ⚠ **여기서도 충돌 정리를 돌린다.** 첫 회차의 취소가 실패해 ACK 를 미루면
            // 다음 회차는 이 갈래로 들어온다 — 여기에 없으면 재시도할 곳이 사라진다.
            let conflictsCleared = await clearSameTimeConflicts(
                with: merged,
                remoteID: remote.id,
                pullOwnerUserID: pullOwnerUserID
            )
            return .updated(deliveryComplete: Self.receivedAlarmDeliveryComplete(
                audioSecured: audioSecured,
                enabled: merged.enabled,
                scheduleSucceeded: reschedule.scheduled,
                conflictsCleared: conflictsCleared && reschedule.previousReleased,
                deliveryVersion: remote.deliveryVersion
            ))
        } else {
            let prepared = try await recordWithCachedTTSIfNeeded(mapped, token: token)
            mapped = prepared.record
            audioSecured = prepared.audioSecured
            // 위 신규 import 갈래와 같은 이유 — 떠난 뒤에 반영하면 그 계정 알람을 되살린다.
            guard auth.session?.user.id.nilIfBlank == pullOwnerUserID else { return .unchanged }

            // 위와 같은 이유 — 성공 직후에 온 취소는 `catch` 에 안 걸린다.
            try Task.checkCancellation()

            // 다운로드 사이에 다른 회차가 같은 remote 를 먼저 넣었을 수 있다. 그대로 upsert 하면
            // `RemoteAlarmMapper` 가 매번 새 UUID 를 만들기 때문에 **행이 둘 생기고 둘 다 울린다.**
            if let raced = store.alarms.first(where: { $0.remoteAlarmId == remote.id }) {
                guard !Self.isInFlight(raced) else { return .unchanged }
                if Self.locallyEditedByRecipient(raced) {
                    return await outcomeForEditedDelivery(
                        existing: raced,
                        prepared: prepared,
                        deliveryVersion: remote.deliveryVersion
                    )
                }
                let merged = Self.isResendOfDifferentDelivery(raced, remote.deliveryVersion)
                    ? Self.rebuiltFromResend(existing: raced, mapped: mapped)
                    : Self.merge(existing: raced, mapped: mapped)
                store.upsert(merged, syncedNow: true)
                let reschedule = merged.enabled
                    ? await rescheduleReceivedRemote(record: merged, existing: raced)
                    : await releaseDisabledReceivedReservation(merged)
                // 위 갈래와 같은 이유 — 재시도가 여기로 들어올 수 있다.
                let conflictsCleared = await clearSameTimeConflicts(
                    with: merged,
                    remoteID: remote.id,
                    pullOwnerUserID: pullOwnerUserID
                )
                return .updated(deliveryComplete: Self.receivedAlarmDeliveryComplete(
                    audioSecured: audioSecured,
                    enabled: merged.enabled,
                    scheduleSucceeded: reschedule.scheduled,
                    conflictsCleared: conflictsCleared && reschedule.previousReleased,
                    deliveryVersion: remote.deliveryVersion
                ))
            }

            // ⚠ **음원을 받는 사이에 계정이 떠났으면 심지 않는다**(Codex #699 P1).
            // 이 행은 **아직 없던 행**이라 위 가드(지워졌나·울리는 중인가·수신자가 고쳤나)에
            // 하나도 안 걸린다 — 그대로 심으면 로그아웃 상태에서 **켜진 알람이 새로 생기고
            // 예약까지 걸려**, 알람 화면에 못 들어가는 사용자가 끌 수가 없다.
            // 종료 게이트(`isLeavingAccount`)는 sweep 가 도는 동안만 닫혀 있어 이걸 못 막는다.
            // 안드로이드 짝은 `RemoteAlarmPullSyncService` 의 `pullOwnerUserId` 대조다.
            guard auth.session?.user.id.nilIfBlank == pullOwnerUserID else { return .unchanged }
            // 신규 import.
            store.upsert(mapped, syncedNow: true)

            // ⚠ **받은 알람을 먼저 걸고, 성공한 뒤에 밀어낸다**(Codex #703 P1).
            // 순서를 뒤집으면 예약이 실패했을 때 **그 시각에 아무 예약도 없는 상태**가 된다 —
            // 사용자의 멀쩡한 알람은 이미 꺼졌고 받은 알람은 서지 못했다. 가족 알람은 리드
            // 타임이 5분이라 다음 회차 전에 그 시각이 지나갈 수 있다. 재예약 갈래
            // (`rescheduleReceivedRemote`)가 쓰는 순서와 같게 맞춘다.
            var scheduleSucceeded = true
            if mapped.originEnum == .receivedRemote && mapped.enabled {
                scheduleSucceeded = await alarmKit.schedule(record: mapped, store: store)
            }
            // 밀어내기는 받은 알람이 실제로 선 뒤에만 한다. 못 섰으면 사용자의 알람을
            // 건드리지 않고 물러선다 — 전달은 미완료라 다음 회차가 다시 시도한다.
            let conflictsCleared = scheduleSucceeded
                ? await clearSameTimeConflicts(
                    with: mapped,
                    remoteID: remote.id,
                    pullOwnerUserID: pullOwnerUserID
                )
                : true
            await SocialNotificationTracker.notifyReceivedAlarm(
                alarmID: mapped.id,
                title: RemoteAlarmMapper.resolveLabel(remote),
                time: String(format: "%02d:%02d", mapped.hour, mapped.minute)
            )
            return .imported(deliveryComplete: Self.receivedAlarmDeliveryComplete(
                audioSecured: audioSecured,
                enabled: mapped.enabled,
                scheduleSucceeded: scheduleSucceeded,
                conflictsCleared: conflictsCleared,
                deliveryVersion: remote.deliveryVersion
            ))
        }
    }

    /// existing 의 보존 필드와 mapped 의 서버 권위 필드를 합친다.
    /// Android `RemoteAlarmPullSyncService.buildLocalAlarm` 의 existing 보존 동일.
    ///
    /// `internal` 로 노출해 `@testable import AlarmTalk` 에서 직접 호출 가능하게 한다.
    /// **받은 뒤부터는 받는 사람 것이다.**
    ///
    /// ⚠ 예전 구현은 '무엇을 보존할지 세는' 방식이었고, 그러다 **시각·요일·스누즈 간격·
    /// 스누즈 토글·발화시각**을 빠뜨려 서버 값으로 덮고 있었다. 수신자가 받은 알람을
    /// 07:00 → 06:30 으로 고쳐도 다음 pull 에 07:00 으로 되돌아간다 —
    /// **고쳐 뒀다고 믿고 그 시각에 못 일어난다.**
    ///
    /// 안드로이드는 같은 버그를 네 번 겪고(시각 → 끄기 → 스누즈 상태 → 볼륨·알람음)
    /// 세는 방식을 폐기했다(`2cafd54f`, `850b9032`). 여기서도 방향을 뒤집는다:
    /// **받은 알람은 수신자 것이 기본이고, 서버에서 오는 것만 명시한다.**
    ///
    /// 서버가 권위인 것은 '보낸 사람이 정한 내용' 뿐이다 — 라벨·음성/문구·진동 패턴.
    /// 그것도 **첫 수신 때 한 번**이다. 보낸 사람에게는 그 뒤로 고칠 화면이 없고
    /// (`createFamilyTargetAlarm` 은 만들기 전용), 앱은 알람 업데이트에 수신자를 싣지도
    /// 않는다(`RemoteAlarmMapper` 의 `targetUserId: nil`) — **반영할 발신자 변경 자체가
    /// 생기지 않는다.** 그러니 이 목록이 다시 도는 경우는 사실상 하나뿐이다:
    /// 첫 수신 때 음성 다운로드가 실패해 **아직 안 고친 행**이 남아 있을 때의 재시도.
    ///
    /// ⚠ **그 '씨앗' 조차 수신자가 고친 뒤에는 다시 뿌리지 않는다**(2026-08-18).
    /// 여기 남은 보존 목록은 **수신자가 아직 손대지 않은 행**에만 쓰인다 —
    /// 고친 행은 [locallyEditedByRecipient] 가 `shouldApplyRemote` 에서 통째로 막는다.
    /// 그전에는 이 목록에 없는 값(재생 방식·문구·목소리)이 매 pull 마다 되돌아왔다:
    /// 받은 알람을 '목소리' 로 고쳐도 보낸 사람 행에 message 가 없으면 `mapped` 는
    /// 음성 없는 행이라 **알람음으로 되돌아간다**(2026-08-17 실기기 재현).
    ///
    /// ⚠ `shouldApplyRemote` 의 **dirty 가드만으로는** 받은 알람을 못 지킨다 —
    /// `nextLocalSyncState` 가 받은 알람을 항상 `.synced` 로 되돌리기 때문이다.
    /// 그래서 판정을 시각(`updatedAtMillis` vs `lastSyncedAtMillis`)으로 따로 둔다.
    /**
     * **재전송을 서버본 그대로 앉힌다** — 정체(로컬 id·예약 핸들·생성 시각)만 잇는다.
     *
     * `merge` 와 다른 점: 수신자가 바꿔 둔 시각·요일·스누즈·꺼짐을 **하나도 물려받지 않는다.**
     * 재전송은 새 알람이기 때문이다(`docs/spec/family-alarm.md`).
     */
    static func rebuiltFromResend(existing: LocalAlarmRecord, mapped: LocalAlarmRecord) -> LocalAlarmRecord {
        var next = mapped
        next.id = existing.id
        next.alarmKitID = existing.alarmKitID
        next.createdAtMillis = existing.createdAtMillis
        return next
    }

    static func merge(existing: LocalAlarmRecord, mapped: LocalAlarmRecord) -> LocalAlarmRecord {
        var merged = mapped
        merged.id = existing.id                                  // 로컬 ID 유지
        merged.alarmKitID = existing.alarmKitID                  // 스케줄러 ID 보존
        merged.createdAtMillis = existing.createdAtMillis
        merged.remoteDeliveryVersion = existing.remoteDeliveryVersion

        // ── (1) **서버에 사본이 없는 로컬 전용 값**은 origin 과 무관하게 지킨다.
        // 매퍼는 이 값들을 기본치(100·nil·false 등)로 만들어 내므로, 여기서 잃으면 영영 잃는다.
        //
        // ⚠ **기준은 `RemoteAlarm` 이 그 값을 표현할 수 있는가**다(AlarmTalkAPIModels.swift).
        // 서버가 내려주는 것은 time / repeatDays / isActive / snoozeMinutes / mode /
        // vibrationPattern / wakeMode / voiceProfileId / messageId / messageText /
        // category / messageAudioUrl / sender·target 뿐이다. **그 밖은 전부 로컬 전용이다.**
        // 필드를 새로 추가하면 이 목록에 넣을지 먼저 판단할 것 — 빠뜨리면 pull 이 돌 때마다
        // 조용히 기본값으로 되돌아간다.
        merged.snoozeCount = existing.snoozeCount
        merged.snoozeEnabled = existing.snoozeEnabled
        merged.snoozeRepeatLimit = existing.snoozeRepeatLimit
        merged.voiceRepeat = existing.voiceRepeat
        merged.voiceVolumePercent = existing.voiceVolumePercent
        merged.alarmVolumePercent = existing.alarmVolumePercent
        merged.alarmSoundUri = existing.alarmSoundUri
        merged.alarmSoundLabel = existing.alarmSoundLabel
        merged.defaultAlarmSoundId = existing.defaultAlarmSoundId
        merged.holidayOff = existing.holidayOff
        // ⚠ 아래 셋도 **서버에 사본이 없다**(2026-08-07 추가). 빠져 있던 동안 pull 이 돌
        // 때마다 조용히 nil 이 됐다:
        //  - `preLockPlayMode` — 무료 전환 잠금 전의 재생 방식. 잃으면 재결제해도 목소리
        //    알람이 안 돌아온다.
        //  - `ownerUserId` — 잠금이 다른 계정 알람을 건드리지 않게 막는 가드.
        merged.preLockPlayMode = existing.preLockPlayMode
        merged.ownerUserId = existing.ownerUserId
        // ⚠ `bucketId` 는 위 둘과 **다르다** — 서버에 사본이 있다(`alarms.bucket_id`).
        // 예전 주석은 "서버에 사본이 없다" 고 적고 무조건 로컬 값으로 덮었는데, 그러면
        // **받은 가족 알람의 테마가 영원히 nil** 이다(로컬에 값이 생길 일이 없다).
        // 그래서 로컬 값이 있으면 그것을 지키고(내가 고친 테마가 pull 로 되돌아가면 안 된다),
        // 없을 때만 서버 값을 받는다.
        merged.bucketId = existing.bucketId ?? merged.bucketId

        // 동적 문구(날씨·운세·종류) 설정 일체. 서버는 이 개념을 모른다 —
        // 매퍼가 `voiceRandomPrompt: false` 로 만들어 내므로 지키지 않으면 **pull 한 번에
        // 날씨 알람이 고정 문구 알람으로 바뀐다.** 문구 종류를 잃으면 편집기가 열 때
        // 무엇을 골랐었는지 되짚지 못하고, 날씨 지역을 잃으면 사전렌더 variant 를
        // 고를 수 없다.
        merged.voiceRandomPrompt = existing.voiceRandomPrompt
        merged.voiceRandomContext = existing.voiceRandomContext
        merged.voiceWeatherCountry = existing.voiceWeatherCountry
        merged.voiceWeatherCity = existing.voiceWeatherCity
        merged.voiceFortuneGender = existing.voiceFortuneGender
        merged.voiceFortuneBirthDate = existing.voiceFortuneBirthDate
        merged.voiceFortuneBirthTime = existing.voiceFortuneBirthTime
        merged.voiceLanguage = existing.voiceLanguage
        merged.voiceListenerTitle = existing.voiceListenerTitle
        // "이 발사 시각용 음성은 이미 만들어 뒀다" 표식. 잃으면 다음 갱신 주기에
        // **다시 합성해 이번 달 목소리 생성 한도를 깎는다.**
        merged.dynamicVoicePreparedForFireAtMillis = existing.dynamicVoicePreparedForFireAtMillis

        // 내려받은 음원 경로가 이번 회차에 잡혔으면 그걸 쓰고, 없으면 갖고 있던 것을 지킨다.
        // 무조건 덮으면 로컬 녹음(voiceSource == .localAudio)을 쓰는 알람이 음원을 잃는다.
        merged.localAudioUri = mapped.localAudioUri ?? existing.localAudioUri

        guard existing.originEnum == .receivedRemote else {
            // 내가 보낸 알람은 로컬이 권위다 — 올리는 쪽은 push 다.
            return merged
        }

        // ── (2) 받은 알람은 **일정까지 수신자 것이다.** 세지 않고 전부 로컬에서 가져온다.
        merged.hour = existing.hour
        merged.minute = existing.minute
        merged.repeatDaysMask = existing.repeatDaysMask
        merged.fireAtMillis = existing.fireAtMillis
        // snoozeEnabled 는 (1) 에서 이미 지켰다(서버가 표현하지 못하는 값).
        merged.snoozeMinutes = existing.snoozeMinutes
        // 사용자가 껐으면 그 의도를 존중한다(서버가 켜도 다시 켜지지 않는다).
        merged.enabled = existing.enabled && merged.enabled

        // 스누즈 회차는 **한 묶음으로** 지킨다. 상태만 지키고 마감을 갈아 끼우면
        // '5분 뒤 다시 울림' 이 사라져 다음 정규 회차로 밀린다.
        let keepSnoozeEpisode = merged.enabled && existing.runtimeStateEnum == .snoozed
        if keepSnoozeEpisode {
            merged.state = AlarmRuntimeState.snoozed.rawValue
            merged.fireAtMillis = existing.fireAtMillis
            merged.snoozeCount = existing.snoozeCount
        } else {
            merged.state = merged.enabled
                ? AlarmRuntimeState.armed.rawValue
                : AlarmRuntimeState.disabled.rawValue
        }
        return merged
    }

    /// "이번 사이클의 mapped 가 서버 권위 응답으로서 existing 을 덮어써도 되는가?" 결정.
    /// 정책:
    ///   - existing.syncState == .dirty 이면 false (로컬 변경 우선)
    ///   - 받은 알람을 수신자가 고쳤으면 false ([locallyEditedByRecipient])
    ///   - mapped.lastSyncedAtMillis >= existing.lastSyncedAtMillis 이면 true
    ///   - 그 외 false
    static func shouldApplyRemote(existing: LocalAlarmRecord, mapped: LocalAlarmRecord) -> Bool {
        if existing.syncStateEnum == .dirty { return false }
        if locallyEditedByRecipient(existing) { return false }
        return (mapped.lastSyncedAtMillis ?? 0) >= (existing.lastSyncedAtMillis ?? 0)
    }

    /// 받은 알람을 **수신자가 고쳤는가**. 고쳤으면 서버본을 다시 입히지 않는다
    /// (docs/spec/family-alarm.md — 보낸 사람은 '만든 뒤 고치기: 못 한다',
    /// 받은 사람은 '자기 기기에서 자유롭게').
    ///
    /// 받은 알람은 항상 `.synced` 라(`LocalAlarmStore.nextLocalSyncState`) dirty 플래그로는
    /// 이걸 구분할 수 없다. 대신 시각을 본다 — pull 이 쓴 행은
    /// `updatedAtMillis == lastSyncedAtMillis`(`upsert(_:syncedNow:)`)이고, 수신자가 저장하면
    /// `upsertPreservingServerSyncFields` 가 `lastSyncedAtMillis` 를 보존한 채
    /// `updatedAtMillis` 만 올린다.
    ///
    /// Android `RemoteAlarmPullSyncService.locallyEditedByRecipient` 와 같은 판정이다.
    static func locallyEditedByRecipient(_ existing: LocalAlarmRecord) -> Bool {
        guard existing.originEnum == .receivedRemote else { return false }
        guard let lastSynced = existing.lastSyncedAtMillis else { return true }
        return existing.updatedAtMillis > lastSynced
    }

    /// 로컬에 실제 확보한 세대와 서버 세대가 정확히 같을 때만 편집된 행의 ACK를 재시도한다.
    static func receivedDeliveryVersionAlreadyApplied(
        existing: LocalAlarmRecord,
        deliveryVersion: String?
    ) -> Bool {
        guard existing.originEnum == .receivedRemote,
              let deliveryVersion = deliveryVersion?.nilIfBlank else { return false }
        return existing.remoteDeliveryVersion == deliveryVersion
    }

    /// **이 기기가 어느 세대를 적용했는지 모르는 받은 알람인가.**
    ///
    /// 첫 예약이 실패해 세대를 적지 못한 채 수신자가 그 알람을 고치면 이 상태가 된다.
    /// 그때는 음원을 확보하고 **수신자가 고친 현재 행 그대로** 예약에 성공한 뒤에만
    /// 세대를 적고 ACK 한다 — 형식만 보고 올리지 않는다.
    ///
    /// ⚠ **복구는 #104 backfill(32자리 hex)에만 허용한다**
    /// (`docs/spec/family-alarm.md` 「적용한 전달 버전을 로컬에 남긴다」).
    ///
    /// 여기서 다루는 것은 **재전송이 아닌** 경우다 — 재전송(다른 전달 세대)은
    /// `isResendOfDifferentDelivery` 가 먼저 걸러 **덮어쓰기**로 보낸다. 이 복구는 "#104 가
    /// 옛 전달에 뒤늦게 세대를 찍은" 상황 전용이고, 그때는 편집을 보존한 채 음원만 되살린다.
    ///
    /// ⚠ 이 판정을 "적용 버전이 비어 있는가" 로 넓히지 말 것 — 넓히면 **재전송을 삼킨다**
    /// (옛 내용을 보존한 채 새 세대만 기록하고 ACK·삭제한다).
    /**
     * **발신자가 다시 보낸 것인가**(= 이 행이 받아 둔 전달과 다른 세대인가).
     *
     * 서버는 같은 (발신자·수신자·시각) 슬롯에 **같은 알람 id** 를 재사용하고 새
     * `delivery_version` 만 발급한다. "다른 세대가 왔다" 는 곧 "새로 보냈다" 이고, 그때는
     * 수신자가 그 슬롯을 고쳤든 껐든 **덮어쓴다**(`docs/spec/family-alarm.md`).
     *
     * ⚠ **관찰 세대가 없는 옛 행에는 쓰지 않는다** — '어느 전달을 받았는지 모른다' 가
     * 사실이라 예전 규칙(32자리 backfill 예외)을 그대로 둔다.
     * 안드로이드 짝은 `RemoteAlarmPullSyncService.isResendOfDifferentDelivery`.
     */
    static func isResendOfDifferentDelivery(
        _ existing: LocalAlarmRecord,
        _ deliveryVersion: String?
    ) -> Bool {
        guard let incoming = deliveryVersion, !incoming.isEmpty else { return false }
        if let observed = existing.observedDeliveryVersion, !observed.isEmpty {
            return observed != incoming
        }
        // ⚠ **관찰 세대가 없는 행도 뚫어 준다** — 그러지 않으면 이 필드가 생기기 전에 꼬인
        // 행이 영원히 막힌 채 남는다(2026-08-26 실기기 재현). 단 #104 backfill(32자리 hex)은
        // 예외다 — 그건 새로 보낸 것이 아니라 옛 전달에 뒤늦게 세대를 찍은 것이라, 편집을
        // 보존한 채 음원만 복구하는 기존 경로가 맞다.
        return !(incoming.count == 32 && incoming.allSatisfy { $0.isHexDigit })
    }

    /**
     * **음원·예약을 확보해 ack 만 재시도하면 되는 전달인가.**
     *
     * 두 갈래를 함께 본다(`docs/spec/family-alarm.md`):
     *  1. #104 backfill 세대(`isLegacyBackfilledDelivery`) — 옛 전달에 뒤늦게 세대를 찍은 것.
     *  2. **내가 받았는데 반영에 실패한 그 세대** — 도착 세대는 적혔는데
     *     (`observedDeliveryVersion`) 적용 세대(`remoteDeliveryVersion`)가 비어 있고 서버가
     *     **같은 세대**를 다시 준 경우. 이걸 빼면 첫 반영이 실패한 뒤 수신자가 손댄 알람이
     *     영원히 ack 되지 않는다.
     * 안드로이드 짝은 `RemoteAlarmPullSyncService.isRecoverableSameDelivery`.
     */
    static func isRecoverableSameDelivery(
        _ existing: LocalAlarmRecord,
        _ deliveryVersion: String?
    ) -> Bool {
        if isLegacyBackfilledDelivery(existing, deliveryVersion) { return true }
        guard let incoming = deliveryVersion, !incoming.isEmpty,
              let observed = existing.observedDeliveryVersion, !observed.isEmpty else { return false }
        // ⚠ **적용 세대가 비어 있는 것만 보지 말 것**(Codex #703 P1). 재전송 B 로 다시 지은
        // 행은 도착 세대만 B 로 바뀌고 **적용 세대는 옛 A 가 남는다**. 그 상태에서 B 예약이
        // 실패하고 수신자가 손대면 '비어 있는가' 로는 거절돼 이후 모든 pull 이 영원히 skip 한다.
        return observed == incoming && existing.remoteDeliveryVersion != incoming
    }

    static func isLegacyBackfilledDelivery(
        _ existing: LocalAlarmRecord,
        _ deliveryVersion: String?
    ) -> Bool {
        guard existing.originEnum == .receivedRemote,
              (existing.remoteDeliveryVersion ?? "").isEmpty,
              let version = deliveryVersion, version.count == 32 else { return false }
        // #104 backfill 만 32자리 hex 다. 새 세대(UUID)는 하이픈이 있어 들어오지 않는다.
        return version.allSatisfy { $0.isHexDigit }
    }

    static func linkRecoveredLegacyRemoteAudio(
        existing: LocalAlarmRecord,
        prepared: LocalAlarmRecord
    ) -> LocalAlarmRecord {
        let isFailedImportPlaceholder = existing.playModeEnum == .alarmOnly
            && existing.localAudioUri?.nilIfBlank == nil
            && existing.audioCacheKey?.nilIfBlank == nil
            && existing.ttsMessageId?.nilIfBlank == nil
            && existing.voiceProfileId?.nilIfBlank == nil
            && existing.voiceText?.nilIfBlank == nil
            && existing.voiceCategory?.nilIfBlank == nil
        guard isFailedImportPlaceholder,
              prepared.localAudioUri?.nilIfBlank != nil,
              prepared.audioCacheKey?.nilIfBlank != nil else { return existing }

        var recovered = existing
        recovered.playMode = prepared.playMode
        recovered.localAudioUri = prepared.localAudioUri
        recovered.audioCacheKey = prepared.audioCacheKey
        recovered.rawAudioUri = prepared.rawAudioUri
        recovered.voiceSource = prepared.voiceSource
        recovered.voiceProfileId = prepared.voiceProfileId
        recovered.voiceText = prepared.voiceText
        recovered.voiceCategory = prepared.voiceCategory
        recovered.voiceLanguage = prepared.voiceLanguage
        recovered.ttsMessageId = prepared.ttsMessageId
        recovered.bucketId = prepared.bucketId
        return recovered
    }

    /// Android `RemoteAlarmPullSyncService.pullReceivedAlarms` 의 대상 필터와 같은 의도.
    /// 내가 만든 서버 알람은 push sync 의 결과물이므로 received import 대상으로 삼지 않는다.
    static func isReceivedRemoteCandidate(_ remote: RemoteAlarm, currentUserID: String) -> Bool {
        guard let target = remote.targetUserId?.trimmingCharacters(in: .whitespacesAndNewlines),
              !target.isEmpty,
              target == currentUserID,
              let sender = remote.senderUserId?.trimmingCharacters(in: .whitespacesAndNewlines),
              !sender.isEmpty,
              sender != currentUserID else {
            return false
        }
        return true
    }

    /// 받은 알람을 다시 예약한 결과.
    ///
    /// ⚠ **옛 예약을 푼 것까지 결과에 넣는다**(Codex #703 P1). 예전에는 해제 실패를 버렸는데,
    /// 그러면 **새 예약과 옛 예약이 둘 다 살아 있는 채로 전달 완료**가 되고 ACK 가 서버 행을
    /// 지운다 — 같은 알람이 두 번 울고, 다시 시도할 근거는 사라진 뒤다. 같은 시각 충돌 정리
    /// (`clearSameTimeConflicts`)는 **받은 행 자신을 제외**하므로 이걸 대신 잡아 주지 않는다.
    struct RescheduleOutcome {
        let scheduled: Bool
        /// 옛 예약(`existing.alarmKitID`)까지 확실히 없앴는가.
        let previousReleased: Bool

        /// 예약이 필요 없는 갈래(꺼진 알람) — 남은 일이 없으니 둘 다 참이다.
        static var notNeeded: RescheduleOutcome {
            RescheduleOutcome(scheduled: true, previousReleased: true)
        }
    }

    /// **꺼진 채로 반영된 받은 알람** — 새로 걸 것은 없지만 **옛 예약은 지워야 한다.**
    ///
    /// ⚠ 예전에는 이 갈래가 그냥 "할 일 없음" 이었다. 그런데 받은 알람은 서버가 끌 수 있고
    /// (같은 슬롯에 새 가족 알람이 오면 `claimTargetedAlarmSlot` 이 `is_active = 0` 으로
    /// 내린다 — `docs/spec/family-alarm.md`), 그때 행만 꺼지고 **OS 예약은 그대로 남는다.**
    /// 행이 꺼져 있으니 리컨사일러도 복구 sweep 도 그 행을 건너뛴다 — 목록에는 꺼진 알람이,
    /// 그 시각에는 울리는 알람이 있는 상태가 되고, ACK 뒤에는 서버가 손댈 수도 없다.
    /// (목소리 철회 갈래는 이미 같은 일을 한다 — "꺼진 알람은 새로 걸 것이 없으니 옛것만
    /// 지운다".)
    private func releaseDisabledReceivedReservation(
        _ record: LocalAlarmRecord
    ) async -> RescheduleOutcome {
        guard record.originEnum == .receivedRemote else { return .notNeeded }
        let released = await alarmKit.releaseScheduledAlarm(record: record)
        let owedCleared = await alarmKit.releaseOwedHandles(forAlarmID: record.id, store: store)
        return RescheduleOutcome(scheduled: true, previousReleased: released && owedCleared)
    }

    private func rescheduleReceivedRemote(
        record: LocalAlarmRecord,
        existing: LocalAlarmRecord
    ) async -> RescheduleOutcome {
        // 새 예약을 먼저 성공시킨 뒤 기존 AlarmKit ID 를 해제해 로컬 레코드가
        // 삭제되거나 무예약 상태로 남는 일을 막는다.
        let scheduled = await alarmKit.schedule(record: record, store: store)
        guard scheduled else { return RescheduleOutcome(scheduled: false, previousReleased: true) }
        guard let previousHandle = existing.alarmKitID else {
            return RescheduleOutcome(
                scheduled: true,
                previousReleased: await alarmKit.releaseOwedHandles(forAlarmID: record.id, store: store)
            )
        }
        // 새 핸들이 실제로 행에 새겨졌을 때만 옛것을 푼다(`AlarmScheduleReconciler` 와 같은
        // 안전판). 값이 그대로면 그 사이 다른 경로가 개입한 것이고, 지금 그 예약이 유일한
        // 예약이라 끊으면 무예약이 된다.
        guard store.record(id: record.id)?.alarmKitID != previousHandle else {
            return RescheduleOutcome(
                scheduled: true,
                previousReleased: await alarmKit.releaseOwedHandles(forAlarmID: record.id, store: store)
            )
        }
        // 받은 행은 켜진 채로 다시 예약된 것이라 출처는 기본값(행을 건드리지 않는 쪽)이 맞다.
        let released = await alarmKit.releaseScheduledAlarm(record: existing)
        // ⚠ **이 행이 예전에 남긴 고아도 함께 본다**(Codex #703 P1). 위 해제는 **직전**
        // 손잡이 하나만 본다 — 지난 회차의 해제가 실패했다면 그 손잡이는 이미 행에서
        // 밀려나(재예약이 새 UUID 를 새긴다) **어디서도 참조되지 않는다.** 그러면 다음
        // 회차는 "끊을 게 없다" 고 답하고 ACK 가 서버 행을 지운다 — 그 예약은 행 없이 울어
        // 목록에 보이지도, 끌 수도 없다. 손잡이가 아니라 **주인 행 id** 로 되짚는다.
        let owedCleared = await alarmKit.releaseOwedHandles(forAlarmID: record.id, store: store)
        return RescheduleOutcome(scheduled: true, previousReleased: released && owedCleared)
    }

    /// **받은 알람과 같은 시각에 선 이 수신자의 알람을 끄고, 그 예약을 푼다.**
    /// 안드로이드 pull(`getEnabledAtTime` → `enabled=false`)과 같은 규칙이다.
    ///
    /// 두 예약이 같은 분에 함께 서면 서로의 울림을 끊는다. 받은 알람은 ACK 뒤 서버 행이
    /// 사라져 서버 쪽 슬롯 정리(`claimTargetedAlarmSlot`)도 손댈 수 없으니 여기서 끝낸다.
    /// **지우지는 않는다** — 목록에 남겨 언제든 다시 켤 수 있게 한다. 대상은 '이 수신자의'
    /// 알람만이다 — 같은 기기에 남은 앞 계정 알람을 끄면 그 계정은 영영 모른 채 안 울린다.
    ///
    /// ⚠ **취소 실패를 삼키지 않는다**(Codex #703 P1). 행만 꺼지고 OS 예약이 살아 있는데
    /// 그대로 ACK 하면 서버 행이 사라져 **다시 시도할 근거 자체가 없어진다.**
    /// 회수 목록(`PendingAlarmCancellationStore`)에 남기는 하지만 그 sweep 는 **전경 복귀와
    /// 콜드 스타트에서만** 돈다(`AlarmTalkApp` 의 `retryPendingCancellations`) — 백그라운드
    /// pull 로 받은 알람이 사용자가 앱을 열기 전에 울리면 **옛 예약과 새 알람이 같이 운다.**
    ///
    /// ⚠ **재시도 회차는 이미 꺼 둔 행도 봐야 한다.** 첫 회차가 행을 끄는 데는 성공했으니
    /// `enabled` 만 보면 다음 회차에서 대상이 아니게 되고, 정리가 끝났다고 오인해 그대로
    /// ACK 한다. 못 푼 예약이 있는지는 행이 아니라 **회수 목록의 UUID** 로 판정한다
    /// (`PendingAlarmCancellationStore` 주석의 그 이유와 같다 — 행 상태로는 못 센다).
    ///
    /// - Returns: 정리를 끝냈는가. 하나라도 취소가 실패하면 `false` — 전달 미완료로 남아
    ///   서버 행이 보존되고 다음 회차가 다시 시도한다.
    private func clearSameTimeConflicts(
        with received: LocalAlarmRecord,
        remoteID: String,
        pullOwnerUserID: String
    ) async -> Bool {
        guard received.originEnum == .receivedRemote, received.enabled else { return true }
        let owedCancellations = Set(PendingAlarmCancellationStore.all)
        // 그 행이 아직 못 끊은 예약이 있는가 — **지금 손잡이든 이미 밀려난 옛 손잡이든.**
        // 주인 행 기록이 먼저이고, 주인을 안 적던 시절의 기록만 손잡이로 되짚는다.
        func owesCleanup(_ row: LocalAlarmRecord) -> Bool {
            if !PendingAlarmCancellationStore.owedHandles(forAlarmID: row.id).isEmpty { return true }
            return row.alarmKitID.map { owedCancellations.contains($0) } ?? false
        }
        var cleared = true
        for conflicting in store.conflictingAlarms(
            hour: received.hour,
            minute: received.minute,
            excludingID: received.id,
            ownerUserId: pullOwnerUserID
        ) where conflicting.remoteAlarmId != remoteID {
            // ⚠ **주인 행으로 판정한다 — 지금 손잡이로는 부족하다**(Codex #703 P1).
            // 한 행이 여러 번 밀리면 고아가 둘 이상 쌓이는데, 그중 **지금 손잡이만** 끊긴
            // 회차가 오면 남은 옛 고아는 `all` 대조에 걸리지 않는다 — 정리가 끝났다고
            // 답해 ACK 가 나가고, 그 예약은 행 없이 운다.
            let owesCancellation = owesCleanup(conflicting)
            guard conflicting.enabled || owesCancellation else { continue }
            if conflicting.enabled {
                var disabled = conflicting
                disabled.enabled = false
                _ = store.upsertPreservingServerSyncFields(disabled)
            }
            // ⚠ **`releaseScheduledAlarm` 이어야 한다.** OS 에 이미 없는 예약(한 번 울고
            // 사라진 1회성 등)에 `cancel` 은 throw 하는데, 그걸 실패로 세면 끊을 것이 없는
            // 알람 때문에 **ACK 가 영구히 미뤄진다**. 성공한 UUID 를 회수 목록에서 지우는
            // 것도 그쪽이 한다 — 안 지우면 위 `owesCancellation` 이 같은 UUID 를 영원히
            // 다시 집는다.
            // ⚠ **출처는 `.conflictDisplacement`**(기본값 아님). 취소가 실패한 채 그 예약이
            // 울면 `markRinging` 이 행을 도로 켜는데, 기본값(`.foreignCleanup`)이면 회수가
            // 손잡이만 지우고 끝내 **밀어낸 알람이 되살아난다.**
            if await alarmKit.releaseScheduledAlarm(
                record: conflicting,
                cancellationOrigin: .conflictDisplacement
            ) == false {
                cleared = false
            }
            // 밀어낸 행도 예전 회차의 고아를 남겼을 수 있다(사용자가 다시 켜서 재예약된 뒤
            // 또 밀린 경우). 위 `owesCancellation` 은 **지금 손잡이**만 보므로 여기서 한 번 더.
            if await alarmKit.releaseOwedHandles(forAlarmID: conflicting.id, store: store) == false {
                cleared = false
            }
        }
        return cleared
    }

    /// #104 이전에 이미 편집된 행은 서버본으로 다시 만들지 않는다. 서버 음원을 캐시한 뒤
    /// 수신자가 고친 현재 행 그대로 예약까지 성공해야만 이 backfill 세대를 ACK할 수 있다.
    private func outcomeForEditedDelivery(
        existing: LocalAlarmRecord,
        prepared: PreparedRecord,
        deliveryVersion: String?
    ) async -> MergeOutcome {
        if Self.receivedDeliveryVersionAlreadyApplied(
            existing: existing,
            deliveryVersion: deliveryVersion
        ) {
            return .alreadyApplied
        }
        // 진입 판정과 **같은 기준**이어야 한다 — 위에서 통과시킨 회차를 여기서 되돌리면
        // 음원만 받아 두고 아무것도 못 하는 회차가 된다.
        guard Self.isRecoverableSameDelivery(existing, deliveryVersion),
              deliveryVersion?.nilIfBlank != nil else { return .unchanged }
        guard prepared.audioSecured else { return .incomplete }

        var recovered = Self.linkRecoveredLegacyRemoteAudio(
            existing: existing,
            prepared: prepared.record
        )
        if recovered.localAudioUri != existing.localAudioUri
            || recovered.audioCacheKey != existing.audioCacheKey {
            recovered = store.upsert(recovered)
        }
        // ⚠ **못 붙인 음원은 여기서 정리한다**(Codex #703 P2, 안드로이드와 같은 처리).
        // 수신자가 이미 자기 음원을 연결해 둔 행은 복구가 **일부러 그대로 두는데**
        // (`linkRecoveredLegacyRemoteAudio` 가 `existing` 을 그대로 돌려준다), 그 직전에
        // 내려받은 발신자 음원은 어느 행도 가리키지 않은 채 남는다 — ACK 로 서버 행까지
        // 사라지면 30일 낡은 캐시 정리까지 **남의 생체 음원이 디스크에** 있다.
        if let key = prepared.record.audioCacheKey?.nilIfBlank,
           store.countByAudioCacheKey(key) == 0 {
            try? audioCache.deleteCachedAudio(cacheKey: key)
        }
        let reschedule = recovered.enabled
            ? await rescheduleReceivedRemote(record: recovered, existing: existing)
            : await releaseDisabledReceivedReservation(recovered)
        return Self.receivedAlarmDeliveryComplete(
            audioSecured: true,
            enabled: recovered.enabled,
            scheduleSucceeded: reschedule.scheduled,
            // 수신자가 이미 고친 행이다 — 시각은 **그 사람이 정한 것**이라 같은 시각의
            // 다른 알람을 우리가 끌 근거가 없다. 남는 것은 이 행 자신의 옛 예약뿐이다.
            conflictsCleared: reschedule.previousReleased,
            deliveryVersion: deliveryVersion
        ) ? .alreadyApplied : .incomplete
    }

    // MARK: Cascade delete

    /// 로컬에 receivedRemote 로 들고 있으나 서버 응답에 사라진 알람을 정리.
    /// AlarmKit 도 함께 해제한다.
    /// 받은 알람의 수신자 상태를 반영한다. Android `RemoteAlarmPullSyncService` 와 1:1.
    ///
    /// - Parameter servedReceivedIDs: 이번 pull 에서 **받은 알람으로** 내려온 remote id 들.
    /// - Parameter allRemoteIDs: `GET /alarm` 이 내려준 **전체** remote id 들(내가 보낸 것 포함).
    /// - Parameter pullOwnerUserID: 이 pull 이 첫 네트워크 호출 전에 잡아 둔 계정.
    ///   이 단계도 서버를 한 번 더 다녀오므로, 그 사이에 계정이 떠났으면 **아무것도 반영하지
    ///   않는다**(Codex #699 P1) — 반영하면 떠난 계정의 행이 지금 쓰는 사람 아래에 숨어 운다.
    private func applyRecipientState(
        servedReceivedIDs: Set<String>,
        allRemoteIDs: Set<String>,
        token: String,
        pullOwnerUserID: String
    ) async throws {
        guard let state = try await fetchRecipientState(token: token) else {
            // 못 물어봤다 — 아무것도 건드리지 않는다.
            Self.logger.warning("Pull sync: /alarm/declined unavailable; skipping recipient-state pruning")
            return
        }
        // ⚠ **쓰기 직전에 취소를 다시 본다.** 마지막 페이지가 **성공한 직후** 취소가 오면
        // 위 `catch` 는 지나가고, 아래 loop 가 목소리를 벗기고 받은 알람을 지운다 —
        // BGTask 가 이미 실패로 완료를 통보한 뒤에(2026-08-18 Codex #697 P2).
        try Task.checkCancellation()
        // ⚠ **계정이 떠났으면 여기서도 멈춘다**(Codex #699 P1). 위 `/alarm/declined` 왕복
        // 사이에 로그아웃·계정 전환이 끝날 수 있는데, 그대로 반영하면 **떠난 계정의 행이
        // 지금 쓰는 사람 아래에 숨어** 남는다(목록에는 안 보이는데 예약은 살아 있다).
        guard auth.session?.user.id.nilIfBlank == pullOwnerUserID else { return }

        let received = store.recordsBy(origin: .receivedRemote)

        // (1) 목소리 철회 — **목소리만 걷어내고 알람은 남긴다.**
        //
        // 복제 목소리는 발신자의 생체정보라 파기 대상이지만, 시각·요일은 수신자가 기대고
        // 자는 자기 정보다. 통째로 지우면 그날 못 일어난다.
        //
        // 대상은 `hasSenderVoice` — '목소리가 있는 행' 이 아니라 '발신자 음성을 든 행' 이다.
        // 서버는 철회 기록을 영구히 들고 있어서, 넓게 잡으면 수신자가 나중에 넣은 자기
        // 목소리까지 매번 걷어낸다.
        for staleRecord in received {
            // ⚠ **회차마다 다시 본다.** 이 루프 안에는 서스펜션(재예약)이 있고,
            // `alarmKit.schedule` 은 취소를 삼켜 `false` 만 돌려준다 — 그래서 루프 앞
            // 확인 하나로는 뒤쪽 알람들이 계속 고쳐진다(2026-08-18 Codex #697 P2).
            try Task.checkCancellation()
            // ⚠ **계정도 회차마다 본다**(Codex #699 P1). 앞 회차의 재예약이 멈춘 사이에
            // 로그아웃·계정 전환이 끝나면, 남은 회차가 **떠난 계정의 행을 고치고 예약까지
            // 건다** — 지금 쓰는 사람에겐 안 보이는데 울린다.
            guard auth.session?.user.id.nilIfBlank == pullOwnerUserID else { return }
            guard let remoteID = staleRecord.remoteAlarmId,
                  state.revoked.contains(remoteID) else { continue }
            // ⚠ `received` 는 루프 **시작 전** 스냅샷이다. 아래에 await 가 있어 앞 회차가
            // 도는 동안 사용자가 이 행을 편집했을 수 있다 — 스냅샷으로 upsert 하면 그 편집을
            // 조용히 되돌린다. 반영 직전에 최신 행을 다시 읽는다(mergeRemote 와 같은 순서).
            guard let record = store.alarms.first(where: { $0.remoteAlarmId == remoteID }) else { continue }
            guard Self.hasSenderVoice(record) else { continue }
            // 지금 울리는 중이거나 스누즈 회차 중이면 건드리지 않는다 — 취소·재예약이
            // 그 회차를 끊는다. 다음 사이클에 다시 본다(서버는 철회 기록을 계속 들고 있다).
            guard !Self.isInFlight(record) else { continue }
            let releasedKey = record.audioCacheKey
            let revoked = Self.withVoiceRevoked(record)
            _ = store.upsert(revoked)
            // 먼저 upsert 해 이 행의 참조를 지운 뒤 센다 — 같은 캐시를 여러 행이 쓰고 있어도
            // 마지막 행에서 0 이 되어 파일이 실제로 지워진다.
            if let key = releasedKey?.nilIfBlank, store.countByAudioCacheKey(key) == 0 {
                try? AudioCacheStore.shared.deleteCachedAudio(cacheKey: key)
                // ⚠ 캐시 파일만 지우면 부족하다. 예약할 때 `AlarmSoundStaging` 이
                // `Library/Sounds/` 로 **사본**을 떠 두는데, 그건 별도 파일이라 그대로 남는다.
                // 파기 대상인 생체정보(복제 음성)를 디스크에 남기면 안 된다.
                AlarmSoundStaging.clearStagedSound(forKey: key)
            }
            // ⚠ **로컬 행만 고치면 알람은 여전히 그 목소리로 운다.**
            // 안드로이드는 RingingService 가 울릴 때 DB 를 다시 읽어서 행만 고쳐도 됐지만,
            // iOS 는 발사 시점에 우리 코드가 돌지 않는다 — 이미 AlarmKit 에 넘긴 사운드가
            // 그대로 울린다(PaidVoiceGate 주석과 같은 이유). 반복 알람은 재예약 계기도
            // 없어 사실상 무기한이다. 그래서 **다시 깔아 준다.**
            // ⚠ **새로 걸고 나서 옛것을 지운다 — 순서를 뒤집지 말 것**(2026-08-18
            // Codex #697 P1). 예전에는 옛 예약을 먼저 취소했는데, 그 사이에 사이클이
            // 취소되면 새 예약도 서지 않아 **켜져 있는데 아무 예약도 없는 알람**이 남는다.
            // 반복 알람은 재예약 계기도 없어 사실상 무기한이다 — 알람 앱에서 가장 나쁜
            // 결말이다. 저장소의 다른 재예약 경로(`applyFreePlanVoiceLock`·
            // `restorePaidVoiceAlarms`)가 쓰는 순서와 같게 맞춘다.
            // ⚠ **여기 취소 실패는 다음 pull 이 다시 집지 못한다**(Codex #703 P1).
            // 행은 이미 톤으로 내려가 `hasSenderVoice` 가 false 라 이 갈래에 다시 오지
            // 않는다 — 전경 sweep 만이 유일한 회수 경로가 되어, 사용자가 앱을 열기 전에
            // 그 예약이 **회수된 생체 목소리로 운다.** 그래서 이미 없는 예약을 성공으로
            // 세는 `releaseScheduledAlarm` 을 쓰고, 그 행이 남긴 고아까지 함께 되짚는다.
            let previouslyScheduled = record
            if revoked.enabled {
                if await alarmKit.schedule(record: revoked, store: store) {
                    if previouslyScheduled.alarmKitID != nil {
                        await alarmKit.releaseScheduledAlarm(record: previouslyScheduled)
                    }
                    await alarmKit.releaseOwedHandles(forAlarmID: revoked.id, store: store)
                } else {
                    // ⚠ **여기서 멈추지 않는다 — 하지만 잊히지도 않는다.** 행은 이미 톤으로
                    // 내려갔고 `hasSenderVoice` 가 false 라 pull 은 다시 집지 않는다. 대신
                    // 구워 둔 지문(`scheduledSoundFingerprint`)과 예약 핸들이 그대로 남아
                    // `AlarmScheduleReconciler.needsReschedule` 이 다음 회차(앱 시작·전경
                    // 복귀·백그라운드 동기화)에서 이 행을 집어 다시 건다.
                    //
                    // ⚠ **지문이 없던 시절의 행은 그 그물에 걸리지 않는다**(Codex #703 P1).
                    // `needsReschedule` 은 `scheduledSoundFingerprint` 가 nil 이면 **일부러**
                    // false 를 돌려준다(옛 행을 전부 재예약하지 않으려는 가드). 그런데 이 행은
                    // pull 도 다시 집지 않고, 핸들을 든 채 `.armed` 라 `recoverScheduledAlarms`
                    // 후보도 아니다 — 폴백이 하나도 없어 **회수된 발신자 목소리를 문 옛 예약이
                    // 무기한 울 수 있다.** 그 경우만 회수 목록에 명시적으로 남긴다.
                    //
                    // 출처는 `.foreignCleanup` 이어야 한다 — `.accountLeave` 계열은
                    // `applyResolvedCancellations` 가 **행까지 끈다**(받은 알람이 이유 없이
                    // 꺼진다). 끊고 나면 `enabled && alarmKitID == nil` 이 되어 같은 회차의
                    // `recoverScheduledAlarms` 가 **톤으로 다시 건다.**
                    if previouslyScheduled.scheduledSoundFingerprint == nil,
                       let staleHandle = previouslyScheduled.alarmKitID {
                        PendingAlarmCancellationStore.add(
                            staleHandle,
                            origin: .foreignCleanup,
                            alarmID: revoked.id
                        )
                    }
                    Self.logger.warning(
                        "Pull sync: revoked reschedule failed, leaving it to the reconciler (remoteId: \(remoteID, privacy: .public))"
                    )
                }
            } else {
                // 꺼진 알람은 새로 걸 것이 없으니 옛것만 지운다.
                await alarmKit.releaseScheduledAlarm(record: previouslyScheduled)
                await alarmKit.releaseOwedHandles(forAlarmID: revoked.id, store: store)
            }
            Self.logger.info("Pull sync: revoked sender voice on received alarm (remoteId: \(remoteID, privacy: .public))")
            // ⚠ **여기는 백그라운드다.** 목소리만 걷어내고 말면 사용자는 왜 알람이
            // 기본 알람음이 됐는지 알 길이 없다 — 대기표에 적어 두면 다음에 앱을 열 때
            // 모달이 알려 준다(안드로이드 `VoiceAccessSyncWorker` 와 같은 처리).
            DowngradeNoticeStore().record(
                userID: auth.session?.user.id,
                cause: .sharedReleased,
                count: 1
            )
        }

        // (2) 그만받기 — 알람을 지운다.
        //
        // 서버 목록에서 빠지는 이유는 셋이고 **하나만 남겨야 한다**:
        //  (a) 수신자가 그만받기      → 지운다(이 계정의 다른 기기에서도 지워져야 한다)
        //  (b) 옛 네임스페이스 버그로 **내가 보낸 알람**을 받은 것으로 잘못 임포트한 잔재
        //      → 지운다. 그 행의 remote id 는 전체 목록에는 있는데 '받은 것' 에는 없다.
        //      생성자는 자기 알람을 decline 할 수 없어 (a) 만 두면 이 잔재가 영영 남아
        //      진짜 알람과 함께 울린다.
        //  (c) 발신자가 삭제          → **남긴다.** 받은 뒤부터는 받는 사람 것이라,
        //      내가 기대고 자는 알람이 남의 조작으로 사라지면 안 된다.
        for staleRecord in store.recordsBy(origin: .receivedRemote) {
            // 위 루프와 같은 이유 — 이 루프에도 취소·삭제 서스펜션이 있다.
            guard auth.session?.user.id.nilIfBlank == pullOwnerUserID else { return }
            // ⚠ 위 루프와 같은 이유 — 이 루프의 `alarmKit.cancel` 도 서스펜션이다.
            // 여기서 멈추지 않으면 **취소 뒤에도 받은 알람이 계속 지워진다.**
            try Task.checkCancellation()
            guard let remoteID = staleRecord.remoteAlarmId,
                  !servedReceivedIDs.contains(remoteID),
                  state.declined.contains(remoteID) || allRemoteIDs.contains(remoteID)
            else { continue }
            // 여기도 최신 행을 다시 읽는다. 앞 회차의 await 동안 사용자가 이 알람을 편집해
            // 재예약됐으면 `alarmKitID` 가 바뀌어 있는데, 스냅샷의 옛 id 로 취소하면
            // **새 예약이 남은 채 행만 지워져** 주인 없는 알람이 울린다.
            guard let record = store.alarms.first(where: { $0.remoteAlarmId == remoteID }) else { continue }
            await alarmKit.cancel(record: record, store: store)
            Self.logger.info("Pull sync: pruned received alarm (remoteId: \(remoteID, privacy: .public))")
        }
    }

    /// `GET /alarm/declined` 를 **끝까지** 받아 온다. 한 페이지만 보고 지우면 뒤 페이지에
    /// 있는 그만받기 알람이 계속 울린다. 실패하면 nil — 호출자가 아무것도 안 한다.
    private func fetchRecipientState(token: String) async throws -> (declined: Set<String>, revoked: Set<String>)? {
        var declined = Set<String>()
        var revoked = Set<String>()
        var offset = 0
        // 서버가 limit 을 100 으로 클램프한다. 무한 루프 방지용 상한도 둔다.
        for _ in 0..<100 {
            do {
                let page = try await api.declinedAlarms(limit: 100, offset: offset, token: token)
                declined.formUnion(page.alarmIds)
                revoked.formUnion(page.revokedAlarmIds)
                let rows = page.alarmIds.count + page.revokedAlarmIds.count
                if !page.hasMore || rows == 0 { return (declined, revoked) }
                // 서버는 한 페이지에 **두 종류를 섞어** 보낸다. 합만큼 전진해야 오프셋이
                // 어긋나지 않는다(한쪽 크기로 전진하면 같은 행을 다시 읽거나 건너뛴다).
                offset += rows
            } catch {
                // ⚠ **취소와 조회 실패를 가른다**(2026-08-18 Codex #697 P2).
                // 예전에는 둘 다 `nil`(모른다)로 뭉갰다. `nil` 은 "부분 결과로 판단하지
                // 않는다" 는 뜻으로는 맞지만 **회차를 멈추지는 못해서**, 취소된 뒤에도
                // 호출부가 예약 재조정·복구까지 마저 돌았다.
                if error is CancellationError || Task.isCancelled { throw CancellationError() }
                // 진짜 조회 실패는 그대로 '모른다' — 부분 결과로 판단하면 받은 알람을
                // 잘못 지운다.
                return nil
            }
        }
        return (declined, revoked)
    }

    /// 지금 pull 이 **건드리면 안 되는** 행 — 울리는 중이거나 스누즈 회차가 살아 있다.
    ///
    /// 안드로이드는 `RingingService` 가 울리는 알람 집합을 런타임으로 들고 있지만 iOS 에는
    /// 그런 게 없어 저장된 `state` 로 판단한다.
    ///
    /// `.snoozed` 를 포함하는 이유는 안드로이드와 다르다: iOS 재예약(`makeSchedule`)은
    /// `.relative(hour:minute)` 라 `fireAtMillis` 를 읽지 않는다. 상태를 이어받아도
    /// AlarmKit countdown 이 취소돼 '5분 뒤' 가 사라지므로, **회차 자체를 건드리지 않는다.**
    ///
    /// ⚠ 이 판정을 `recoverScheduledAlarms` 로 옮기지 말 것 — 거기서 배제 조건으로 쓰면
    /// 상태가 굳은 행이 영구 제외된다.
    static func isInFlight(_ record: LocalAlarmRecord) -> Bool {
        record.runtimeStateEnum == .ringing || record.runtimeStateEnum == .snoozed
    }

    /// 이 행이 **발신자가 준 음성**을 들고 있는가.
    ///
    /// 받은 알람의 캐시 키는 `remote-message-<id>` 로 만들어진다(`RemoteAlarmMapper`).
    /// 키 없이 파일 경로만 든 옛 행도 포함한다 — 지금 코드로는 안 만들어지지만, 그렇다고
    /// 단정하고 생체정보를 남겨 둘 수는 없다. 수신자가 고른 음성은 항상 키가 있으므로
    /// 오탐이 되지 않는다.
    static func hasSenderVoice(_ record: LocalAlarmRecord) -> Bool {
        if let key = record.audioCacheKey?.nilIfBlank {
            return key.hasPrefix("remote-message-")
        }
        return record.localAudioUri?.nilIfBlank != nil
    }

    /// 발신자가 탈퇴해 목소리가 철회된 받은 알람 — 목소리만 걷어내고 알람은 남긴다.
    /// 보낸 사람 이름이 든 라벨도 파기 대상이라 기본 라벨로 되돌린다.
    /// 알람음만 남긴 채(`alarmOnly`) 같은 시각에 그대로 울린다.
    ///
    /// 음성 **파일**은 여기서 지우지 않는다 — 같은 캐시를 다른 알람이 쓸 수 있어,
    /// 호출한 쪽이 참조 수를 보고 지운다.
    static func withVoiceRevoked(_ record: LocalAlarmRecord) -> LocalAlarmRecord {
        var next = record
        next.label = "알람"
        next.playMode = AlarmPlayMode.alarmOnly.rawValue
        next.localAudioUri = nil
        next.audioCacheKey = nil
        next.rawAudioUri = nil
        next.voiceSource = VoiceSource.localAudio.rawValue
        next.voiceProfileId = nil
        next.voiceListenerTitle = nil
        next.voiceText = nil
        next.voiceCategory = nil
        next.ttsMessageId = nil
        next.updatedAtMillis = Int64(Date().timeIntervalSince1970 * 1000)
        return next
    }

    // MARK: Audio fetch

    private func fetchAndCacheTTS(
        messageId: String,
        cacheKey: String,
        rawAudioUri: String?,
        token: String
    ) async throws {
        do {
            let audio = try await api.getTtsAudio(messageId: messageId, token: token)
            _ = try audioCache.cacheBytes(
                audio.bytes,
                cacheKey: cacheKey,
                mimeType: audio.mimeType,
                source: "tts",
                messageId: messageId,
                rawAudioUri: audio.rawAudioUri ?? rawAudioUri,
                durationOverrideMs: audio.durationMs,
                enforceMaxDuration: false
            )
        } catch {
            // ⚠ **취소면 던져 올린다.** 폴백을 타지 않는 것만으로는 부족했다 — 조용히
            // 돌아가면 호출부가 "받아 오지 못했다" 로 읽어 목소리 메타를 벗기고 그대로
            // 다시 예약한다. 회차를 접는 신호가 파괴적 쓰기로 바뀌는 자리다.
            if error is CancellationError || Task.isCancelled { throw CancellationError() }
            // 캐싱 실패는 sync 전체를 실패시키지 않는다. 무음 알람을 막기 위해
            // 원본 오디오 URL 직다운로드 폴백을 먼저 시도한다.
            Self.logger.warning(
                "TTS 캐싱 실패 (messageId: \(messageId, privacy: .public)): \(error.localizedDescription, privacy: .public) — 원본 오디오 폴백 시도"
            )
            try await cacheRawAudioFallback(rawAudioUri: rawAudioUri, cacheKey: cacheKey, messageId: messageId)
        }
    }

    /// TTS 메시지 오디오 API 가 실패했을 때 레코드의 원본 오디오 URL(rawAudioUri)을
    /// 직접 다운로드해 **같은 cacheKey** 로 저장하는 폴백.
    /// 이것마저 실패하면 호출자(`recordWithCachedTTSIfNeeded`)가 캐시 키를 비우고
    /// `audioSecured: false` 를 돌려준다 — 그러면 **수신 확인(ack)을 보내지 않아**
    /// 서버 행이 남고, 다음 sync 사이클이 그 행을 다시 보고 재시도한다.
    /// ⚠ ack 를 먼저 보내면 서버 행이 사라져 **재시도할 근거 자체가 없어진다.**
    private func cacheRawAudioFallback(rawAudioUri: String?, cacheKey: String, messageId: String) async throws {
        guard let raw = rawAudioUri?.trimmingCharacters(in: .whitespacesAndNewlines),
              !raw.isEmpty,
              let url = URL(string: raw),
              url.scheme == "https" || url.scheme == "http" else {
            Self.logger.warning(
                "원본 오디오 폴백 불가 — rawAudioUri 없음/비 http(s) (messageId: \(messageId, privacy: .public)). 다음 sync 에서 재시도"
            )
            return
        }
        do {
            var request = URLRequest(url: url)
            request.timeoutInterval = 15
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse,
                  (200..<300).contains(http.statusCode),
                  !data.isEmpty else {
                throw APIError.invalidResponse
            }
            // Content-Type 이 audio/* 가 아니면 (예: octet-stream) URL 확장자로 추정.
            let responseMime = http.mimeType?.lowercased()
            let mimeType: String
            if let responseMime, responseMime.hasPrefix("audio/") {
                mimeType = responseMime
            } else {
                mimeType = AudioCacheStore.mimeType(
                    forFormat: AudioCacheStore.normalizedFormat(url.pathExtension)
                )
            }
            _ = try audioCache.cacheBytes(
                data,
                cacheKey: cacheKey,
                mimeType: mimeType,
                source: "raw_audio",
                messageId: messageId,
                rawAudioUri: raw,
                durationOverrideMs: nil,
                enforceMaxDuration: false
            )
        } catch {
            // ⚠ **취소는 '실패' 가 아니다.** 여기서 조용히 끝내면 호출부가 "받아 오지
            // 못했다" 로 읽어 **목소리 메타를 벗기고** 그 상태로 다시 예약한다 — 회차를
            // 접으라는 신호가 되레 파괴적 쓰기가 된다(2026-08-18 Codex #697 P2).
            if error is CancellationError || Task.isCancelled { throw CancellationError() }
            Self.logger.error(
                "원본 오디오 폴백 실패 (messageId: \(messageId, privacy: .public)): \(error.localizedDescription, privacy: .public) — 캐시 키를 비워 두고 다음 sync 에서 재시도"
            )
        }
    }

    private func recordWithCachedTTSIfNeeded(_ record: LocalAlarmRecord, token: String) async throws -> PreparedRecord {
        var copy = record
        guard let cacheKey = copy.audioCacheKey,
              let messageId = copy.ttsMessageId,
              !messageId.isEmpty else {
            // 알람음 전용이면 받을 음원이 없다 — 그것만으로 전달이 끝난 것이다.
            // 목소리 알람인데 참조가 비어 있으면 받을 길이 없다는 뜻이라 미확보로 둔다.
            if copy.playModeEnum == .alarmOnly {
                return PreparedRecord(record: copy, audioSecured: true)
            }
            return PreparedRecord(record: Self.withoutUnavailableRemoteAudio(copy), audioSecured: false)
        }

        if audioCache.cachedURL(for: cacheKey) == nil {
            try await fetchAndCacheTTS(
                messageId: messageId,
                cacheKey: cacheKey,
                rawAudioUri: copy.rawAudioUri,
                token: token
            )
        }
        if let cached = audioCache.cachedURL(for: cacheKey) {
            copy.localAudioUri = cached.lastPathComponent
            return PreparedRecord(record: copy, audioSecured: true)
        }
        // 1차 캐싱 + 원본 오디오 폴백 모두 실패. 캐시 키를 비운 alarmOnly 로 강등해 알람
        // 자체는 서게 하되, **수신 확인은 하지 않는다** — ack 하면 서버가 알람 행을 지우고,
        // 그 행은 음원을 받을 권리이기도 해서(`GET /tts/messages/:id/audio` 의 수신자 갈래)
        // 이 알람은 영영 목소리를 못 받게 된다. 행이 남아야 다음 회차가 재시도할 수 있다.
        copy = Self.withoutUnavailableRemoteAudio(copy)
        return PreparedRecord(record: copy, audioSecured: false)
    }

    static func withoutUnavailableRemoteAudio(_ record: LocalAlarmRecord) -> LocalAlarmRecord {
        var copy = record
        copy.playMode = AlarmPlayMode.alarmOnly.rawValue
        copy.localAudioUri = nil
        copy.audioCacheKey = nil
        copy.rawAudioUri = nil
        copy.voiceSource = VoiceSource.localAudio.rawValue
        copy.voiceProfileId = nil
        copy.voiceText = nil
        copy.voiceCategory = nil
        copy.voiceLanguage = nil
        copy.voiceRandomPrompt = false
        copy.voiceRandomContext = nil
        copy.voiceWeatherCountry = nil
        copy.voiceWeatherCity = nil
        copy.voiceFortuneGender = nil
        copy.voiceFortuneBirthDate = nil
        copy.voiceFortuneBirthTime = nil
        copy.dynamicVoicePreparedForFireAtMillis = nil
        copy.ttsMessageId = nil
        return copy
    }
}
