import Foundation

/// **받은 추가 음성팩** — 계정별 목록·카탈로그·받기·게시 끝 대체·지우기(`docs/spec/voice-packs.md` §5·§7).
///
/// 안드로이드 짝은 `data/VoicePackStore.kt`(목록)·`sync/StockClipPrefetchWorker.kt` 의 `VoicePackDownloader`(받기)·
/// `AlarmRepository.degradeAlarmsUsingVoicePack`(대체).
///
/// - 받는 일은 **선다운로드가 한다**(`StockClipPrefetcher` 가 기본 목소리·클론 다음에 `runDownloadStage` 를 부른다) —
///   여기서 따로 받는 회차를 만들지 않는다. '받기' 는 목록에 적고 프리페처를 깨울 뿐이다(`wakePrefetch`).
/// - 목록은 계정마다 따로 적는다(`UserDefaults` — `voice_packs_held_v1_<userID>`). 파일은 기기 캐시라 남지만 다른 계정의
///   목록에는 안 보인다.
@MainActor
final class VoicePackStore: ObservableObject {
    static let shared = VoicePackStore()

    struct Progress: Equatable {
        var done: Int
        var total: Int

        var percent: Int { total > 0 ? min(100, done * 100 / total) : 0 }
    }

    @Published private(set) var held: [HeldVoicePack] = []
    /// 지금 받을 수 있는 팩(카탈로그). 화면이 그린다.
    @Published private(set) var catalog: [VoicePackSummary] = []
    @Published private(set) var catalogLoaded = false
    @Published private(set) var progress: [String: Progress] = [:]
    @Published private(set) var failedPackIDs: Set<String> = []
    @Published private(set) var previewingPackID: String?
    @Published private(set) var preparingPreviewPackID: String?

    private(set) var activeUserID: String?
    private let defaults: UserDefaults
    private let api: AlarmTalkAPI
    private var lastCatalogFetch: Date?
    /// 같은 화면 진입·전경 복귀가 겹쳐 부르는 것을 묶는 창(초).
    static let catalogFreshnessWindow: TimeInterval = 30
    private static let parallelism = 4

    /// 팩 샘플 플레이어. 기본·클론 미리듣기(`VoiceStudioViewModel.previewPlayer`)와 겹치지 않는 것은 `AudioPreviewPlayer` 가 맡는다
    /// — 한쪽이 틀면 다른 쪽이 멈춘다(코덱스 #960).
    let previewPlayer = AudioPreviewPlayer()

    /// 받기 회차를 깨운다 — `AlarmTalkApp` 이 프리페처 `start` 로 꽂는다.
    var wakePrefetch: (() -> Void)?

    init(defaults: UserDefaults = .standard, api: AlarmTalkAPI = .shared) {
        self.defaults = defaults
        self.api = api
        // 끝까지 들었거나 다른 미리듣기가 끊었으면 '듣는 중' 을 내린다 — 남겨 두면 다음 탭이 '멈춤' 으로 읽힌다.
        previewPlayer.onFinish = { [weak self] in
            self?.previewingPackID = nil
        }
    }

    nonisolated static let storageKeyPrefix = "voice_packs_held_v1_"

    static func storageKey(userID: String) -> String { "\(storageKeyPrefix)\(userID)" }

    /// 이 기기에 적힌 **모든 계정**의 받은 팩이 쥔 클립 캐시 키(`pack_<clipId>`).
    ///
    /// 일반 알람 정리(알람 삭제·목소리 강등이 놓은 클립)는 이 키를 지우지 않는다 — 지우면 팩은 '받음' 으로 남는데 파일이 없어
    /// 오프라인 저장이 실패한다(코덱스 #960). 팩 파일을 놓는 것은 팩 지우기·개정 정리·기한 대체뿐이고, 그때는 목록에서 먼저 뺀다.
    /// 다른 계정이 같은 팩을 받아 두었으면 그 계정의 목록이 쥐고 있으니 남긴다. 안드로이드 `VoicePackStore.heldClipCacheKeysOnDevice` 짝.
    nonisolated static func heldClipCacheKeysOnDevice(defaults: UserDefaults = .standard) -> Set<String> {
        var keys = Set<String>()
        for (key, value) in defaults.dictionaryRepresentation() where key.hasPrefix(storageKeyPrefix) {
            guard let data = value as? Data,
                  let packs = try? JSONDecoder().decode([HeldVoicePack].self, from: data) else { continue }
            for pack in packs {
                for clip in pack.clips { keys.insert(VoicePacks.cacheKey(clipID: clip.clipId)) }
            }
        }
        return keys
    }

    // MARK: 계정

    /// 계정이 바뀌면 그 계정의 목록으로 갈아 끼운다. 로그아웃(nil)이면 비운다 — 다른 계정 목록이 보이면 안 된다.
    func activate(userID: String?) {
        guard userID != activeUserID || (userID == nil && !held.isEmpty) else { return }
        activeUserID = userID
        catalog = []
        catalogLoaded = false
        lastCatalogFetch = nil
        progress = [:]
        failedPackIDs = []
        stopPreview()
        held = userID.flatMap(load(userID:)) ?? []
    }

    private func load(userID: String) -> [HeldVoicePack]? {
        guard let data = defaults.data(forKey: Self.storageKey(userID: userID)) else { return nil }
        return try? JSONDecoder().decode([HeldVoicePack].self, from: data)
    }

    private func persist() {
        guard let userID = activeUserID else { return }
        if let data = try? JSONEncoder().encode(held) {
            defaults.set(data, forKey: Self.storageKey(userID: userID))
        }
    }

    private func replace(_ pack: HeldVoicePack) {
        if let index = held.firstIndex(where: { $0.packId == pack.packId }) {
            held[index] = pack
        } else {
            held.append(pack)
        }
        persist()
    }

    func heldPack(packID: String) -> HeldVoicePack? {
        held.first { $0.packId == packID }
    }

    /// 편집기 목록(다 받았고 게시 중 + 지금 알람이 쓰는 팩). 판정은 `VoicePacks.editorEntries`.
    func editorEntries(keepingVoiceID: String?) -> (profiles: [VoiceProfile], clips: [StockClip]) {
        VoicePacks.editorEntries(held: held, keepingVoiceID: keepingVoiceID)
    }

    // MARK: 카탈로그

    /// 목록을 받아 카탈로그와 받은 팩의 게시 상태(기한·최신 개정)를 갱신한다. 실패하면 false — 받아 둔 기한은 그대로다.
    @discardableResult
    func refreshCatalog(session: AuthSession?, force: Bool = false) async -> Bool {
        guard let session, session.user.id == activeUserID else { return false }
        if !force, let lastCatalogFetch, Date().timeIntervalSince(lastCatalogFetch) < Self.catalogFreshnessWindow {
            return true
        }
        do {
            let response = try await api.getVoicePacks(token: session.token)
            // 그 사이 계정이 바뀌었으면 버린다.
            guard session.user.id == activeUserID else { return false }
            lastCatalogFetch = Date()
            catalog = response.packs
            catalogLoaded = true
            held = VoicePacks.applyCatalog(response, to: held)
            persist()
            return true
        } catch {
            return false
        }
    }

    // MARK: 받기

    /// '받기' — 상세를 받아 목록에 적고 받기 회차를 깨운다. 고른 팩만 받는다(스펙 §7).
    @discardableResult
    func requestDownload(_ summary: VoicePackSummary, session: AuthSession?) async -> Bool {
        guard let session, session.user.id == activeUserID else { return false }
        failedPackIDs.remove(summary.packId)
        do {
            let detail = try await api.getVoicePack(packID: summary.packId, token: session.token)
            guard session.user.id == activeUserID else { return false }
            var pack = VoicePacks.held(from: detail.pack, previous: heldPack(packID: summary.packId))
            pack.state = .downloading
            replace(pack)
            progress[pack.packId] = Progress(done: 0, total: pack.clips.count)
            wakePrefetch?()
            return true
        } catch {
            failedPackIDs.insert(summary.packId)
            return false
        }
    }

    /// 받은 팩을 **이어 받을 수 있는가** — 다 받지 못했고(실패했거나, 지금 받는 회차가 없다) 게시 중이다. 그때 상세가 '다시 받기' 를
    /// 보인다(코덱스 #960). 지우고 다시 받게 하면 그 팩 알람이 미나로 바뀌므로, 지우지 않고 이어 받는 길이 따로 있어야 한다.
    func canRetryDownload(packID: String) -> Bool {
        guard let pack = heldPack(packID: packID), pack.state != .ready, pack.withdrawnPlaybackUntil == nil else { return false }
        return failedPackIDs.contains(packID) || progress[packID] == nil
    }

    /// '다시 받기' — 팩을 지우지 않고 선다운로드를 깨운다. 받기 회차가 개정을 다시 보고 빠지거나 해시가 다른 클립만 받는다
    /// (`runDownloadStage`). 안드로이드 `VoicePackSection` 의 같은 자리('다시 받기' → `downloadVoicePack`) 짝.
    func retryDownload(packID: String) {
        guard canRetryDownload(packID: packID), let pack = heldPack(packID: packID) else { return }
        failedPackIDs.remove(packID)
        progress[packID] = Progress(done: progress[packID]?.done ?? 0, total: pack.clips.count)
        wakePrefetch?()
    }

    /// **선다운로드 회차의 마지막 단계**(기본 목소리·클론 다음 — 지시서 7.3 의 4번 '선택한 추가 팩').
    ///
    /// 카탈로그를 다시 보고(기한·개정), 기한이 지난 팩을 대체한 뒤, 받은 팩의 빠진/해시 다른 클립만 받는다.
    /// 받던 중에 '받기' 로 더해진 팩도 같은 단계 안에서 이어 받는다(목록을 다시 읽는다).
    /// - Parameter isCurrent: 프리페처 회차가 아직 현재인가(취소·계정 전환이면 멈춘다).
    func runDownloadStage(session: AuthSession, isCurrent: @escaping () -> Bool) async {
        guard session.user.id == activeUserID else { return }
        await refreshCatalog(session: session)
        let deps = BackgroundDependencies.shared
        retireExpired(alarmStore: deps.alarmStore, voiceStudio: deps.voiceStudio)
        var visited = Set<String>()
        while isCurrent(), session.user.id == activeUserID,
              // 다 받은 팩도 한 번 센다 — 캐시가 정리됐으면 빠진 것만 다시 받는다. 게시가 끝난 팩은 받지 않는다.
              let pack = held.first(where: { !visited.contains($0.packId) && $0.withdrawnPlaybackUntil == nil }) {
            visited.insert(pack.packId)
            await download(pack, session: session, isCurrent: isCurrent)
        }
    }

    private func download(_ start: HeldVoicePack, session: AuthSession, isCurrent: () -> Bool) async {
        var pack = start
        // 기한이 붙은(게시가 끝난) 팩은 새로 받지 않는다 — 받아 둔 파일로 기한까지 운다.
        guard pack.withdrawnPlaybackUntil == nil else { return }
        if pack.latestRevision != pack.contentRevision {
            guard let detail = try? await api.getVoicePack(packID: pack.packId, token: session.token),
                  session.user.id == activeUserID,
                  let revised = adoptRevisedDetail(
                      detail.pack, fetchedFor: pack, alarmStore: BackgroundDependencies.shared.alarmStore
                  ) else { return }
            pack = revised
        }
        let snapshot = pack
        var missing = await Task.detached(priority: .utility) { VoicePacks.missingClips(of: snapshot) }.value
        // 다 받은 팩은 받을 것이 없다(대개의 회차).
        if missing.isEmpty, pack.state == .ready { return }
        progress[pack.packId] = Progress(done: pack.clips.count - missing.count, total: pack.clips.count)
        let token = session.token
        let packID = pack.packId
        for _ in 0..<2 where !missing.isEmpty {
            for batchStart in stride(from: 0, to: missing.count, by: Self.parallelism) {
                // 지웠거나 다른 받기가 개정을 바꿨으면 그만둔다 — 지운 팩의 파일을 다시 채우지 않는다(안드로이드 `downloadPack` 짝).
                guard isCurrent(), session.user.id == activeUserID, isStillHeld(pack) else { return }
                let batch = Array(missing[batchStart..<min(batchStart + Self.parallelism, missing.count)])
                await withTaskGroup(of: Void.self) { group in
                    for clip in batch {
                        group.addTask { [api] in
                            do {
                                let audio = try await api.getVoicePackClipAudio(packID: packID, clipID: clip.clipId, token: token)
                                // 해시·크기가 상세와 다르면 쓰지 않는다(`integrityMismatch`) — 다음 회차가 다시 받는다.
                                _ = try await AudioCacheStore.cacheVoicePackClipOffMain(audio: audio, expected: clip, packID: packID)
                            } catch {
                                // 한 클립이 실패해도 나머지는 받는다. 성공 여부는 캐시를 다시 세어 본다.
                            }
                        }
                    }
                }
                let current = pack
                let left = await Task.detached(priority: .utility) { VoicePacks.missingClips(of: current) }.value
                progress[packID] = Progress(done: current.clips.count - left.count, total: current.clips.count)
            }
            let current = pack
            missing = await Task.detached(priority: .utility) { VoicePacks.missingClips(of: current) }.value
        }
        guard session.user.id == activeUserID else { return }
        finishDownload(pack, complete: missing.isEmpty)
    }

    /// 받던 그 팩(같은 개정)이 아직 목록에 있는가. 지웠거나, 지운 뒤 다시 받기로 새 개정이 들어왔으면 false.
    private func isStillHeld(_ pack: HeldVoicePack) -> Bool {
        heldPack(packID: pack.packId)?.contentRevision == pack.contentRevision
    }

    /// 자동 개정 확인이 받아 온 상세를 적는다 — **기다리는 사이 그 팩이 그대로일 때만**(코덱스 #960). 그 사이 지웠으면 되살리지
    /// 않고(안 그러면 지운 팩이 다시 생겨 또 받는다), 다른 받기가 이미 개정을 바꿨으면 그쪽을 둔다. 적지 않았으면 nil.
    ///
    /// 새 개정에서 빠진 클립의 파일은 지운다 — 어떤 알람도 더 쓰지 않을 때만(코덱스 #960, 안드로이드 `refreshDetailIfNeeded` 의
    /// `releaseUnusedAudio` 짝). 캐시 정리(`sweepStaleCache`)는 `pack_` 을 건너뛰고 지우기는 지금 목록의 클립만 지우므로, 여기서
    /// 놓으면 그 파일은 영영 남는다.
    @discardableResult
    func adoptRevisedDetail(
        _ detail: VoicePackSummary,
        fetchedFor start: HeldVoicePack,
        alarmStore: LocalAlarmStore
    ) -> HeldVoicePack? {
        guard let current = heldPack(packID: start.packId),
              current.contentRevision == start.contentRevision else { return nil }
        let next = VoicePacks.held(from: detail, previous: current)
        replace(next)
        let kept = Set(next.clips.map(\.clipId))
        releaseUnreferencedClips(current.clips.filter { !kept.contains($0.clipId) }, alarmStore: alarmStore)
        return next
    }

    /// 받기 회차의 끝 — 다 받았으면 '받음', 아니면 '받는 중'(실패 표시)으로 둔다. 앞서 '받음' 이었어도 빠진 클립이 남았으면
    /// 내린다(안드로이드 `downloadPack` 의 `ready = missing.isEmpty()`). 그 사이 지웠거나 개정이 바뀌었으면 손대지 않는다.
    func finishDownload(_ pack: HeldVoicePack, complete: Bool) {
        guard var latest = heldPack(packID: pack.packId), latest.contentRevision == pack.contentRevision else { return }
        latest.state = complete ? .ready : .downloading
        if complete {
            failedPackIDs.remove(pack.packId)
        } else {
            failedPackIDs.insert(pack.packId)
        }
        replace(latest)
    }

    // MARK: 게시 끝 · 지우기

    /// 기한이 지난 팩을 대체한다 — 그 팩 목소리 알람을 미나로 바꾸고, 파일을 지우고, 목록에서 뺀다(스펙 §5-3).
    /// 네트워크가 없어도 된다(받아 둔 기한으로 판정한다). 앱 시작·전경 복귀·선다운로드 회차가 부른다.
    @discardableResult
    func retireExpired(now: Date = Date(), alarmStore: LocalAlarmStore, voiceStudio: VoiceStudioViewModel) -> Int {
        // ⚠ **알람을 다 읽기 전에는 대체하지 않는다** — 빈 목록으로 돌면 알람은 그대로 둔 채 파일만 지워, 읽힌 뒤의 그 알람이
        // 없는 파일을 가리킨다. 다음 계기(전경 복귀·선다운로드)가 다시 본다.
        guard alarmStore.hasLoadedFromDisk else { return 0 }
        let expired = held.filter { $0.isExpired(now: now) }
        for pack in expired {
            remove(packID: pack.packId, alarmStore: alarmStore, voiceStudio: voiceStudio)
        }
        return expired.count
    }

    /// 이 팩 목소리를 쓰는 **지금 계정의** 알람 수(지우기 확인 알럿).
    func alarmCount(usingPackID packID: String, alarmStore: LocalAlarmStore) -> Int {
        guard let pack = heldPack(packID: packID) else { return 0 }
        return Self.alarmsUsing(voiceID: pack.voiceId, in: alarmStore.alarms, ownerUserId: activeUserID).count
    }

    nonisolated static func alarmsUsing(
        voiceID: String,
        in alarms: [LocalAlarmRecord],
        ownerUserId: String?
    ) -> [LocalAlarmRecord] {
        alarms.filter {
            $0.voiceProfileId == voiceID && ($0.ownerUserId == nil || $0.ownerUserId == ownerUserId)
        }
    }

    /// 팩을 지운다 — 그 팩 목소리 알람은 미나로 바뀌고(예약은 리컨사일러가 다시 건다), 어떤 알람도 더 쓰지 않는 파일을 지운다.
    func remove(packID: String, alarmStore: LocalAlarmStore, voiceStudio: VoiceStudioViewModel) {
        guard let pack = heldPack(packID: packID) else { return }
        voiceStudio.degradeVoicePackAlarms(
            voiceID: pack.voiceId,
            alarmStore: alarmStore,
            audioCache: .shared,
            ownerUserId: activeUserID
        )
        // 목록에서 먼저 뺀 뒤 놓는다 — 놓기는 기기에 적힌 받은 팩(다른 계정 포함)이 쥔 클립을 남긴다.
        held.removeAll { $0.packId == packID }
        progress[packID] = nil
        failedPackIDs.remove(packID)
        persist()
        releaseUnreferencedClips(pack.clips, alarmStore: alarmStore)
    }

    /// 이 클립들의 파일을 지운다 — 어떤 알람이든(다른 계정 것 포함) 아직 물고 있는 것은 남긴다(그 계정이 자기 목록에서 대체할
    /// 때 지운다). 알람을 다 읽기 전에는 아무것도 지우지 않는다 — 빈 목록으로 판정하면 쓰는 파일까지 지운다.
    private func releaseUnreferencedClips(_ clips: [VoicePackClip], alarmStore: LocalAlarmStore) {
        guard !clips.isEmpty, alarmStore.hasLoadedFromDisk else { return }
        let stillReferenced = Set(
            alarmStore.alarms.compactMap(\.audioCacheKey) + alarmStore.alarms.flatMap { $0.bucketClipKeys ?? [] }
        ).union(Self.heldClipCacheKeysOnDevice(defaults: defaults))
        let referencedFiles = Set(alarmStore.alarms.compactMap(\.localAudioUri))
        let cache = AudioCacheStore.shared
        for clip in clips {
            let key = VoicePacks.cacheKey(clipID: clip.clipId)
            guard !stillReferenced.contains(key) else { continue }
            try? cache.deleteCachedAudio(cacheKey: key)
            AlarmSoundStaging.clearStagedSoundFiles(forKey: key)
            let alias = "\(clip.clipId).\(AudioCacheStore.normalizedFormat(clip.audioFormat))"
            if !referencedFiles.contains(alias), let legacy = try? AudioCacheStore.legacyAudioDirectory() {
                try? FileManager.default.removeItem(at: legacy.appendingPathComponent(alias))
            }
        }
    }

    // MARK: 미리듣기

    /// 샘플(인사말 0번) 하나만 받아 캐시하고 튼다 — 팩 전체를 받지 않는다. 다시 누르면 멈춘다.
    func togglePreview(_ summary: VoicePackSummary, session: AuthSession?) async {
        if previewingPackID == summary.packId, previewPlayer.isPlaying {
            stopPreview()
            return
        }
        stopPreview()
        guard let preview = summary.preview ?? heldPack(packID: summary.packId)?.previewClipId.map({
            VoicePackPreview(clipId: $0, sizeBytes: 0)
        }) else { return }
        let key = VoicePacks.cacheKey(clipID: preview.clipId)
        let cache = AudioCacheStore.shared
        var url = cache.cachedURL(for: key)
        if url == nil {
            guard let token = session?.token else { return }
            preparingPreviewPackID = summary.packId
            defer { preparingPreviewPackID = nil }
            guard let audio = try? await api.getVoicePackClipAudio(packID: summary.packId, clipID: preview.clipId, token: token),
                  preview.sizeBytes == 0 || preview.sizeBytes == audio.sizeBytes else { return }
            // 샘플은 목록에 해시가 없다 — 응답이 말한 해시·크기로 전송 중 손상을 막는다.
            let expected = VoicePackClip(
                clipId: preview.clipId,
                category: VoicePackPreviewCategory.greeting,
                language: summary.language,
                variant: 0,
                text: "",
                sha256: audio.sha256,
                sizeBytes: audio.sizeBytes,
                audioFormat: audio.audioFormat
            )
            guard let cached = try? await AudioCacheStore.cacheVoicePackClipOffMain(
                audio: audio,
                expected: expected,
                packID: summary.packId
            ) else { return }
            url = cache.cachedURL(for: key) ?? cached.url
        }
        guard let url else { return }
        do {
            try previewPlayer.play(url: url)
            previewingPackID = summary.packId
        } catch {
            previewingPackID = nil
        }
    }

    func stopPreview() {
        previewPlayer.stop()
        previewingPackID = nil
    }
}

private enum VoicePackPreviewCategory {
    static let greeting = "greeting"
}
