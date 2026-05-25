import Foundation

// MARK: - RemoteAlarmPullSync
//
// Android `RemoteAlarmPullSyncService.kt` 와 동등 기능.
//
// 책임:
//   1. 서버에서 알람 목록을 받아 로컬과 머지한다.
//   2. 신규 receivedRemote 알람은 자동으로 AlarmKit 에 스케줄한다.
//   3. 서버에 남아 있는 알람에 한해 TTS 음원을 캐싱한다.
//   4. 서버에서 사라진 receivedRemote 알람은 로컬에서도 cascade 삭제한다.
//
// 충돌 정책:
//   - 로컬이 dirty 면 서버 응답을 덮어쓰지 않는다 (다음 push 에서 로컬 변경을 반영).
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

    private let api: VoiceAlarmAPI
    private let store: LocalAlarmStore
    private let alarmKit: AlarmKitViewModel
    private let audioCache: AudioCacheStore
    private let auth: AuthViewModel

    init(
        api: VoiceAlarmAPI = .shared,
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

    /// 한 번의 pull 사이클을 수행한다. 호출자가 동시 호출을 방지해야 한다.
    func runOnce() async throws {
        guard let session = auth.session else { throw PullError.noSession }
        let userID = session.user.id
        let token = session.token

        let remoteAlarms = try await api.listAlarms(token: token)
        let nowMillis = Int64(Date().timeIntervalSince1970 * 1000)

        // 1. 신규/갱신 처리.
        for remote in remoteAlarms {
            let mapped = RemoteAlarmMapper.toLocalRecord(
                remote,
                currentUserID: userID,
                nowMillis: nowMillis
            )
            await mergeRemote(remote: remote, mapped: mapped, token: token)
        }

        // 2. cascade 삭제: 서버에 더는 없는 receivedRemote 만 정리.
        await pruneOrphanReceivedRemotes(serverIDs: Set(remoteAlarms.map(\.id)))
    }

    // MARK: Merge

    /// 단일 remote 알람을 로컬 store 와 머지한다.
    private func mergeRemote(remote: RemoteAlarm, mapped initialMapped: LocalAlarmRecord, token: String) async {
        var mapped = initialMapped
        if let existing = store.alarms.first(where: { $0.remoteAlarmId == remote.id }) {
            // 충돌 정책 + last write wins.
            guard Self.shouldApplyRemote(existing: existing, mapped: mapped) else { return }

            mapped = await recordWithCachedTTSIfNeeded(mapped, token: token)

            // 기존 로컬 ID/alarmKitID/snoozeCount/state 는 보존해서 머지.
            let merged = Self.merge(existing: existing, mapped: mapped)
            store.upsert(merged)

            // receivedRemote 라면 일정 변경이 있을 수 있으므로 다시 스케줄.
            if merged.originEnum == .receivedRemote && merged.enabled {
                await rescheduleReceivedRemote(record: merged, existing: existing)
            }
        } else {
            mapped = await recordWithCachedTTSIfNeeded(mapped, token: token)

            // 신규 import.
            store.upsert(mapped)

            // receivedRemote 신규 알람이면 곧바로 AlarmKit 스케줄.
            if mapped.originEnum == .receivedRemote && mapped.enabled {
                await alarmKit.schedule(record: mapped, store: store)
            }
        }
    }

    /// existing 의 보존 필드와 mapped 의 서버 권위 필드를 합친다.
    /// Android `RemoteAlarmPullSyncService.buildLocalAlarm` 의 existing 보존 동일.
    ///
    /// `internal` 로 노출해 `@testable import VoiceAlarm` 에서 직접 호출 가능하게 한다.
    static func merge(existing: LocalAlarmRecord, mapped: LocalAlarmRecord) -> LocalAlarmRecord {
        var merged = mapped
        merged.id = existing.id                                  // 로컬 ID 유지
        merged.alarmKitID = existing.alarmKitID                  // 스케줄러 ID 보존
        merged.snoozeCount = existing.snoozeCount                // 누적 카운트 유지
        merged.snoozeRepeatLimit = existing.snoozeRepeatLimit    // 사용자가 바꾼 값 보존
        merged.voiceRepeat = existing.voiceRepeat
        merged.voiceVolumePercent = existing.voiceVolumePercent
        merged.holidayOff = existing.holidayOff
        merged.alarmVolumePercent = existing.alarmVolumePercent
        merged.alarmSoundUri = existing.alarmSoundUri
        merged.alarmSoundLabel = existing.alarmSoundLabel
        merged.createdAtMillis = existing.createdAtMillis
        // receivedRemote 에서는 사용자가 disable 했다면 그 의도를 존중.
        if existing.originEnum == .receivedRemote {
            merged.enabled = existing.enabled && merged.enabled
            merged.state = merged.enabled ? AlarmRuntimeState.armed.rawValue : AlarmRuntimeState.disabled.rawValue
        }
        return merged
    }

    /// "이번 사이클의 mapped 가 서버 권위 응답으로서 existing 을 덮어써도 되는가?" 결정.
    /// 정책:
    ///   - existing.syncState == .dirty 이면 false (로컬 변경 우선)
    ///   - mapped.lastSyncedAtMillis >= existing.lastSyncedAtMillis 이면 true
    ///   - 그 외 false
    static func shouldApplyRemote(existing: LocalAlarmRecord, mapped: LocalAlarmRecord) -> Bool {
        if existing.syncStateEnum == .dirty { return false }
        return (mapped.lastSyncedAtMillis ?? 0) >= (existing.lastSyncedAtMillis ?? 0)
    }

    private func rescheduleReceivedRemote(record: LocalAlarmRecord, existing: LocalAlarmRecord) async {
        // 새 예약을 먼저 성공시킨 뒤 기존 AlarmKit ID 를 해제해 로컬 레코드가
        // 삭제되거나 무예약 상태로 남는 일을 막는다.
        let scheduled = await alarmKit.schedule(record: record, store: store)
        if scheduled, existing.alarmKitID != nil {
            await alarmKit.cancelScheduledAlarm(record: existing)
        }
    }

    // MARK: Cascade delete

    /// 로컬에 receivedRemote 로 들고 있으나 서버 응답에 사라진 알람을 정리.
    /// AlarmKit 도 함께 해제한다.
    private func pruneOrphanReceivedRemotes(serverIDs: Set<String>) async {
        let candidates = store.recordsBy(origin: .receivedRemote)
        for record in candidates {
            guard let remoteID = record.remoteAlarmId else { continue }
            if !serverIDs.contains(remoteID) {
                await alarmKit.cancel(record: record, store: store)
                store.delete(record)
            }
        }
    }

    // MARK: Audio fetch

    private func fetchAndCacheTTS(messageId: String, cacheKey: String, token: String) async {
        do {
            let audio = try await api.getTtsAudio(messageId: messageId, token: token)
            _ = try audioCache.cacheBytes(
                audio.bytes,
                cacheKey: cacheKey,
                mimeType: audio.mimeType,
                source: "tts",
                messageId: messageId,
                rawAudioUri: audio.rawAudioUri,
                durationOverrideMs: audio.durationMs,
                enforceMaxDuration: false
            )
        } catch {
            // 캐싱 실패는 sync 전체를 실패시키지 않는다. 다음 사이클에서 재시도.
        }
    }

    private func recordWithCachedTTSIfNeeded(_ record: LocalAlarmRecord, token: String) async -> LocalAlarmRecord {
        var copy = record
        guard let cacheKey = copy.audioCacheKey,
              let messageId = copy.ttsMessageId,
              !messageId.isEmpty else {
            return copy.playModeEnum == .alarmOnly ? copy : Self.withoutUnavailableRemoteAudio(copy)
        }

        if audioCache.cachedURL(for: cacheKey) == nil {
            await fetchAndCacheTTS(messageId: messageId, cacheKey: cacheKey, token: token)
        }
        if let cached = audioCache.cachedURL(for: cacheKey) {
            copy.localAudioUri = cached.lastPathComponent
        } else {
            copy = Self.withoutUnavailableRemoteAudio(copy)
        }
        return copy
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
