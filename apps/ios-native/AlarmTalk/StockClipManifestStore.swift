import Foundation

/// 스톡 클립 매니페스트(클립 목록 + 카테고리별 기대 개수)를 **디스크에 남긴다.**
///
/// ⚠ **이게 없으면 '모른다' 라는 상태가 생기고, 관문과 저장이 정반대로 답한다**(2026-08-18).
/// - 관문(`AlarmEditorSheet.needsPreparation`)은 `expectedVariants == nil` 을 **'막지 않음'** 으로 읽고,
/// - 저장(`hasCompleteBucket`)은 같은 값을 `?: return false` 로 **'불완전'** 으로 읽는다.
///
/// 즉 매니페스트 요청이 한 번 실패한 세션에서는 **고를 수는 있는데 저장은 안 된다.** 둘 다
/// 메모리 상태라 그 세션 내내 그렇다. 지금은 라이브 랜덤 생성이 이 모순을 덮고 있어서
/// 드러나지 않을 뿐이다.
///
/// 같은 구멍이 오프라인 콜드스타트에서도 난다: 비행기모드로 앱을 **새로 켜면** 클립을 전부
/// 받아 둔 기기에서도 알람을 만들 수 없다 — 막는 것은 오디오가 아니라 메모리에 없는
/// 매니페스트다. 선다운로드가 약속한 "비행기모드에서도 내일 알람" 의 전제가 이것이다.
///
/// 그래서 판정을 한쪽으로 기울이는 대신 **'모른다' 상태 자체를 없앤다.**
///
/// 안드로이드 짝은 `data/StockClipManifestStore.kt` 다.
enum StockClipManifestStore {
    private static let storage = StockClipManifestStorage(fileURL:
        URL.applicationSupportDirectory.appendingPathComponent("stock-clip-manifest\(TestIsolation.storageSuffix).json")
    )

    /// 표는 **요청 전에** 뽑는다 — 그래야 늦게 끝난 옛 요청이 거절된다(안드로이드
    /// `StockClipPrefetchWorker` 의 `manifestTicket` 과 같은 순서).
    static func beginFetch(session: AuthSession) -> StockClipManifestStorage.Ticket {
        storage.beginFetch(session: session)
    }

    /// 매니페스트를 공개한다. 판정은 **표(revision)와 파일 임자**뿐이다.
    ///
    /// ⚠ **키체인 토큰을 대조하지 않는다**(2026-09-22 정정). 예전에는 표에 발급 당시
    /// 토큰을 실어 `KeychainStore.runIfCurrentSession(userID:token:)` 으로 걸렀는데, 그러면
    /// 롤링 갱신(`AuthViewModel.refreshUserApplyingToken` 이 `/auth/me` 응답의 새 토큰으로
    /// 갈아 끼운다)이 끼어드는 순간 **같은 계정의 멀쩡한 응답이 전부 `.superseded`** 가
    /// 됐다. 프리페처는 `start(session:)` 이 잡아 둔 세션으로 재시도하므로 한 번 굴러간 뒤에는
    /// 매 회차가 거절되고, 아무도 매니페스트를 공개하지 못한다.
    /// 계정 경계는 안드로이드(`data/StockClipManifestStore.kt`)와 같은 두 겹으로 지킨다:
    /// - **파일 임자**: 봉투에 `ownerUserID` 를 적고 `load(ownerUserID:)` 가 대조한다 — 다른
    ///   계정의 응답이 늦게 공개돼도 그 계정은 읽지 못한다.
    /// - **표 무효화**: 계정이 바뀌면 `clear` 가 수위선을 올려 떠 있던 표를 전부 거절한다
    ///   (`AlarmTalkApp` 의 `.task(id: auth.session?.user.id)` → `clearUserScopedRemoteState`).
    static func save(
        _ manifest: StockClipListResponse,
        ticket: StockClipManifestStorage.Ticket
    ) -> StockClipManifestStorage.PublishResult {
        storage.save(manifest, ticket: ticket)
    }

    static func load(ownerUserID: String? = KeychainStore.readSession()?.user.id) -> StockClipListResponse? {
        storage.load(ownerUserID: ownerUserID)
    }

    static func clear(preservingOwnerUserID: String? = nil) {
        storage.clear(preservingOwnerUserID: preservingOwnerUserID)
    }
}

final class StockClipManifestStorage: @unchecked Sendable {
    /// 조회 한 건의 표. **토큰은 싣지 않는다** — 이유는 `StockClipManifestStore.save` 주석.
    struct Ticket: Sendable {
        let ownerUserID: String
        let revision: UInt64
    }

    /// **거절과 실패를 구분한다**(안드로이드 `PublishResult` 와 같다).
    /// - `superseded`: 더 새 표가 이미 공개됐거나 `clear` 가 표를 무효화했다 — **정상 경합**이라
    ///   호출자는 물러나면 된다(디스크 권위가 이미 있다).
    /// - `failed`: 디스크 쓰기 실패. 아무도 공개하지 못한 상태라 **다시 시도해야** 한다.
    enum PublishResult { case published, superseded, failed }

    private struct Envelope: Codable {
        let ownerUserID: String
        let manifest: StockClipListResponse
    }

    private let fileURL: URL
    private let lock = NSLock()
    private var nextRevision: UInt64 = 0
    /// **여기까지의 응답은 이미 지나갔다**는 수위선. 안드로이드 `StockClipManifestStore.seenTicket` 과 같다.
    ///
    /// ⚠ **더 새 응답을 본 순간**(`save`) 올린다 — `beginFetch` 에서 올리지 않는다(코덱스 #788 3차에서
    /// 일부러 남긴 결정). 시작 시점에 올리면 "나중에 출발한 B 가 **네트워크에서** 실패했을 때" 먼저
    /// 출발한 A 의 멀쩡한 응답까지 버린다 — 그러면 아무도 공개하지 못해 이 파일 머리의 '모른다'
    /// 상태(고를 수는 있는데 저장은 안 됨)가 되살아난다. 그 경우 A 를 공개해도 디스크는 B 가
    /// 실패하지 않았을 때보다 나빠지지 않는다: B 는 목록을 받지 못했으니 새 세대의 바이트를
    /// 내려받는 일도 없고, 캐시 대조가 '되살아난 옛 주소' 를 기준으로 삼을 새 다운로드가 없다.
    /// 문제가 되는 것은 B 가 목록을 **받고 나서** 쓰기에 실패한 경우뿐이고, 그건 `save` 가
    /// 성패와 무관하게 수위선을 올려 막는다(`testFailedPublicationStillRejectsOlderResponse`).
    /// 회귀 테스트: `testNetworkFailureBeforeSaveKeepsOlderValidResponse`.
    private var seenRevision: UInt64 = 0
    private var cached: Envelope?
    private var quarantined = false

    init(fileURL: URL) { self.fileURL = fileURL }

    func beginFetch(session: AuthSession) -> Ticket {
        lock.lock()
        defer { lock.unlock() }
        nextRevision += 1
        return Ticket(ownerUserID: session.user.id, revision: nextRevision)
    }

    /// ⚠ **비교·쓰기·표 갱신이 한 임계구역이다**(안드로이드와 같다). 비교만 잠그면 두 writer 가
    /// 둘 다 통과한 뒤 쓰는 순서가 뒤집혀 옛 응답이 새 응답을 덮을 수 있다.
    func save(_ manifest: StockClipListResponse, ticket: Ticket) -> PublishResult {
        lock.lock()
        defer { lock.unlock() }
        guard ticket.revision >= seenRevision else { return .superseded }
        // 더 새 응답을 봤다 — 성패와 무관하게 수위선을 올린다(실패해도 옛 응답이 대신
        // 공개되면 안 된다. 그 옛 목록으로 캐시를 갈면 새 세대를 옛 바이트로 덮는다).
        seenRevision = ticket.revision
        let envelope = Envelope(ownerUserID: ticket.ownerUserID, manifest: manifest)
        do {
            try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try JSONEncoder().encode(envelope).write(to: fileURL, options: .atomic)
            cached = envelope
            quarantined = false
            return .published
        } catch {
            return .failed
        }
    }

    func load(ownerUserID: String?) -> StockClipListResponse? {
        lock.lock()
        defer { lock.unlock() }
        guard let ownerUserID, !quarantined else { return nil }
        if cached == nil, let data = try? Data(contentsOf: fileURL) {
            cached = try? JSONDecoder().decode(Envelope.self, from: data)
        }
        guard cached?.ownerUserID == ownerUserID else { return nil }
        return cached?.manifest
    }

    func clear(preservingOwnerUserID: String? = nil) {
        lock.lock()
        defer { lock.unlock() }
        seenRevision = nextRevision + 1
        if !quarantined, let preservingOwnerUserID,
           let data = try? Data(contentsOf: fileURL),
           let envelope = try? JSONDecoder().decode(Envelope.self, from: data),
           envelope.ownerUserID == preservingOwnerUserID {
            cached = envelope
            return
        }
        cached = nil
        quarantined = true
        try? FileManager.default.removeItem(at: fileURL)
    }
}
