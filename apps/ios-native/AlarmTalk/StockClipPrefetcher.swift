import Foundation

/// 무료 버킷 스톡 클립 **선다운로드**.
///
/// 안드로이드 `sync/StockClipPrefetchWorker.kt` 미러. ⚠ **iOS 에는 이게 통째로 없었다** —
/// 대신 "기본 목소리를 골라보세요" 라는 iOS 전용 피커 화면이 그 자리를 차지하고 있었다.
/// 안드로이드는 고르라고 하지 않고 **받는다**(고르는 건 알람 편집기에서 한다).
///
/// 왜 미리 받나: 무료 테마는 울릴 때마다 클립을 순차로 바꾸므로(`FreeBucketSettings`
/// 주석 참조) **그 테마의 클립이 전부** 있어야 한다. 하나라도 비면 그 회차가 다른 클립으로
/// 대체되어 순서가 어긋난다. 알람을 만들 때 네트워크가 없어도 테마를 고를 수 있어야 하는
/// 것도 같은 이유다.
///
/// 받는 대상 = 기본(시스템) 목소리 × **기기 언어 하나** × 무료 버킷 카테고리.
///  - 언어를 하나로 좁힌다. 3개 언어를 다 받으면 3배인데 앱은 한 번에 한 언어만 쓰고,
///    언어를 바꾸면 다시 돌아 부족분을 채운다.
///  - **고를 수 있는 카테고리를 전부 받는다**(2026-09-02). 기본 목소리도 운세·사랑을
///    고를 수 있게 되면서(`docs/spec/voice-and-message.md` §2), 안 받는 종류가 있으면
///    **고를 수는 있는데 오프라인에서 소리가 안 나는** 알람이 생긴다.
///  - greeting 은 받지 않는다 — 알람 테마가 아니고(§2), 미리듣기용은 앱에 내장돼 있다.
@MainActor
final class StockClipPrefetcher: ObservableObject {

    /// 선다운로드 대상 카테고리.
    ///
    /// ⚠ **손으로 적지 않는다**(2026-09-02). 여기가 `["weather","medication"]` 로 박혀
    /// 있어서, 편집기 목록에 카테고리를 더해도 **그 클립만 안 받는** 상태가 됐다 — 고를
    /// 수는 있는데 오프라인에서 소리가 안 나는 종류가 생긴다. 안드로이드
    /// `StockClipPrefetchWorker.FREE_BUCKET_CATEGORIES` 도 `FreeBucketOrder` 에서 유도한다.
    static let freeBucketCategories: Set<String> = Set(FreeBucket.order.map(\.rawValue))

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

    /// 진행 중인가 — 화면의 '백그라운드에서 계속' / '나중에 받기' 문구를 가른다.
    var isRunning: Bool { if case .running = state { return true }; return false }

    private let api: AlarmTalkAPI
    private var task: Task<Void, Never>?

    init(api: AlarmTalkAPI = .shared) {
        self.api = api
    }

    /// 실패 사이 대기(초). 안드로이드 WorkManager 의 `BackoffPolicy.LINEAR, 30초` 와 같은 뜻이다.
    private static let retryDelaySeconds: UInt64 = 30
    /// 한 번의 호출에서 최대 시도 횟수.
    private static let maxAttempts = 3

    /// 이미 돌고 있으면 아무 일도 하지 않는다(중복 호출 안전).
    ///
    /// **여러 번 불러도 된다.** 이미 캐시된 클립은 건너뛰므로, 앱이 포그라운드로 돌아올
    /// 때마다 불러 **빠진 것만 보충**하는 용도로 쓴다. 안드로이드는 앱 시작마다
    /// `prefetchStockClips()` 로 같은 일을 한다.
    /// - Parameter ownedVoiceProfileIDs: **내가 등록한** 목소리 id 들. 그 목소리의 사전렌더
    ///   프리셋도 미리 받는다 — 등록은 서버 생성 + 다운로드가 끝나야 끝난 것이기 때문이다.
    ///   ⚠ **공유받은 목소리는 넣지 않는다.** 그룹원 수만큼 곱해져 용량이 커지는데 실제로
    ///   쓰는 것은 보통 하나다. 그건 알람에서 **고르는 순간** 받는다.
    func start(
        session: AuthSession?,
        language: String = VoiceStudioViewModel.appVoiceLanguage(),
        ownedVoiceProfileIDs: Set<String> = []
    ) {
        guard task == nil, let token = session?.token else { return }
        let owned = ownedVoiceProfileIDs
        task = Task { [weak self] in
            // ⚠ **재시도가 없으면 한 번의 일시 실패가 영구가 된다.** 안드로이드는 WorkManager
            // 가 30초 백오프로 다시 돌리는데, iOS 에는 그 장치가 없어 콜드 스타트에서 한 번
            // 실패하면 그 실행 내내 테마 클립이 비어 있었다.
            for attempt in 0..<Self.maxAttempts {
                if Task.isCancelled { break }
                await self?.run(token: token, language: language, ownedVoiceProfileIDs: owned)
                guard await self?.state == .failed else { break }
                if attempt < Self.maxAttempts - 1 {
                    try? await Task.sleep(nanoseconds: Self.retryDelaySeconds * 1_000_000_000)
                }
            }
            self?.task = nil
        }
    }

    func cancel() {
        task?.cancel()
        task = nil
    }

    private func run(token: String, language: String, ownedVoiceProfileIDs: Set<String> = []) async {
        state = .running(done: 0, total: 0)
        do {
            let clips = try await api.getStockClips(token: token).filter { clip in
                if isSystemVoiceId(clip.voiceProfileId) {
                    // 기본 목소리 — 기기 언어 하나 × 무료 테마.
                    return (clip.language ?? "ko") == language
                        && Self.freeBucketCategories.contains(clip.category ?? "")
                }
                // 내가 등록한 클론 — **카테고리·언어를 거르지 않는다.**
                // 클론 사전렌더는 '등록 때 고른 언어' 단일 세트라 기기 언어로 거르면
                // 일본어로 만든 목소리가 한국어 기기에서 한 개도 안 받아진다
                // (안드로이드 `downloadAllPresetClips` 도 거르지 않는다).
                return ownedVoiceProfileIDs.contains(clip.voiceProfileId)
            }
            guard !clips.isEmpty else { state = .finished; return }

            let cache = AudioCacheStore.shared
            let missing = clips.filter {
                let key = AudioCacheStore.stockCacheKey(messageId: $0.messageId)
                return cache.cachedURL(for: key) == nil
                    || cache.isStale(cacheKey: key, remoteAudioUri: $0.audioUrl)
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
                            } catch AudioCacheError.legacyAliasFailed {
                                // 이 경로의 성공 기준은 **정본(cacheKey)** 하나다(`missing`
                                // 판정도 그 키를 본다). 옛 별칭 실패로 실패라고 말하면
                                // 실제로는 다 받아 놓고 '받기 실패' 를 띄우는데, 다시
                                // 시도해도 받을 게 없어 그 화면에서 못 빠져나온다.
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
