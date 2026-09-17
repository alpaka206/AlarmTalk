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

    private let api: AlarmTalkAPI
    private var task: Task<Void, Never>?
    /// `start` 마다 올리는 세대. **취소된 앞 회차가 뒤늦게 상태를 덮어쓰지 못하게** 한다 —
    /// 취소는 배치 경계에서만 확인되므로, 앞 회차가 마지막 배치를 끝내고 `.finished` 를
    /// 쓰면 새 회차가 받는 중인데도 받기 화면이 닫혔다.
    private var generation = 0

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
        generation += 1
        let gen = generation
        task = Task { [weak self] in
            // ⚠ **재시도가 없으면 한 번의 일시 실패가 영구가 된다.** 안드로이드는 WorkManager
            // 가 30초 백오프로 다시 돌리는데, iOS 에는 그 장치가 없어 콜드 스타트에서 한 번
            // 실패하면 그 실행 내내 테마 클립이 비어 있었다.
            for attempt in 0..<Self.maxAttempts {
                if Task.isCancelled { break }
                await self?.run(token: token, language: language, ownedVoiceProfileIDs: owned, gen: gen)
                guard await self?.state == .failed else { break }
                if attempt < Self.maxAttempts - 1 {
                    try? await Task.sleep(nanoseconds: Self.retryDelaySeconds * 1_000_000_000)
                }
            }
            if self?.generation == gen { self?.task = nil }
        }
    }

    /// 기본 목소리 선다운로드 대상인가 — 기기 언어 하나 × 무료 테마.
    static func isDefaultVoiceTarget(_ clip: StockClip, language: String) -> Bool {
        isSystemVoiceId(clip.voiceProfileId)
            && (clip.language ?? "ko") == language
            && freeBucketCategories.contains(clip.category ?? "")
    }

    /// 기본 목소리 클립을 **몇 개 중 몇 개 받았는가**. 알람 설정 관문과 목소리 탭 진행 표시가 본다.
    ///
    /// 기준은 서버 매니페스트에 **실제로 있는** 클립이다(기대 개수표가 아니다) — 서버가 아직
    /// 못 만든 클립까지 세면 받을 수 없는 몫 때문에 관문이 영영 안 열린다.
    /// 매니페스트를 한 번도 못 받았으면 nil(= 모른다).
    static func defaultVoiceProgress(
        language: String = VoiceStudioViewModel.appVoiceLanguage()
    ) -> (done: Int, total: Int)? {
        guard let manifest = StockClipManifestStore.load() else { return nil }
        let targets = manifest.clips.filter { isDefaultVoiceTarget($0, language: language) }
        let missing = missingClips(targets).count
        return (targets.count - missing, targets.count)
    }

    /// 기본 목소리를 다 받아 **알람을 설정해도 되는가**(2026-09-17 지시: 다 받기 전에는 알람
    /// 설정 화면 자체를 막는다). 매니페스트가 비어 있으면(서버가 줄 것이 없다) 막지 않는다.
    static func defaultVoicesReady() -> Bool {
        guard let progress = defaultVoiceProgress() else { return false }
        return progress.done >= progress.total
    }

    var isRunning: Bool {
        if case .running = state { return true }
        return false
    }

    func cancel() {
        task?.cancel()
        task = nil
        generation += 1
    }

    /// 이 회차가 아직 현재 회차일 때만 상태를 쓴다.
    private func setState(_ new: State, gen: Int) {
        guard gen == generation, !Task.isCancelled else { return }
        state = new
    }

    /// 받을 목록 중 **아직 캐시에 없는(또는 낡은) 것**.
    private static func missingClips(_ clips: [StockClip]) -> [StockClip] {
        let cache = AudioCacheStore.shared
        return clips.filter {
            let key = AudioCacheStore.stockCacheKey(messageId: $0.messageId)
            return cache.cachedURL(for: key) == nil
                || cache.isStale(cacheKey: key, remoteAudioUri: $0.audioUrl)
        }
    }

    /// 한 회차 안에서 빠진 클립을 다시 받는 횟수. 동시에 같은 파일을 쓰다 실패한 것처럼
    /// 곧바로 다시 받으면 되는 실패를 30초 대기로 미루지 않는다.
    private static let passesPerRun = 3

    private func run(token: String, language: String, ownedVoiceProfileIDs: Set<String> = [], gen: Int) async {
        setState(.running(done: 0, total: 0), gen: gen)
        do {
            let manifest = try await api.getStockClipManifest(token: token)
            // 알람 관문(`defaultVoiceProgress`)이 오프라인 콜드스타트에서도 같은 목록을 보게 남긴다.
            StockClipManifestStore.save(manifest)
            let clips = manifest.clips.filter { clip in
                if isSystemVoiceId(clip.voiceProfileId) {
                    return Self.isDefaultVoiceTarget(clip, language: language)
                }
                // 내가 등록한 클론 — **카테고리·언어를 거르지 않는다.**
                // 클론 사전렌더는 '등록 때 고른 언어' 단일 세트라 기기 언어로 거르면
                // 일본어로 만든 목소리가 한국어 기기에서 한 개도 안 받아진다
                // (안드로이드 `downloadAllPresetClips` 도 거르지 않는다).
                return ownedVoiceProfileIDs.contains(clip.voiceProfileId)
            }
            guard !clips.isEmpty else { setState(.finished, gen: gen); return }

            var missing = Self.missingClips(clips)
            setState(.running(done: clips.count - missing.count, total: clips.count), gen: gen)

            // ⚠ **'하나라도 받았으면 끝' 으로 판정하지 말 것**(2026-09-17 실기기). 예전에는
            // `done == 0 ? .failed : .finished` 라, 일부가 실패해도 받기 화면이 닫히고 메인으로
            // 넘어갔다 — 다 받지 못한 테마는 오프라인에서 소리가 비고 회전 순서도 어긋난다.
            // 끝났다고 말하는 기준은 **캐시를 다시 셌을 때 빠진 것이 0개** 하나다.
            for _ in 0..<Self.passesPerRun where !missing.isEmpty {
                for batch in stride(from: 0, to: missing.count, by: Self.parallelism).map({
                    Array(missing[$0..<min($0 + Self.parallelism, missing.count)])
                }) {
                    if Task.isCancelled || gen != generation { return }
                    await withTaskGroup(of: Void.self) { group in
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
                                } catch {
                                    // 한 클립이 실패해도 나머지는 계속 받는다. 성공 여부는 아래에서
                                    // **캐시를 다시 세어** 판정한다 — 옛 별칭 실패(`legacyAliasFailed`)
                                    // 처럼 정본은 저장된 경우도 그렇게 해야 정확하다.
                                }
                            }
                        }
                    }
                    setState(
                        .running(done: clips.count - Self.missingClips(clips).count, total: clips.count),
                        gen: gen
                    )
                }
                missing = Self.missingClips(clips)
            }
            setState(missing.isEmpty ? .finished : .failed, gen: gen)
        } catch {
            setState(.failed, gen: gen)
        }
    }
}
