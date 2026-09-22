import Foundation
import XCTest
@testable import AlarmTalk

/// **`loadStockClips` 가 공개 경합에서 물러나도 이긴 매니페스트를 싣는다**(코덱스 #789).
///
/// 콜드 스타트·로그인에서 `AlarmTalkApp` 의 계정 키 `.task`(프리페처 `start`, 표 N+1)와 언어 키
/// `.task`(`loadStockClips(force: true)`, 표 N)가 같은 엔드포인트를 거의 동시에 부른다. 뒤 표가
/// 먼저 공개되면 앞 표의 `save` 는 `.superseded` 다. 예전에는 그때 그냥 돌아가서 `stockClips` 가
/// 비거나 낡은 채였고, 곧이어 도는 재바인딩이 옛 카탈로그로 돌았다. 디스크는 이미 이긴 쪽이라
/// 그걸 메모리에 싣고, 더 새 응답이 이 세션에서 공개된 것이므로 '새로 받았다' 로 친다.
///
/// 네트워크는 타지 않는다 — `URLProtocol` 스텁(`StockClipPrefetcherSupersededTests` 와 같은 방식).
@MainActor
final class VoiceStudioLoadStockClipsSupersededTests: XCTestCase {
    private static let host = "stock-vm-superseded.example.test"
    private let ownerID = "owner-vm-superseded"

    private var session: AuthSession {
        AuthSession(token: "token-vm-superseded", user: AuthUser(id: ownerID, email: "test@example.test"))
    }

    override func setUpWithError() throws {
        StockClipManifestStore.clear()
        VMSupersededManifestURLProtocol.reset()
    }

    override func tearDownWithError() throws {
        VMSupersededManifestURLProtocol.reset()
        StockClipManifestStore.clear()
    }

    private func systemClip(_ messageID: String) -> StockClip {
        StockClip(
            messageId: messageID,
            voiceProfileId: systemVoiceIDPrefix + "000000000001",
            voiceName: nil,
            category: "weather",
            language: "ko",
            text: "오늘은 맑아요",
            audioUrl: "https://r2.example/\(messageID).mp3",
            variant: nil,
            renderedForCurrentVoice: nil
        )
    }

    private func manifest(_ messageIDs: [String]) -> StockClipListResponse {
        StockClipListResponse(clips: messageIDs.map(systemClip), expectedVariants: nil, legacyBucketHints: nil)
    }

    private func makeViewModel() -> VoiceStudioViewModel {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [VMSupersededManifestURLProtocol.self]
        return VoiceStudioViewModel(api: AlarmTalkAPI(
            baseURL: URL(string: "https://\(Self.host)/api/")!,
            session: URLSession(configuration: configuration)
        ))
    }

    func test_뒤_표가_먼저_공개되면_이긴_매니페스트를_싣고_새로_받은_것으로_친다() async {
        let loser = manifest(["loser-1"])
        let winner = manifest(["winner-1", "winner-2"])
        let session = self.session
        VMSupersededManifestURLProtocol.configure(manifestResponse: loser) {
            // 뷰모델의 표(N)는 이미 뽑혀 요청 중이다 — 그 사이 표 N+1 을 뽑아 **먼저** 공개한다.
            let later = StockClipManifestStore.beginFetch(session: session)
            _ = StockClipManifestStore.save(winner, ticket: later)
        }

        let viewModel = makeViewModel()
        let fetched = await viewModel.loadStockClips(session: session, force: true)

        XCTAssertEqual(viewModel.stockClips.map(\.messageId), ["winner-1", "winner-2"],
                       "물러난 회차도 디스크의 이긴 매니페스트를 메모리에 실어야 한다 — 재바인딩이 이걸 본다")
        XCTAssertTrue(fetched, "더 새 응답이 이 세션에서 공개됐으니 '새로 받았다' 다")
        XCTAssertEqual(StockClipManifestStore.load(ownerUserID: ownerID)?.clips.map(\.messageId),
                       ["winner-1", "winner-2"], "진 응답이 디스크를 덮지 않았다")
    }

    func test_표가_무효화돼_밀린_경우는_디스크를_싣되_새로_받은_것은_아니다() async {
        let seeded = manifest(["seeded-1"])
        let late = manifest(["late-1"])
        let session = self.session
        // 지난 세션이 남긴 디스크 매니페스트.
        let seed = StockClipManifestStore.beginFetch(session: session)
        XCTAssertEqual(StockClipManifestStore.save(seeded, ticket: seed), .published)
        VMSupersededManifestURLProtocol.configure(manifestResponse: late) {
            // 응답이 오기 전에 표가 무효화된다(같은 계정 시작의 `clear(preservingOwnerUserID:)`).
            StockClipManifestStore.clear(preservingOwnerUserID: session.user.id)
        }

        let viewModel = makeViewModel()
        let fetched = await viewModel.loadStockClips(session: session, force: true)

        XCTAssertEqual(viewModel.stockClips.map(\.messageId), ["seeded-1"], "디스크 권위를 싣는다")
        XCTAssertFalse(fetched, "무효화로 밀린 것은 신선함의 근거가 아니다 — 교체 확정에 쓰면 안 된다")
    }
}

/// 매니페스트 응답 직전에 훅을 돌린다(경합 재현). 그 외 요청은 404.
private final class VMSupersededManifestURLProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    private nonisolated(unsafe) static var manifestJSON = Data()
    private nonisolated(unsafe) static var beforeManifestResponse: (@Sendable () -> Void)?

    static func configure(
        manifestResponse: StockClipListResponse,
        beforeManifestResponse: (@Sendable () -> Void)?
    ) {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        let json = (try? encoder.encode(manifestResponse)) ?? Data()
        lock.lock()
        defer { lock.unlock() }
        manifestJSON = json
        self.beforeManifestResponse = beforeManifestResponse
    }

    static func reset() {
        lock.lock()
        defer { lock.unlock() }
        manifestJSON = Data()
        beforeManifestResponse = nil
    }

    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.host == "stock-vm-superseded.example.test"
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let components = request.url?.pathComponents ?? []
        guard components.last == "stock-clips" else {
            respond(status: 404, body: Data("{}".utf8))
            return
        }
        Self.lock.lock()
        let hook = Self.beforeManifestResponse
        let body = Self.manifestJSON
        Self.lock.unlock()
        hook?()
        respond(status: 200, body: body)
    }

    private func respond(status: Int, body: Data) {
        let response = HTTPURLResponse(
            url: request.url!, statusCode: status, httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
