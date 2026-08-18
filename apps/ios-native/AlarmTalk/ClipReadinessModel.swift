import Foundation
import os

/// 준비 페이지와 편집기 관문이 볼 **상태**. 계산은 `ClipReadiness` 가 하고, 여기서는
/// 그 계산에 넣을 입력(매니페스트·캐시·렌더 상태)을 모아 둔다.
///
/// ⚠ **알람 만들기를 막는 데 쓰지 말 것.** 이 값이 100% 가 아니어도 알람은 만들 수 있어야
/// 한다(오프라인에서 내일 알람을 못 맞추는 일이 있어서는 안 된다 — docs/spec/voice-and-message.md).
/// 막는 것은 **목소리 등록**과, 아직 못 받은 **그 목소리를 고르는 것**뿐이다.
@MainActor
final class ClipReadinessModel: ObservableObject {
    private static let logger = Logger(subsystem: "com.alarmtalk.app", category: "ClipReadiness")

    @Published private(set) var voices: [ClipReadiness.VoiceProgress] = []
    @Published private(set) var isRefreshing = false

    var percent: Int { ClipReadiness.percent(voices) }
    var isReady: Bool { ClipReadiness.isReady(voices) }
    /// 서버가 만들다 실패한 목소리 — 준비 페이지가 '다시 시도' 를 띄울 대상.
    var failedVoiceIDs: [String] { voices.filter { $0.renderFailed }.map { $0.voiceProfileID } }

    private let api: AlarmTalkAPI
    private let audioCache: AudioCacheStore

    init(api: AlarmTalkAPI = .shared, audioCache: AudioCacheStore = .shared) {
        self.api = api
        self.audioCache = audioCache
    }

    /// 매니페스트와 렌더 상태를 다시 읽어 준비도를 계산한다.
    ///
    /// - Parameter ownedVoiceProfileIDs: 내가 등록한 목소리. **공유받은 목소리는 넣지 않는다** —
    ///   선다운로드 대상이 아니고, 알람에서 고르는 순간 따로 받는다.
    func refresh(session: AuthSession?, ownedVoiceProfileIDs: Set<String>) async {
        guard let token = session?.token, !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }

        let manifest: StockClipListResponse
        do {
            manifest = try await api.getStockClipManifest(token: token)
        } catch {
            // 못 물어봤다고 '준비 안 됨' 으로 뒤집지 않는다 — 이미 계산해 둔 값을 유지한다.
            Self.logger.warning("Clip manifest unavailable; keeping the previous readiness")
            return
        }

        // 클론은 서버가 아직 만드는 중일 수 있다. 매니페스트에는 없지만 **기다려야 하는 몫**이라
        // 진행률에 반영해야 한다(안 그러면 0개 중 0개라 100% 로 보인다).
        var renderStates: [String: (rendering: Bool, failed: Bool)] = [:]
        for voiceID in ownedVoiceProfileIDs {
            guard let status = try? await api.voicePrerenderStatus(id: voiceID, token: token) else { continue }
            switch status.status {
            case "pending": renderStates[voiceID] = (true, false)
            case "failed": renderStates[voiceID] = (false, true)
            default: renderStates[voiceID] = (false, false)
            }
        }

        let systemVoiceIDs = Set(manifest.clips.map { $0.voiceProfileId }.filter { isSystemVoiceId($0) })
        let targets = systemVoiceIDs.sorted() + ownedVoiceProfileIDs.sorted()
        // 카테고리도 매니페스트에서 나온다 — 앱에 목록을 박아 두면 운영이 카테고리를
        // 추가했을 때 그 몫이 진행률에서 통째로 빠진다.
        let categoriesByVoice = Dictionary(grouping: manifest.clips, by: { $0.voiceProfileId })
            .mapValues { clips in Set(clips.compactMap { $0.category }).sorted() }

        voices = ClipReadiness.evaluate(
            voiceProfileIDs: targets,
            clips: manifest.clips,
            expectedVariants: manifest.expectedVariants,
            isSystemVoice: { isSystemVoiceId($0) },
            categories: { voiceID in
                guard let all = categoriesByVoice[voiceID] else { return [] }
                // 기본 목소리는 무료 테마만 쓴다(greeting 은 미리듣기 전용이라 알람에 안 쓴다).
                return isSystemVoiceId(voiceID)
                    ? all.filter { StockClipPrefetcher.freeBucketCategories.contains($0) }
                    : all
            },
            renderState: { renderStates[$0] ?? (false, false) },
            isCached: { [audioCache] clip in
                audioCache.cachedURL(for: AudioCacheStore.stockCacheKey(messageId: clip.messageId)) != nil
            }
        )
    }

    /// 서버 생성이 실패한 목소리를 다시 큐에 올린다. 다운로드 실패는 선다운로드가
    /// 다음 회차에 부족분만 다시 받으므로 별도 처리가 필요 없다.
    func retryFailedRenders(session: AuthSession?) async {
        guard let token = session?.token else { return }
        for voiceID in failedVoiceIDs {
            _ = try? await api.retryVoicePrerender(id: voiceID, token: token)
        }
    }
}
