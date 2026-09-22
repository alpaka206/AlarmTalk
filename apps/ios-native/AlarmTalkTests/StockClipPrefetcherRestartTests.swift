import Foundation
import XCTest
@testable import AlarmTalk

/// **선다운로드는 대상이 넓어질 때만 다시 시작한다**(코덱스 #788 4차 회귀 방지).
///
/// 콜드 스타트·로그인에서는 내 목소리 목록이 서버에서 오기 전이라 첫 `start` 는 기본 목소리만
/// 대상으로 돈다. 목록이 도착해 내 클론 id 를 실어 다시 부를 때 "이미 돌고 있다" 로 무시하면
/// 그 클론의 사전렌더 클립은 이 세션 내내 안 받아진다. 반대로 빈 집합으로 온 호출(계정 키
/// `.task`)이 넓은 회차를 끊으면 안 된다.
@MainActor
final class StockClipPrefetcherRestartTests: XCTestCase {
    private var prefetcher: StockClipPrefetcher?

    override func tearDown() {
        // 실패 회차는 30초를 자므로, 남겨 두면 다음 테스트까지 산다.
        prefetcher?.cancel()
        prefetcher = nil
    }

    private var session: AuthSession {
        AuthSession(token: "token-restart", user: AuthUser(id: "owner-restart", email: "test@example.test"))
    }

    /// 네트워크는 타지 않는다 — 닿을 수 없는 호스트라 회차는 곧바로 실패로 끝나고 30초를 잔다.
    private func makePrefetcher() -> StockClipPrefetcher {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [UnreachableURLProtocol.self]
        return StockClipPrefetcher(api: AlarmTalkAPI(
            baseURL: URL(string: "https://stock-restart.invalid/api/")!,
            session: URLSession(configuration: configuration)
        ))
    }

    func testShouldRestartOnlyWhenTargetsWiden() {
        XCTAssertFalse(StockClipPrefetcher.shouldRestart(running: [], requested: []))
        XCTAssertFalse(StockClipPrefetcher.shouldRestart(running: ["a"], requested: []))
        XCTAssertFalse(StockClipPrefetcher.shouldRestart(running: ["a", "b"], requested: ["a"]))
        XCTAssertTrue(StockClipPrefetcher.shouldRestart(running: [], requested: ["a"]))
        XCTAssertTrue(StockClipPrefetcher.shouldRestart(running: ["a"], requested: ["b"]))
    }

    func testWiderOwnedSetRestartsRunningPrefetchAndNarrowerCallIsIgnored() {
        let prefetcher = makePrefetcher()
        self.prefetcher = prefetcher
        prefetcher.start(session: session)
        XCTAssertEqual(prefetcher.runningOwnedVoiceProfileIDs, [])
        // 목록이 도착했다 — 넓어졌으니 다시 시작한다.
        prefetcher.start(session: session, ownedVoiceProfileIDs: ["clone-1"])
        XCTAssertEqual(prefetcher.runningOwnedVoiceProfileIDs, ["clone-1"])
        // 계정 키 `.task` 처럼 빈 집합으로 온 호출은 넓은 회차를 끊지 않는다.
        prefetcher.start(session: session)
        XCTAssertEqual(prefetcher.runningOwnedVoiceProfileIDs, ["clone-1"])
        // 더 넓어지면 합집합으로 다시 시작한다.
        prefetcher.start(session: session, ownedVoiceProfileIDs: ["clone-2"])
        XCTAssertEqual(prefetcher.runningOwnedVoiceProfileIDs, ["clone-1", "clone-2"])
        prefetcher.cancel()
        XCTAssertEqual(prefetcher.runningOwnedVoiceProfileIDs, [])
    }
}

/// 모든 요청을 즉시 연결 실패로 끝낸다.
private final class UnreachableURLProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        client?.urlProtocol(self, didFailWithError: URLError(.cannotConnectToHost))
    }
    override func stopLoading() {}
}
