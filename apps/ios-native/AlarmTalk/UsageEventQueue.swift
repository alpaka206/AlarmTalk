import Foundation

/// 남기는 사건의 종류. **서버 화이트리스트와 같은 값**이어야 한다
/// (`packages/shared/src/schemas/usage-event.ts`) — 모르는 값은 서버가 배치째 거절한다.
enum UsageEventType: String, Codable {
    case alarmCreated = "alarm_created"
    case alarmUpdated = "alarm_updated"
    case alarmDeleted = "alarm_deleted"
    case alarmRang = "alarm_rang"
    case alarmDismissed = "alarm_dismissed"
    case alarmSnoozed = "alarm_snoozed"
    /// 직접 입력 문구를 알람에 붙였다 = 그 오디오가 이 기기에서 '사용중'이 됐다.
    case manualMessageAttached = "manual_message_attached"
    /// 그 문구를 쓰는 알람이 이 기기에서 모두 사라져 오디오를 지웠다 = '비사용중'.
    case manualMessageReleased = "manual_message_released"
    case voiceCreated = "voice_created"
    case voiceDeleted = "voice_deleted"

    // ── 2판(`docs/spec/usage-events.md` §7). 서버는 처리방침 8판 동의 뒤의 사건만 2판으로 저장한다(§7.5). ──
    /// 샘플(목소리 미리듣기)이 **실제로 재생을 시작**했다. 화면 노출이 아니다.
    case sampleStarted = "sample_started"
    /// 샘플이 **끝까지** 재생됐다. 중간에 멈추면 적지 않는다.
    case sampleCompleted = "sample_completed"
    case onboardingStep = "onboarding_step"
    /// 로그인 결과. 계정이 생긴 **뒤**에만 적힌다 — 가입 전 수집은 하지 않는다(§7.4).
    case authResult = "auth_result"
    /// 편집기에서 목소리를 **골랐다**(미리 골라 둔 값은 아니다).
    case voiceSelected = "voice_selected"
    /// 음성 준비 — **작업 소유자(`StockClipPrefetcher`) 한 곳에서만** 적는다(§7.3).
    case voicePreparationStarted = "voice_preparation_started"
    case voicePreparationReady = "voice_preparation_ready"
    case voicePreparationFailed = "voice_preparation_failed"
    /// 저장을 눌렀다 / 요청 전에 막혔다 / AlarmKit 예약과 오디오 파일이 **둘 다** 갖춰졌다.
    /// ⚠ `alarmCreated` 는 '행이 생겼다' 이고 저장 시도가 아니다.
    case alarmSaveAttempt = "alarm_save_attempt"
    case alarmSaveBlocked = "alarm_save_blocked"
    case alarmReady = "alarm_ready"
    case manualResultReused = "manual_result_reused"
    case generationOutcome = "generation_outcome"
    /// 광고 보상 — iOS 에는 아직 광고 보상 흐름이 없다(안드로이드만). 계약을 맞춰 둘 뿐 심은 곳이 없다.
    case rewardOffer = "reward_offer"
    case rewardViewStarted = "reward_view_started"
    case rewardPending = "reward_pending"
    case rewardGranted = "reward_granted"
    case rewardSpent = "reward_spent"
    /// 콘텐츠·소식 — `contentSelected` 는 알람 저장 성공(`CheerVariety.contentSelectionProps`), 소식 셋은 `BriefingUsageSignals`.
    /// `datedAlarmSaved`·`packSelected` 는 스키마만 — 그 기능 PR 이 심는다. 관심기업·기사 원문·URL 을 싣지 않는다.
    case contentSelected = "content_selected"
    case datedAlarmSaved = "dated_alarm_saved"
    case packSelected = "pack_selected"
    case briefingOpened = "briefing_opened"
    case sourceOpened = "source_opened"
    case briefingAudioRequested = "briefing_audio_requested"
    case paywallViewed = "paywall_viewed"
    case storePurchaseVerified = "store_purchase_verified"
    case entitlementChanged = "entitlement_changed"
}

/// 2판 기록의 **정해진 칸**(`UsageEventPropsSchema` 와 한 쌍 — 칸 이름이 곧 키다). 전부 비어 있을 수 있다.
///
/// ⚠ **문구 원문·이름·이메일·기사 원문을 넣을 칸은 없다.** 코드 칸은 영문 소문자 코드만 받는다 — [sanitized] 가
/// 모양을 맞추고, 맞출 수 없으면 비운다. 서버는 모양이 틀린 칸 하나로 **배치째 400** 을 주고, 그러면 큐의 맨 앞
/// 배치가 영영 못 올라간다(성공한 배치만 지우므로). 그래서 적는 순간에 다듬는다.
struct UsageEventProps: Codable, Equatable, Sendable {
    enum Scope: String, Codable, Sendable {
        case selectedVoice = "selected_voice"
        case allVoices = "all_voices"
        case bucket
        case clip
    }

    enum CacheState: String, Codable, Sendable { case cold, partial, warm }
    enum Outcome: String, Codable, Sendable { case success, failure, cancelled }
    enum ReuseLocation: String, Codable, Sendable { case local, server }
    enum ChargedSource: String, Codable, Sendable { case base, ad, none }
    enum ContentMode: String, Codable, Sendable { case fixed, varied }
    enum StoreOffer: String, Codable, Sendable {
        case freeTrial = "free_trial"
        case intro, none, unknown
    }

    var scope: Scope?
    var language: String?
    var revision: String?
    var cacheState: CacheState?
    var targetCount: Int?
    var completedCount: Int?
    var bytes: Int?
    /// **단조 시계**(`ContinuousClock`)로 잰 밀리초. 벽시계 차이가 아니다.
    var durationMs: Int?
    var errorCode: String?
    var outcome: Outcome?
    var reason: String?
    var method: String?
    var step: String?
    var packID: String?
    var isFirst: Bool?
    var prepared: Bool?
    var reuseLocation: ReuseLocation?
    var chargedSource: ChargedSource?
    var usageMonth: String?
    var resultID: String?
    var requestID: String?
    var charCount: Int?
    var contentMode: ContentMode?
    var surface: String?
    var productID: String?
    var storeOffer: StoreOffer?
    var fromPlan: String?
    var toPlan: String?

    enum CodingKeys: String, CodingKey {
        case scope, language, revision, bytes, outcome, reason, method, step, prepared, surface
        case cacheState = "cache_state"
        case targetCount = "target_count"
        case completedCount = "completed_count"
        case durationMs = "duration_ms"
        case errorCode = "error_code"
        case packID = "pack_id"
        case isFirst = "is_first"
        case reuseLocation = "reuse_location"
        case chargedSource = "charged_source"
        case usageMonth = "usage_month"
        case resultID = "result_id"
        case requestID = "request_id"
        case charCount = "char_count"
        case contentMode = "content_mode"
        case productID = "product_id"
        case storeOffer = "store_offer"
        case fromPlan = "from_plan"
        case toPlan = "to_plan"
    }

    /// 서버 스키마의 모양·범위에 맞춘 사본. 코드는 소문자로 바꾸고 허용 밖 글자를 `_` 로 바꾸며, 맞출 수 없는 값은 비운다.
    func sanitized() -> UsageEventProps {
        var copy = self
        copy.language = language.flatMap { Self.matches($0, #"^[a-z]{2}(-[A-Z]{2})?$"#) ? $0 : nil }
        copy.revision = revision.flatMap(Self.code)
        copy.errorCode = errorCode.flatMap(Self.code)
        copy.reason = reason.flatMap(Self.code)
        copy.method = method.flatMap(Self.code)
        copy.step = step.flatMap(Self.code)
        copy.packID = packID.flatMap(Self.code)
        copy.surface = surface.flatMap(Self.code)
        copy.fromPlan = fromPlan.flatMap(Self.code)
        copy.toPlan = toPlan.flatMap(Self.code)
        copy.productID = productID.flatMap { Self.matches($0, #"^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$"#) ? $0 : nil }
        copy.usageMonth = usageMonth.flatMap { Self.matches($0, #"^\d{4}-(0[1-9]|1[0-2])$"#) ? $0 : nil }
        copy.resultID = resultID.flatMap(Self.uuid)
        copy.requestID = requestID.flatMap(Self.uuid)
        copy.targetCount = targetCount.map { Self.clamp($0, 100_000) }
        copy.completedCount = completedCount.map { Self.clamp($0, 100_000) }
        copy.bytes = bytes.map { Self.clamp($0, 10_000_000_000) }
        copy.durationMs = durationMs.map { Self.clamp($0, 7 * 24 * 3_600_000) }
        copy.charCount = charCount.map { Self.clamp($0, 10_000) }
        return copy
    }

    /// 영문 소문자 코드(`^[a-z0-9][a-z0-9_.-]{0,63}$`)로 다듬는다. 앞 글자가 맞지 않거나 비면 nil.
    static func code(_ raw: String) -> String? {
        let allowed = Set("abcdefghijklmnopqrstuvwxyz0123456789_.-")
        let mapped = String(raw.lowercased().map { allowed.contains($0) ? $0 : "_" }.prefix(64))
        guard let first = mapped.first, first.isASCII, first.isLetter || first.isNumber else { return nil }
        return mapped
    }

    /// 서버 `z.string().uuid()` 가 받는 꼴만(버전 1~8, 변형 8·9·a·b).
    static func uuid(_ raw: String) -> String? {
        matches(raw, #"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"#) ? raw : nil
    }

    private static func clamp(_ value: Int, _ upper: Int) -> Int { min(max(value, 0), upper) }

    private static func matches(_ value: String, _ pattern: String) -> Bool {
        value.range(of: pattern, options: .regularExpression) != nil
    }
}

/// 2판 공통 값.
enum UsageEventContract {
    static let schemaVersion = 2

    /// **적는 순간의** 앱 빌드 번호(`CFBundleVersion`). 서버 모양에 안 맞으면 비운다.
    static let appVersion: String? = {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String else { return nil }
        return version(raw)
    }()

    /// 서버의 버전 칸 모양(`^[0-9A-Za-z][0-9A-Za-z._-]{0,31}$`).
    static func version(_ raw: String) -> String? {
        raw.range(of: #"^[0-9A-Za-z][0-9A-Za-z._-]{0,31}$"#, options: .regularExpression) != nil ? raw : nil
    }

    /// 실패를 **제한된 코드**로 — 서버 `error_code` 는 소문자로, 그 밖은 몇 가지 고정 코드로만. 오류 문장은 싣지 않는다.
    static func errorCode(for error: Error) -> String {
        if let apiError = error as? APIError {
            switch apiError {
            case .server(let status, _, let code):
                return code.flatMap(UsageEventProps.code) ?? "http_\(String(status))"
            case .invalidResponse:
                return "invalid_response"
            }
        }
        if error is URLError { return "network" }
        if error is CancellationError { return "cancelled" }
        return "unknown"
    }

    /// 한 시도를 묶는 UUID(시작·완료·실패가 같은 값을 쓴다).
    static func newAttemptID() -> String { UUID().uuidString }

    /// 단조 시계로 잰 경과(밀리초) — 잠든 사이에도 흐르는 `ContinuousClock`.
    static func elapsedMs(since start: ContinuousClock.Instant, now: ContinuousClock.Instant = .now) -> Int {
        let elapsed = now - start
        let ms = Double(elapsed.components.seconds) * 1000 + Double(elapsed.components.attoseconds) / 1e15
        return max(0, Int(ms))
    }
}

/// 아직 못 보낸 사용 기록 한 건.
///
/// ⚠ **개인 텍스트를 담지 않는다.** 문구 원문은 이미 알람에 있고, 여기 사본을 만들면
/// 목소리 삭제·동의 철회 때 지워야 할 곳이 하나 더 늘어난다 — 식별자만 담는다.
struct QueuedUsageEvent: Codable, Identifiable, Equatable {
    /// 기기가 만드는 UUID. **서버 PK 와 같은 값**이라 재전송해도 겹치지 않는다(멱등).
    let id: String
    let type: UsageEventType
    /// 기기에서 **일어난** 시각. 며칠 늦게 보내도 이 값이 진실이다.
    let occurredAt: Date
    var alarmID: String?
    var voiceProfileID: String?
    var messageID: String?
    var detail: String?
    /// 어느 계정에서 남겼는가. 계정이 바뀌면 남은 큐를 새 주인 이름으로 보내지 않는다.
    var userID: String?
    // ── 2판 공통 필드. 옛 큐 파일에는 이 키가 없다 — 비어 디코드되어 1판으로 올라간다. ──
    var schemaVersion: Int?
    /// **적는 순간의** 빌드 번호. 큐는 업데이트를 건너 남으므로 보내는 앱의 버전과 다를 수 있다.
    var appVersion: String?
    var featureVersion: String?
    var attemptID: String?
    var props: UsageEventProps?
}

/// 사용 기록을 **파일에 쌓아 두는** 큐. 보내는 일은 `UsageEventUploader` 가 한다.
///
/// ⚠ **울릴 때 네트워크를 부르지 않는다**(CLAUDE.md 「Real alarm」). 알람 경로는 로컬·
/// 오프라인이 원칙이라, 울림은 여기 적기만 하고 전송은 그 뒤 아무 때나 한다.
///
/// ⚠ **기록 실패가 본업을 막지 않는다.** 알람을 만들고 지우고 울리는 것이 본업이고 기록은
/// 곁다리다 — 모든 경로가 실패를 삼키고 로그만 남긴다. 안드로이드 `UsageEventRecorder` 와
/// 같은 규칙이다.
final class UsageEventQueue: @unchecked Sendable {
    static let shared = UsageEventQueue()

    /// 큐 상한. 넘치면 **가장 오래된 것부터** 버린다 — 기록은 있으면 좋은 것이지 알람의
    /// 조건이 아니라, 몇 달치가 밀려 저장소를 먹는 것보다 오래된 몇 건을 잃는 편이 낫다.
    private let limit = 2000

    private let fileURL: URL
    /// 파일 접근을 직렬화한다. 기록은 아무 스레드에서나 들어온다(울림 서비스·편집기·동기화).
    private let queue = DispatchQueue(label: "com.alarmtalk.usage-events")

    /// 지금 로그인한 계정. **기록기가 스스로 채운다 — 부르는 쪽에 맡기지 않는다.**
    /// 호출부마다 넘기게 하면 언젠가 빠뜨리고, 빠진 행은 계정이 비어 있어 **다음에
    /// 로그인한 사람의 기록으로** 올라간다(서버는 토큰의 주인으로 적는다 — 되돌릴 수 없다).
    /// 안드로이드 `UsageEventRecorder(currentUserId)` 와 같은 자리다.
    private let currentUserID: @Sendable () -> String?

    init(
        fileURL: URL? = nil,
        currentUserID: @escaping @Sendable () -> String? = { KeychainStore.readSession()?.user.id }
    ) {
        self.currentUserID = currentUserID
        if let fileURL {
            self.fileURL = fileURL
        } else {
            let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            self.fileURL = directory.appendingPathComponent("usage-events.json")
        }
    }

    /// 사건 하나를 적는다. **부르는 쪽을 기다리게 하지 않는다.**
    func record(
        _ type: UsageEventType,
        alarmID: String? = nil,
        voiceProfileID: String? = nil,
        messageID: String? = nil,
        detail: String? = nil,
        attemptID: String? = nil,
        featureVersion: String? = nil,
        props: UsageEventProps? = nil,
        userID: String? = nil,
        occurredAt: Date = Date(),
        /// **파일에 적힌 뒤**에 부른다(실패하면 부르지 않는다). 큐 스레드에서 온다.
        ///
        /// 이 큐는 무엇을 위한 신호인지 모른다 — "이 배치가 디스크에 남았다" 만 알린다.
        /// 부르는 쪽이 그 사실에 무엇을 매다는지는 그쪽 사정이다(iOS 울림 표시 등).
        onPersisted: (@Sendable () -> Void)? = nil
    ) {
        let trimmedDetail = detail.map { String($0.prefix(120)) }
        let cleanProps = props?.sanitized()
        let cleanAttemptID = attemptID.flatMap(UsageEventProps.uuid)
        let cleanFeatureVersion = featureVersion.flatMap(UsageEventContract.version)
        // 계정은 **적는 순간**에 정한다 — 파일 쓰기가 실제로 도는 시점이 아니라.
        // 큐 안에서 읽으면 그 틈에 로그아웃·로그인이 끼어들 때 A 의 사건이 B 의 이름으로
        // 저장된다(서버는 토큰의 주인으로 적으므로 되돌릴 수 없다).
        // `userID` 는 **덮어쓰기용**이다 — 편집기처럼 메모리에 든 세션이 더 정확한 자리
        // (Keychain 쓰기가 실패해도 세션은 살아 있다)만 넘긴다. `??` 라 그 자리는
        // 키체인을 읽지도 않는다.
        //
        // ⚠ **계정을 모르면 적지 않는다.** 비워 두면 다음에 로그인한 사람의 기록으로
        // 올라간다 — 서버는 토큰의 주인으로 적고(배치에 계정이 실리지 않는다) `user_id` 는
        // NOT NULL 이라, 주인 없는 사건은 **어차피 올바르게 올릴 방법이 없다.**
        // 잃는 것은 로그아웃 구간(자동 401 로 세션만 잃은 구간 포함)의 사건 몇 건이다.
        guard let resolvedUserID = (userID ?? currentUserID())?.nilIfBlank else { return }
        queue.async { [weak self] in
            guard let self else { return }
            let event = QueuedUsageEvent(
                id: UUID().uuidString,
                type: type,
                occurredAt: occurredAt,
                alarmID: alarmID,
                voiceProfileID: voiceProfileID,
                messageID: messageID,
                detail: trimmedDetail,
                userID: resolvedUserID,
                schemaVersion: UsageEventContract.schemaVersion,
                appVersion: UsageEventContract.appVersion,
                featureVersion: cleanFeatureVersion,
                attemptID: cleanAttemptID,
                props: cleanProps
            )
            var events = self.loadLocked()
            events.append(event)
            if events.count > self.limit {
                events.removeFirst(events.count - self.limit)
            }
            guard self.saveLocked(events) else { return }
            onPersisted?()
        }
    }

    /// 보낼 것들을 오래된 순으로 꺼낸다(지우지는 않는다 — 성공한 뒤에 [remove] 를 부른다).
    func oldest(userID: String, limit: Int) -> [QueuedUsageEvent] {
        queue.sync {
            loadLocked()
                // 주인 없는 행은 보내지 않는다 — 이제 그런 행을 만들지도 않는다(위 `record`).
                // 남아 있다면 옛 빌드가 남긴 것이고, 그걸 지금 사람에게 붙이면 안 된다.
                .filter { $0.userID == userID }
                .sorted { $0.occurredAt < $1.occurredAt }
                .prefix(limit)
                .map { $0 }
        }
    }

    /// 서버가 받은 것만 지운다. 실패한 배치는 남아 다음 기회에 그대로 다시 간다.
    func remove(ids: Set<String>) {
        queue.async { [weak self] in
            guard let self else { return }
            self.saveLocked(self.loadLocked().filter { !ids.contains($0.id) })
        }
    }

    var count: Int { queue.sync { loadLocked().count } }

    // MARK: - 파일

    private func loadLocked() -> [QueuedUsageEvent] {
        guard let data = try? Data(contentsOf: fileURL) else { return [] }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return (try? decoder.decode([QueuedUsageEvent].self, from: data)) ?? []
    }

    /// @return 실제로 파일에 남았으면 true. **실패를 삼키지 않는다** — 못 남긴 것을 남긴
    /// 것으로 알리면(위 `onPersisted`) 적히지 않은 울림을 적힌 것으로 오인해 삼킨다.
    @discardableResult
    private func saveLocked(_ events: [QueuedUsageEvent]) -> Bool {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(events) else { return false }
        do {
            try data.write(to: fileURL, options: .atomic)
            return true
        } catch {
            return false
        }
    }
}
