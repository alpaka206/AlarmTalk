import Foundation

// MARK: - CharacterEventPersistence
//
// Room DAO 대용 — JSON 단일 파일에 events 배열을 atomic write 한다. 알람 큐는
// 데일리 단위로만 누적되므로 (event 당 1 row / day / alarm) 수 ~ 수십 row 수준이며,
// 분단위 sync 가 아니라 앱 활성화/포그라운드 진입 시점 sync 라 JSON 으로 충분.
//
// `actor` 로 격리해 store mutation 과 디스크 I/O 가 직렬화되도록 한다.
actor CharacterEventPersistence {
    let url: URL

    init(url: URL) {
        self.url = url
    }

    init() {
        let dir = (try? FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )) ?? FileManager.default.temporaryDirectory
        self.url = dir.appendingPathComponent("character-events.json")
    }

    static var `default`: CharacterEventPersistence { CharacterEventPersistence() }

    func save(events: [CharacterEventEntity]) async {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        guard let data = try? encoder.encode(events) else { return }
        try? data.write(to: url, options: .atomic)
    }

    func load() async -> [CharacterEventEntity] {
        guard let data = try? Data(contentsOf: url) else { return [] }
        let decoder = JSONDecoder()
        guard let events = try? decoder.decode([CharacterEventEntity].self, from: data) else {
            // 손상된 파일은 graceful degradation — Android Room 의 migration 실패 시
            // 빈 테이블로 시작하는 동작과 동일. nonce 가 서버에 살아 있으면 duplicated=true
            // 로 멱등 처리되므로 데이터 손실 시에도 더블 grant 는 발생하지 않는다.
            return []
        }
        return events
    }
}

// MARK: - CharacterXPGranting
//
// API 의존성을 protocol 로 분리해 테스트 시 mock 주입을 자명하게 만든다.
// 실제 구현은 `VoiceAlarmAPI` 의 extension 으로 conform.
// `Sendable` — MainActor 격리된 store 가 async 컨텍스트로 api 를 캡처할 때 race
// 경고를 피하기 위해. 실제 conformer 인 `VoiceAlarmAPI` 는 `@unchecked Sendable`.
protocol CharacterXPGranting: AnyObject, Sendable {
    func grantCharacterXP(
        event: String,
        clientNonce: String,
        localDate: String,
        token: String
    ) async throws -> CharacterGrantResponse
}

// MARK: - CharacterEventStore
//
// Android `CharacterEventRepository` + `CharacterEventSyncService` 합본의 iOS 포팅.
// MainActor 격리 — `@Published` 상태 변경과 protocol conformance (`@MainActor`
// `CharacterEventQueueing`) 모두 main thread 에서 일어나야 함.
//
// 큐 / 재시도 동작:
//   1. queue(...)            : nonce 멱등 확인 → 신규면 PENDING 으로 추가 → flush 트리거.
//   2. flushPending()        : 진행 중이면 즉시 return (중첩 호출 방지). PENDING + FAILED
//                              를 fetch 해 순차 grantCharacterXP. 성공 (200, duplicated 포함)
//                              은 SYNCED, throw 는 FAILED + attempts +1 + lastError.
//   3. Android 와의 차이      : iOS 는 별도 Worker 없이 SwiftUI Scene phase 변화와
//                              auth.session 토큰 발급/회전 시 flush. 자세한 trigger 는
//                              `VoiceAlarmApp.swift` `.task(id:)` / `.onChange(of: scenePhase)`.
//
// 멱등 nonce 정책:
//   - 외부 호출자 (AlarmAppContext) 가 nonce 를 만들어 전달한다. 호출자 책임으로 한 이유는
//     `AlarmAppContext.handleAlarmStopped` 가 `record.id-stop-fireAtMillis` 처럼 더 풍부한
//     컨텍스트 (회차 단위 멱등) 를 알고 있고, store 는 그것을 그대로 신뢰해야 두 경로
//     (LiveActivity Intent + alarmUpdates loop) 가 같은 stop 을 emit 해도 1회만 처리되기 때문.
//   - 보조용으로 Android `CharacterEventRepository.queue` 와 같은 알고리즘의
//     `buildClientNonce(alarmID:eventType:occurredAtMillis:timezone:)` 를 static 으로 노출.
//     수동 grant 경로 또는 디버그 호출에서 사용.
@MainActor
final class CharacterEventStore: ObservableObject {
    @Published private(set) var events: [CharacterEventEntity] = []
    @Published private(set) var isFlushing: Bool = false
    @Published private(set) var lastFlushSummary: FlushSummary?

    struct FlushSummary: Equatable, Sendable {
        let total: Int
        let synced: Int
        let failed: Int
        let skipped: Int
        let finishedAtMillis: Int64
    }

    typealias TokenProvider = @MainActor () -> String?

    private let api: CharacterXPGranting
    private let tokenProvider: TokenProvider
    private let persistence: CharacterEventPersistence
    private let calendarTimeZone: TimeZone
    private var nowProvider: () -> Date

    init(
        api: CharacterXPGranting,
        tokenProvider: @escaping TokenProvider,
        persistence: CharacterEventPersistence = .default,
        timeZone: TimeZone = .current,
        nowProvider: @escaping () -> Date = { Date() }
    ) {
        self.api = api
        self.tokenProvider = tokenProvider
        self.persistence = persistence
        self.calendarTimeZone = timeZone
        self.nowProvider = nowProvider
    }

    /// 초기 로드. `VoiceAlarmApp` `.task` 에서 1회 호출해 디스크 → 메모리 hydrate.
    func loadFromDisk() async {
        let loaded = await persistence.load()
        events = loaded
    }

    // MARK: - Public queue API

    /// 멱등 큐 진입점. 동일 `clientNonce` 가 이미 있으면 (state 무관) skip 한다.
    /// SYNCED 인 nonce 가 다시 들어와도 무시 — 서버는 duplicated=true 를 반환할
    /// 뿐이지만, 굳이 또 호출할 이유가 없다.
    func queue(
        eventType: CharacterEventType,
        occurredAtMillis: Int64,
        clientNonce: String,
        sourceAlarmId: String? = nil,
        context: [String: String]? = nil
    ) async {
        if events.contains(where: { $0.clientNonce == clientNonce }) {
            return
        }
        let contextJson = encodeContext(context)
        let now = Int64(nowProvider().timeIntervalSince1970 * 1000)
        let localDate = formatLocalDate(occurredAtMillis: occurredAtMillis)
        let entity = CharacterEventEntity(
            id: UUID().uuidString,
            eventType: eventType.rawValue,
            occurredAtMillis: occurredAtMillis,
            clientNonce: clientNonce,
            localDate: localDate,
            sourceAlarmId: sourceAlarmId,
            contextJson: contextJson,
            syncState: CharacterEventSyncState.pending.rawValue,
            attempts: 0,
            lastError: nil,
            createdAtMillis: now,
            syncedAtMillis: nil,
            updatedAtMillis: now
        )
        events.append(entity)
        let snapshot = events
        await persistence.save(events: snapshot)
        Task { await flushPending() }
    }

    // MARK: - Sync

    /// 백그라운드/포그라운드 재시도 진입점. token 이 없으면 즉시 return.
    /// 중복 호출은 isFlushing 가드로 한 번만 실행.
    @discardableResult
    func flushPending() async -> FlushSummary {
        if isFlushing {
            return lastFlushSummary ?? FlushSummary(
                total: 0,
                synced: 0,
                failed: 0,
                skipped: 0,
                finishedAtMillis: Int64(nowProvider().timeIntervalSince1970 * 1000)
            )
        }
        guard let token = tokenProvider() else {
            let summary = FlushSummary(
                total: 0,
                synced: 0,
                failed: 0,
                skipped: events.count,
                finishedAtMillis: Int64(nowProvider().timeIntervalSince1970 * 1000)
            )
            lastFlushSummary = summary
            return summary
        }
        isFlushing = true
        defer { isFlushing = false }

        let pending = events.filter { $0.syncState != CharacterEventSyncState.synced.rawValue }
        var syncedCount = 0
        var failedCount = 0

        for event in pending {
            do {
                let response = try await api.grantCharacterXP(
                    event: event.eventType,
                    clientNonce: event.clientNonce,
                    localDate: event.localDate,
                    token: token
                )
                // 서버가 duplicated=true 반환 시에도 처리 완료로 간주 — 다음 flush 에서
                // 다시 시도하면 의미 없는 네트워크 호출이 누적된다.
                _ = response
                if let idx = events.firstIndex(where: { $0.id == event.id }) {
                    let now = Int64(nowProvider().timeIntervalSince1970 * 1000)
                    events[idx].syncState = CharacterEventSyncState.synced.rawValue
                    events[idx].syncedAtMillis = now
                    events[idx].updatedAtMillis = now
                    events[idx].lastError = nil
                }
                syncedCount += 1
            } catch {
                if let idx = events.firstIndex(where: { $0.id == event.id }) {
                    let now = Int64(nowProvider().timeIntervalSince1970 * 1000)
                    events[idx].syncState = CharacterEventSyncState.failed.rawValue
                    events[idx].attempts += 1
                    events[idx].lastError = String(describing: error)
                    events[idx].updatedAtMillis = now
                }
                failedCount += 1
            }
        }

        let snapshot = events
        await persistence.save(events: snapshot)
        let summary = FlushSummary(
            total: pending.count,
            synced: syncedCount,
            failed: failedCount,
            skipped: 0,
            finishedAtMillis: Int64(nowProvider().timeIntervalSince1970 * 1000)
        )
        lastFlushSummary = summary
        return summary
    }

    // MARK: - Helpers (testable)

    /// 동일 알람 + 동일 이벤트 타입 + 동일 LocalDate 의 멱등 키.
    /// Android `CharacterEventRepository.queue` 의 `event:alarmId:localDate` 와 동일한
    /// 알고리즘 (구분자만 `-` 로 통일 — AlarmAppContext 가 `record.id-stop-...` 형식을
    /// 쓰는 것과 시각적으로 호환). 멱등성 자체는 store 가 `events.contains(where:)`
    /// 로 보장하므로 구분자 차이는 무관.
    /// Android parity: returns `event:alarmId:localDate`.
    static func buildClientNonce(
        alarmID: String,
        eventType: CharacterEventType,
        occurredAtMillis: Int64,
        timezone: TimeZone = .current
    ) -> String {
        let date = Date(timeIntervalSince1970: TimeInterval(occurredAtMillis) / 1000)
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timezone
        let comps = calendar.dateComponents([.year, .month, .day], from: date)
        let local = String(
            format: "%04d-%02d-%02d",
            comps.year ?? 1970,
            comps.month ?? 1,
            comps.day ?? 1
        )
        return "\(eventType.rawValue):\(alarmID):\(local)"
    }

    private func formatLocalDate(occurredAtMillis: Int64) -> String {
        let date = Date(timeIntervalSince1970: TimeInterval(occurredAtMillis) / 1000)
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = calendarTimeZone
        let comps = calendar.dateComponents([.year, .month, .day], from: date)
        return String(
            format: "%04d-%02d-%02d",
            comps.year ?? 1970,
            comps.month ?? 1,
            comps.day ?? 1
        )
    }

    private func encodeContext(_ context: [String: String]?) -> String? {
        guard let context, !context.isEmpty else { return nil }
        guard let data = try? JSONSerialization.data(
            withJSONObject: context,
            options: [.sortedKeys]
        ) else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }
}

// MARK: - CharacterEventQueueing conformance
//
// `AlarmAppContext` (Phase 2-B2) 가 사용하는 단일 진입점. 시그니처는 B2 의 protocol
// 정의를 그대로 따른다 — 절대 변경 금지.
extension CharacterEventStore: CharacterEventQueueing {
    func queueAlarmEvent(
        eventType: CharacterEventKind,
        occurredAtMillis: Int64,
        clientNonce: String,
        context: [String: String]?
    ) async {
        let mapped: CharacterEventType
        switch eventType {
        case .alarmCompleted:
            mapped = .alarmCompleted
        case .alarmSnoozed:
            mapped = .alarmSnoozed
        }
        let sourceAlarmId = context?["alarmId"]
        await queue(
            eventType: mapped,
            occurredAtMillis: occurredAtMillis,
            clientNonce: clientNonce,
            sourceAlarmId: sourceAlarmId,
            context: context
        )
    }
}
