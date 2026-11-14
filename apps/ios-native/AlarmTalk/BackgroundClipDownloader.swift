import Foundation

/// background download task 하나가 **어떤 클립인지** — `URLSessionTask.taskDescription` 에 싣는다.
///
/// 앱이 내려간 뒤 iOS 가 다시 띄워 완료를 배달하면 메모리에 남은 것이 없다. 그래서 task 가 스스로 무엇을 받았고 누구 것인지
/// 말해야 한다. 토큰은 싣지 않는다 — 401 을 알릴 토큰은 그 요청의 헤더에서 되읽는다(`AlarmTalkAPI.bearerToken(of:)`).
struct BackgroundClipTask: Codable, Equatable, Sendable {
    static let currentVersion = 1

    var version: Int = currentVersion
    let messageId: String
    /// 쓸 캐시 자리. 언제나 `AudioCacheStore.stockCacheKey(messageId:)` 다 — 해석할 때 대조한다(다른 자리로 쓰지 않는다).
    let cacheKey: String
    /// 넘긴 계정. 받은 때 로그인한 계정이 다르면(로그아웃·계정 전환·탈퇴) 버린다.
    let userId: String
    /// 넘긴 묶음. 로그아웃했다가 **같은 계정**으로 다시 로그인해도 앞 묶음의 늦은 완료를 버리게 한다.
    let batchId: String

    var encoded: String {
        guard let data = try? JSONEncoder().encode(self) else { return "" }
        return String(decoding: data, as: UTF8.self)
    }

    /// 우리가 쓴 모양이 아니면 nil — 그 task 는 아무것도 쓰지 않는다.
    static func decode(_ description: String?) -> BackgroundClipTask? {
        guard let data = description?.data(using: .utf8),
              let task = try? JSONDecoder().decode(BackgroundClipTask.self, from: data),
              task.version == currentVersion,
              task.messageId.nilIfBlank != nil,
              task.userId.nilIfBlank != nil,
              task.batchId.nilIfBlank != nil,
              task.cacheKey == AudioCacheStore.stockCacheKey(messageId: task.messageId) else { return nil }
        return task
    }
}

/// **앱을 닫아도 받는다** — 아직 빠진 스톡 클립을 OS 백그라운드 다운로드(background `URLSession`)로 받는다.
///
/// 규칙은 `docs/spec/voice-and-message.md` 「앱을 닫아도 받는다」. 요약:
/// - 포그라운드는 그대로 `StockClipPrefetcher` 가 받는다. 앱이 **백그라운드로 갈 때** 빠진 것을 받을 순서 그대로 여기로 넘기고
///   (`StockClipPrefetcher.handOffToBackground`), **다시 앞으로 오면** 남은 task 를 취소한다 — 포그라운드 회차가 캐시를 다시
///   세어 빠진 것만 받는다. 같은 클립을 두 곳이 동시에 받지 않는다.
/// - 받은 파일(서버 JSON — base64 음원)은 포그라운드와 **같은 해석**(`AlarmTalkAPI.interpret`)과 **같은 캐시 쓰기**
///   (`AudioCacheStore.cacheStockClipOffMain`)로 넣는다. 받는 길만 다르다.
/// - 계정이 바뀌었거나 로그아웃했으면 받은 것을 버린다. 401·403 이면 기존 처리(세션 만료·동의·탈퇴 알림)를 타고 남은 task 를
///   취소한다.
/// - 준비 기록(`voice_preparation_*`)은 여기서 적지 않는다 — 다음 포그라운드 회차가 캐시를 다시 센다.
/// - 울림 경로와 무관하다. 예약은 캐시를 보고 거는 기존 리컨사일러가 맞춘다(`onClipsCached`).
///
/// ⚠ **이 타입을 `@MainActor` 로 만들지 말 것.** 델리게이트 콜백은 시스템이 **세션의 delegate 큐**(아래 직렬 큐)에서
///   부른다. 메인 액터 타입이 이 프로토콜을 따르면(`@preconcurrency` 포함) Swift 6 이 진입부에 심는 격리 검사가 거기서 트랩한다
///   — `BGTaskScheduler` 런치 핸들러와 같은 사고다(CLAUDE.md 「시스템이 큐를 정하는 콜백에 메인 액터 클로저를 넘기지 않는다」,
///   `scripts/check-bgtask-handler-isolation.py` 가 이 꼴을 검사한다). 메인으로 건너는 일은 안에서 명시적으로 한다.
final class BackgroundClipDownloader: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {

    /// 세션 identifier. iOS 가 앱을 다시 띄워 이벤트를 배달할 때 이 이름으로 같은 세션을 다시 만든다 — **바꾸지 말 것**
    /// (바꾸면 앞 이름으로 넘긴 task 의 완료를 받을 길이 없다). 번들 id 를 붙여 dev·prod 앱이 갈린다.
    static let sessionIdentifier = "\(Bundle.main.bundleIdentifier ?? "com.alarmtalk.app").stock-clip-downloads"

    static let shared = BackgroundClipDownloader()

    enum Outcome: Equatable, Sendable {
        /// 캐시에 넣었다.
        case cached
        /// 우리 것이 아니거나(모양) 다른 계정·지난 묶음의 것이라 버렸다.
        case discarded
        /// 401·403 — 기존 알림을 탔다. 남은 task 를 취소한다.
        case rejected
        /// 그 밖의 실패(빈 파일·해석·디스크). 다음 포그라운드 회차가 다시 받는다.
        case failed
    }

    /// 넘긴 묶음의 표지 — 디스크에 둔다(앱이 내려갔다가 다시 떠도 대조할 수 있게).
    struct Batch: Codable, Equatable, Sendable {
        let id: String
        let userId: String
    }

    typealias CacheClip = @Sendable (TtsMessageAudioResponse, _ messageId: String, _ cacheKey: String) async throws -> Void

    private let lock = NSLock()
    private let makeSession: @Sendable (BackgroundClipDownloader) -> URLSession
    private let api: AlarmTalkAPI
    private let defaults: UserDefaults
    private let batchKey: String
    private let currentUserID: @Sendable () -> String?
    private let cacheClip: CacheClip

    // 아래는 `lock` 으로만 만진다.
    private var _session: URLSession?
    private var eventsCompletionHandler: CompletionBox?
    private var processing: [UUID: Task<Void, Never>] = [:]
    private var cachedSinceEvents = 0
    private var _onClipsCached: (@Sendable () async -> Void)?
    private var epoch = 0

    /// 백그라운드로 깨어난 실행에서 클립을 하나라도 넣었으면, 완료 핸들러를 부르기 **전에** 한 번 부른다 — 예약을 새 캐시로
    /// 다시 맞춘다(`PushAppDelegate` 가 기존 리컨사일러를 꽂는다). 앱이 떠 있으면 전경 복귀의 재조정이 같은 일을 한다.
    var onClipsCached: (@Sendable () async -> Void)? {
        get { lock.withLock { _onClipsCached } }
        set { lock.withLock { _onClipsCached = newValue } }
    }

    init(
        api: AlarmTalkAPI = .shared,
        defaults: UserDefaults = .standard,
        batchKey: String = "background_clip_download_batch" + TestIsolation.storageSuffix,
        currentUserID: @escaping @Sendable () -> String? = { KeychainStore.readSession()?.user.id },
        cacheClip: @escaping CacheClip = { audio, messageId, cacheKey in
            _ = try await AudioCacheStore.cacheStockClipOffMain(audio: audio, messageId: messageId, cacheKey: cacheKey)
        },
        makeSession: @escaping @Sendable (BackgroundClipDownloader) -> URLSession = { delegate in
            URLSession(
                configuration: BackgroundClipDownloader.makeBackgroundConfiguration(),
                delegate: delegate,
                delegateQueue: BackgroundClipDownloader.makeDelegateQueue()
            )
        }
    ) {
        self.api = api
        self.defaults = defaults
        self.batchKey = batchKey
        self.currentUserID = currentUserID
        self.cacheClip = cacheClip
        self.makeSession = makeSession
        super.init()
    }

    /// - `sessionSendsLaunchEvents`: 앱이 내려가 있어도 완료 때 다시 띄운다(`handleEventsForBackgroundURLSession`).
    /// - `isDiscretionary = false`: 시스템이 '좋은 때' 까지 미루지 않게 한다(그래도 저전력 모드 등은 늦출 수 있다 — 스펙).
    /// - 호스트당 연결 수는 포그라운드 병렬 수와 같다(`StockClipPrefetcher.parallelism`).
    static func makeBackgroundConfiguration(identifier: String = sessionIdentifier) -> URLSessionConfiguration {
        let configuration = URLSessionConfiguration.background(withIdentifier: identifier)
        configuration.sessionSendsLaunchEvents = true
        configuration.isDiscretionary = false
        configuration.httpMaximumConnectionsPerHost = StockClipPrefetcher.parallelism
        return configuration
    }

    /// 델리게이트 콜백은 **직렬**로 받는다 — 콜백마다 임시 파일을 곧바로 읽고 다음으로 넘긴다.
    static func makeDelegateQueue() -> OperationQueue {
        let queue = OperationQueue()
        queue.name = "com.alarmtalk.stock-clip-downloads"
        queue.maxConcurrentOperationCount = 1
        return queue
    }

    // MARK: - 넘기기 · 취소

    /// 거두기(`cancelAll`)마다 오르는 번호. 넘기기는 시작할 때 이 번호를 잡아 두고, task 를 만들기 직전에 그대로인지 본다 —
    /// 넘기는 몇백 ms 사이에 앱이 다시 앞으로 와서 거두기가 먼저 돌았으면 넘기지 않는다(앞에서는 포그라운드가 받는다).
    var handOffEpoch: Int { lock.withLock { epoch } }

    /// 빠진 클립을 [clips] 순서 그대로 넘긴다. 앞서 넘긴 task 는 먼저 취소한다(백그라운드로 두 번 가도 겹치지 않는다).
    /// - Parameter epoch: 넘기기를 시작할 때 잡은 [handOffEpoch]. 그 사이 거두기가 돌았으면 아무것도 넘기지 않는다.
    /// - Returns: 넘긴 수.
    @discardableResult
    func enqueue(_ clips: [StockClip], session auth: AuthSession, epoch expected: Int? = nil) async -> Int {
        let urlSession = session
        await cancelTasks(in: urlSession)
        guard !clips.isEmpty else { return 0 }
        let batch = Batch(id: UUID().uuidString, userId: auth.user.id)
        let requests = clips.map { clip in
            (clip, api.ttsMessageAudioRequest(id: clip.messageId, token: auth.token))
        }
        // 번호 대조와 task 만들기를 한 임계구역에서 한다 — 거두기는 번호를 올린 **뒤에** task 를 모으므로, 여기서 만든 task 는
        // 그 거두기가 반드시 본다.
        return lock.withLock {
            if let expected, expected != epoch { return 0 }
            saveBatch(batch)
            for (index, (clip, request)) in requests.enumerated() {
                let task = urlSession.downloadTask(with: request)
                task.taskDescription = BackgroundClipTask(
                    messageId: clip.messageId,
                    cacheKey: AudioCacheStore.stockCacheKey(messageId: clip.messageId),
                    userId: auth.user.id,
                    batchId: batch.id
                ).encoded
                // 순서는 넣은 차례가 1차다. 우선순위는 시스템에 주는 힌트일 뿐이라 앞 차례일수록 높게만 준다.
                task.priority = Self.priority(index: index, count: clips.count)
                task.resume()
            }
            return clips.count
        }
    }

    static func priority(index: Int, count: Int) -> Float {
        guard count > 1 else { return URLSessionTask.highPriority }
        let fraction = Float(index) / Float(count - 1)
        return URLSessionTask.highPriority - fraction * (URLSessionTask.highPriority - URLSessionTask.lowPriority)
    }

    /// 남은 task 를 전부 취소한다(거두기). 앱이 앞으로 올 때(`forgetBatch: false` — 이미 받은 늦은 완료는 써도 된다)와
    /// 계정을 떠날 때(`true` — 늦은 완료까지 버린다) 부른다.
    ///
    /// 넘긴 적이 없으면(표지 없음) 세션을 만들지 않는다 — 만들 일이 없는 실행에서 백그라운드 세션을 띄우지 않는다.
    func cancelAll(forgetBatch: Bool) async {
        let urlSession = existingOrRestorableSession()
        // 번호·표지는 기다리기 **전에** 바꾼다 — 도는 넘기기는 멈추고, 취소가 닿기 전에 끝난 완료도 곧바로 버려진다.
        lock.withLock {
            epoch += 1
            if forgetBatch { defaults.removeObject(forKey: batchKey) }
        }
        guard let urlSession else { return }
        await cancelTasks(in: urlSession)
    }

    private func cancelTasks(in urlSession: URLSession) async {
        for task in await urlSession.allTasks {
            task.cancel()
        }
    }

    /// 계정이 바뀌었다(로그아웃·전환·탈퇴 포함 — `AlarmTalkApp` 의 계정 키 `.task`). 넘긴 묶음이 다른 계정 것이면 버린다.
    /// 같은 계정으로 다시 떠난 콜드 스타트는 아무것도 하지 않는다(그 묶음의 완료는 여전히 쓸 수 있다).
    func accountChanged(to userID: String?) {
        guard let batch = loadBatch(), batch.userId != userID else { return }
        // 세션을 먼저 잡고(표지가 있어야 되살린다) 표지를 **곧바로** 지운다 — 이 뒤에 닿는 완료는 전부 버려진다.
        let urlSession = existingOrRestorableSession()
        lock.withLock {
            epoch += 1
            defaults.removeObject(forKey: batchKey)
        }
        guard let urlSession else { return }
        Task { await cancelTasks(in: urlSession) }
    }

    // MARK: - 시스템이 다시 띄웠을 때

    /// `application(_:handleEventsForBackgroundURLSession:completionHandler:)` 에서 부른다. 같은 이름의 세션을 다시 만들어
    /// 쌓인 이벤트를 받고, 다 받으면(`urlSessionDidFinishEvents`) 완료 핸들러를 메인에서 부른다.
    /// - Returns: 우리 세션이면 true. 아니면 부른 쪽이 핸들러를 곧바로 부른다.
    func handleEvents(forSessionIdentifier identifier: String, completionHandler: @escaping () -> Void) -> Bool {
        guard identifier == Self.sessionIdentifier else { return false }
        lock.withLock { eventsCompletionHandler = CompletionBox(completionHandler) }
        _ = session
        return true
    }

    // MARK: - URLSessionDownloadDelegate (delegate 큐 — 메인이 아니다)

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        // ⚠ **임시 파일은 이 콜백 안에서 읽는다** — 돌아가면 iOS 가 지운다. 응답은 JSON(base64 음원) 한 장이라 작다.
        let data = try? Data(contentsOf: location)
        let descriptor = BackgroundClipTask.decode(downloadTask.taskDescription)
        let response = downloadTask.response
        let token = AlarmTalkAPI.bearerToken(of: downloadTask.originalRequest)
        track { [self] in
            let outcome = await self.handleDownloaded(descriptor: descriptor, data: data, response: response, token: token)
            if outcome == .rejected {
                // 같은 토큰의 나머지도 같은 답을 받는다 — 헛걸음을 줄인다. 늦은 완료는 표지·계정 대조가 막는다.
                await self.cancelAll(forgetBatch: false)
            }
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: (any Error)?) {
        guard let error, (error as? URLError)?.code != .cancelled else { return }
        // 실패한 클립은 다음 포그라운드 회차가 다시 받는다 — 여기서 다시 넘기지 않는다.
        AlarmTalkLog.logger.notice(
            "background clip download failed: \(String(describing: (error as? URLError)?.code.rawValue ?? -1), privacy: .public)"
        )
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        let (pending, handler): ([Task<Void, Never>], CompletionBox?) = lock.withLock {
            let values = (Array(processing.values), eventsCompletionHandler)
            eventsCompletionHandler = nil
            return values
        }
        Task {
            // 받은 파일을 다 넣은 **뒤에** 시스템에 끝났다고 알린다 — 먼저 알리면 iOS 가 앱을 다시 재운다.
            for task in pending { await task.value }
            // 넣은 수는 처리가 다 끝난 **뒤에** 센다 — 먼저 세면 아직 쓰는 중인 클립이 빠져 예약을 맞추지 않는다.
            let (cached, hook) = self.lock.withLock { () -> (Int, (@Sendable () async -> Void)?) in
                let values = (self.cachedSinceEvents, self._onClipsCached)
                self.cachedSinceEvents = 0
                return values
            }
            if cached > 0, let hook { await hook() }
            guard let handler else { return }
            // 완료 핸들러는 **메인 스레드에서** 부른다(UIKit 문서).
            await MainActor.run { handler.call() }
        }
    }

    // MARK: - 받은 것 처리 (테스트가 곧바로 부른다)

    /// 받은 파일 하나를 해석해 캐시에 넣는다. 계정·묶음 대조는 해석 앞뒤로 한 번씩 한다.
    func handleDownloaded(
        descriptor: BackgroundClipTask?,
        data: Data?,
        response: URLResponse?,
        token: String?
    ) async -> Outcome {
        guard let descriptor, isCurrent(descriptor) else { return .discarded }
        guard let data, !data.isEmpty else { return .failed }
        let audio: TtsMessageAudioResponse
        do {
            audio = try api.interpret(data: data, response: response, token: token)
        } catch let APIError.server(status, _, _) where status == 401 || status == 403 {
            return .rejected
        } catch {
            return .failed
        }
        // 해석하는 사이 계정을 떠났을 수 있다 — 쓰기 직전에 한 번 더 본다.
        guard isCurrent(descriptor) else { return .discarded }
        do {
            try await cacheClip(audio, descriptor.messageId, descriptor.cacheKey)
        } catch {
            return .failed
        }
        lock.withLock { cachedSinceEvents += 1 }
        return .cached
    }

    /// 이 task 를 넘긴 계정이 지금도 로그인해 있고, 그 뒤로 묶음을 버리지 않았는가.
    func isCurrent(_ descriptor: BackgroundClipTask) -> Bool {
        guard let current = currentUserID(), current == descriptor.userId,
              let batch = loadBatch() else { return false }
        return batch.id == descriptor.batchId && batch.userId == descriptor.userId
    }

    /// 처리 중인 일 — `urlSessionDidFinishEvents` 가 다 끝나기를 기다린다. 테스트도 이걸로 기다린다.
    func waitForProcessing() async {
        let pending = lock.withLock { Array(processing.values) }
        for task in pending { await task.value }
    }

    // MARK: - 내부

    private var session: URLSession {
        lock.withLock {
            if let existing = _session { return existing }
            let created = makeSession(self)
            _session = created
            return created
        }
    }

    private func existingOrRestorableSession() -> URLSession? {
        let existing = lock.withLock { _session }
        if let existing { return existing }
        return loadBatch() == nil ? nil : session
    }

    private func track(_ work: @escaping @Sendable () async -> Void) {
        let id = UUID()
        lock.withLock {
            processing[id] = Task { [weak self] in
                await work()
                self?.lock.withLock { _ = self?.processing.removeValue(forKey: id) }
            }
        }
    }

    func loadBatch() -> Batch? {
        guard let data = defaults.data(forKey: batchKey) else { return nil }
        return try? JSONDecoder().decode(Batch.self, from: data)
    }

    private func saveBatch(_ batch: Batch) {
        guard let data = try? JSONEncoder().encode(batch) else { return }
        defaults.set(data, forKey: batchKey)
    }

    /// 떠 있는 task 들이 실은 클립 — 만든 차례(`taskIdentifier`)대로. 넘긴 순서를 테스트가 본다.
    func pendingTasksInOrder() async -> [BackgroundClipTask] {
        guard let urlSession = lock.withLock({ _session }) else { return [] }
        return await urlSession.allTasks
            .sorted { $0.taskIdentifier < $1.taskIdentifier }
            .compactMap { BackgroundClipTask.decode($0.taskDescription) }
    }

    /// 테스트 정리용 — 만든 세션을 닫는다.
    func invalidateForTesting() {
        let existing = lock.withLock { () -> URLSession? in
            let value = _session
            _session = nil
            return value
        }
        existing?.invalidateAndCancel()
        defaults.removeObject(forKey: batchKey)
    }
}

/// 시스템이 준 완료 핸들러를 delegate 큐에서 메인으로 건네는 상자. 핸들러는 `Sendable` 표기가 없지만 **메인에서 한 번만**
/// 부른다(UIKit 계약) — 그 조건을 이 상자가 지킨다.
private final class CompletionBox: @unchecked Sendable {
    private let handler: () -> Void
    init(_ handler: @escaping () -> Void) { self.handler = handler }
    @MainActor func call() { handler() }
}
