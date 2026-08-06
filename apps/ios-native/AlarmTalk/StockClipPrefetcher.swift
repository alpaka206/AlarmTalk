import Foundation

/// 무료 버킷 스톡 클립 **선다운로드**.
///
/// 안드로이드 `sync/StockClipPrefetchWorker.kt` 미러. ⚠ **iOS 에는 이게 통째로 없었다** —
/// 대신 "기본 목소리를 골라보세요" 라는 iOS 전용 피커 화면이 그 자리를 차지하고 있었다.
/// 안드로이드는 고르라고 하지 않고 **받는다**(고르는 건 알람 편집기에서 한다).
///
/// 왜 미리 받나: 무료 버킷은 알람이 울릴 때마다 클립을 순차 회전한다. 울릴 시각에
/// 네트워크가 없으면 그 회차가 조용히 비어 버리므로, 쓰기 전에 받아 둔다.
///
/// 받는 대상 = 기본(시스템) 목소리 × **기기 언어 하나** × 무료 버킷 카테고리.
///  - 언어를 하나로 좁힌다. 3개 언어를 다 받으면 3배인데 앱은 한 번에 한 언어만 쓰고,
///    언어를 바꾸면 다시 돌아 부족분을 채운다.
///  - greeting 은 앱에 내장돼 있어 받지 않는다.
///  - 운세·사랑은 유료 클론 전용이라 기본 목소리로는 쓸 수 없다.
@MainActor
final class StockClipPrefetcher: ObservableObject {

    /// 무료 버킷에서 실제로 회전하는 카테고리. 안드로이드 `FREE_BUCKET_CATEGORIES` 와 같다.
    static let freeBucketCategories: Set<String> = ["weather", "medication"]

    /// 클립당 HTTP 왕복 1회다. 순차로 받으면 약전파에서 1분을 넘기므로 소량 병렬로 겹친다
    /// (서버·기기 부담을 감안해 안드로이드와 같은 4).
    private static let parallelism = 4

    enum State: Equatable {
        case idle
        case running(done: Int, total: Int)
        case finished
        case failed
    }

    @Published private(set) var state: State = .idle

    /// 진행 중인가 — 화면의 '백그라운드에서 계속 받기' / '나중에 받기' 문구를 가른다.
    var isRunning: Bool { if case .running = state { return true }; return false }

    private let api: AlarmTalkAPI
    private var task: Task<Void, Never>?

    init(api: AlarmTalkAPI = .shared) {
        self.api = api
    }

    /// 이미 돌고 있으면 아무 일도 하지 않는다(중복 호출 안전).
    func start(session: AuthSession?, language: String = VoiceStudioViewModel.appVoiceLanguage()) {
        guard task == nil, let token = session?.token else { return }
        task = Task { [weak self] in
            await self?.run(token: token, language: language)
            self?.task = nil
        }
    }

    func cancel() {
        task?.cancel()
        task = nil
    }

    private func run(token: String, language: String) async {
        state = .running(done: 0, total: 0)
        do {
            let clips = try await api.getStockClips(token: token).filter {
                isSystemVoiceId($0.voiceProfileId)
                    && ($0.language ?? "ko") == language
                    && Self.freeBucketCategories.contains($0.category ?? "")
            }
            guard !clips.isEmpty else { state = .finished; return }

            let cache = AudioCacheStore.shared
            let missing = clips.filter {
                cache.cachedURL(for: AudioCacheStore.stockCacheKey(messageId: $0.messageId)) == nil
            }
            var done = clips.count - missing.count
            state = .running(done: done, total: clips.count)
            guard !missing.isEmpty else { state = .finished; return }

            for batch in stride(from: 0, to: missing.count, by: Self.parallelism).map({
                Array(missing[$0..<min($0 + Self.parallelism, missing.count)])
            }) {
                if Task.isCancelled { return }
                await withTaskGroup(of: Bool.self) { group in
                    for clip in batch {
                        group.addTask { [api] in
                            do {
                                let response = try await api.getTTSMessageAudio(
                                    id: clip.messageId,
                                    token: token
                                )
                                _ = try await AudioCacheStore.cacheStockClipOffMain(
                                    audio: response,
                                    messageId: clip.messageId,
                                    cacheKey: AudioCacheStore.stockCacheKey(messageId: clip.messageId)
                                )
                                return true
                            } catch {
                                // 한 클립이 실패해도 나머지는 계속 받는다 — 회전은 남은
                                // 것만으로도 돈다. 전부 실패했을 때만 실패로 본다.
                                return false
                            }
                        }
                    }
                    for await ok in group where ok { done += 1 }
                }
                state = .running(done: done, total: clips.count)
            }
            // 하나도 못 받았으면 실패다 — '다 받았다' 고 말하면 사용자는 오프라인에서
            // 알람이 조용한 이유를 영영 모른다.
            state = done == 0 ? .failed : .finished
        } catch {
            state = .failed
        }
    }
}
