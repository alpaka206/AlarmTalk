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

    /// 한 pull 사이클의 집계. Android `RemoteAlarmPullResult` 와 동일한 카운터를
    /// 가지며, `PushResult` 와 같은 스타일을 따른다.
    ///   - imported: 신규 import (로컬에 없던 receivedRemote 를 새로 저장)
    ///   - updated:  기존 receivedRemote 갱신
    ///   - skipped:  time 등이 유효하지 않아 mapped 가 nil 인 행 (07:00 보정 없이 skip)
    ///   - failed:   단일 알람 머지 중 throw 된 행 (사이클 전체를 중단시키지 않음)
    struct PullResult: Equatable, Sendable {
        var imported: Int
        var updated: Int
        var skipped: Int
        var failed: Int
    }

    /// 단일 remote 알람 머지의 결과 분류. `runOnce` 의 카운터 집계에만 쓰인다.
    private enum MergeOutcome {
        case imported
        case updated
        /// 충돌 정책(`shouldApplyRemote == false`)으로 서버 응답을 적용하지 않음.
        /// Android 와 동일하게 imported/updated/failed 어디에도 포함되지 않는다.
        case unchanged
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

    /// 한 번의 pull 사이클을 수행한다. 호출자가 동시 호출을 방지해야 한다.
    ///
    /// 반환하는 `PullResult` 는 Android `RemoteAlarmPullSyncService.pullReceivedAlarms`
    /// 의 카운터와 동일한 의미를 가진다. `BackgroundSyncTask` 가 retry 판단에 사용한다.
    @discardableResult
    func runOnce() async throws -> PullResult {
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
                switch try await mergeRemote(remote: remote, mapped: mapped, token: token) {
                case .imported: imported += 1
                case .updated: updated += 1
                case .unchanged: break
                }
            } catch {
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

        // 2. cascade 삭제: 서버에 더는 없는 receivedRemote 만 정리.
        await pruneOrphanReceivedRemotes(serverIDs: Set(remoteAlarms.map(\.id)))

        return PullResult(imported: imported, updated: updated, skipped: skipped, failed: failed)
    }

    // MARK: Merge

    /// 단일 remote 알람을 로컬 store 와 머지하고, 집계용 결과를 반환한다.
    @discardableResult
    private func mergeRemote(remote: RemoteAlarm, mapped initialMapped: LocalAlarmRecord, token: String) async throws -> MergeOutcome {
        var mapped = initialMapped
        if let existing = store.alarms.first(where: { $0.remoteAlarmId == remote.id }) {
            // 충돌 정책 + last write wins.
            guard Self.shouldApplyRemote(existing: existing, mapped: mapped) else { return .unchanged }

            mapped = await recordWithCachedTTSIfNeeded(mapped, token: token)

            // 기존 로컬 ID/alarmKitID/snoozeCount/state 는 보존해서 머지.
            let merged = Self.merge(existing: existing, mapped: mapped)
            store.upsert(merged)

            // receivedRemote 라면 일정 변경이 있을 수 있으므로 다시 스케줄.
            if merged.originEnum == .receivedRemote && merged.enabled {
                await rescheduleReceivedRemote(record: merged, existing: existing)
            }
            return .updated
        } else {
            mapped = await recordWithCachedTTSIfNeeded(mapped, token: token)

            // 신규 import.
            store.upsert(mapped)

            // receivedRemote 신규 알람이면 곧바로 AlarmKit 스케줄.
            if mapped.originEnum == .receivedRemote && mapped.enabled {
                await alarmKit.schedule(record: mapped, store: store)
            }
            await SocialNotificationTracker.notifyReceivedAlarm(
                alarmID: mapped.id,
                title: RemoteAlarmMapper.resolveLabel(remote),
                time: String(format: "%02d:%02d", mapped.hour, mapped.minute)
            )
            return .imported
        }
    }

    /// existing 의 보존 필드와 mapped 의 서버 권위 필드를 합친다.
    /// Android `RemoteAlarmPullSyncService.buildLocalAlarm` 의 existing 보존 동일.
    ///
    /// `internal` 로 노출해 `@testable import AlarmTalk` 에서 직접 호출 가능하게 한다.
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
            }
        }
    }

    // MARK: Audio fetch

    private func fetchAndCacheTTS(
        messageId: String,
        cacheKey: String,
        rawAudioUri: String?,
        token: String
    ) async {
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
            // 캐싱 실패는 sync 전체를 실패시키지 않는다. 무음 알람을 막기 위해
            // 원본 오디오 URL 직다운로드 폴백을 먼저 시도한다.
            Self.logger.warning(
                "TTS 캐싱 실패 (messageId: \(messageId, privacy: .public)): \(error.localizedDescription, privacy: .public) — 원본 오디오 폴백 시도"
            )
            await cacheRawAudioFallback(rawAudioUri: rawAudioUri, cacheKey: cacheKey, messageId: messageId)
        }
    }

    /// TTS 메시지 오디오 API 가 실패했을 때 레코드의 원본 오디오 URL(rawAudioUri)을
    /// 직접 다운로드해 **같은 cacheKey** 로 저장하는 폴백.
    /// 이것마저 실패하면 호출자(`recordWithCachedTTSIfNeeded`)가 캐시 키를 비워
    /// 두므로 다음 sync 사이클의 fresh mapped 레코드에서 재시도된다.
    private func cacheRawAudioFallback(rawAudioUri: String?, cacheKey: String, messageId: String) async {
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
            Self.logger.error(
                "원본 오디오 폴백 실패 (messageId: \(messageId, privacy: .public)): \(error.localizedDescription, privacy: .public) — 캐시 키를 비워 두고 다음 sync 에서 재시도"
            )
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
            await fetchAndCacheTTS(
                messageId: messageId,
                cacheKey: cacheKey,
                rawAudioUri: copy.rawAudioUri,
                token: token
            )
        }
        if let cached = audioCache.cachedURL(for: cacheKey) {
            copy.localAudioUri = cached.lastPathComponent
        } else {
            // 1차 캐싱 + 원본 오디오 폴백 모두 실패. 캐시 키를 비운 alarmOnly 로
            // 강등해 두면, 다음 sync 의 mapped 레코드가 다시 캐싱을 시도한다.
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
