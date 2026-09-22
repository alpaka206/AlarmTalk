import Foundation
import XCTest
@testable import AlarmTalk

@MainActor
final class AlarmCreationReplayTests: XCTestCase {
    private func create(replayed: Bool, patchStatus: Int = 200) async throws -> RemoteAlarm {
        CreationReplayURLProtocol.configure(replayed: replayed, patchStatus: patchStatus)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [CreationReplayURLProtocol.self]
        let api = AlarmTalkAPI(baseURL: URL(string: "https://alarm-replay.example.test/api/")!,
                               session: URLSession(configuration: configuration))
        let local = LocalAlarmRecord(id: UUID().uuidString, label: "test", hour: 9, minute: 30, fireAtMillis: 1)
        let request = RemoteAlarmMapper.toRemoteRequest(local)
        XCTAssertEqual(request.clientAlarmId, local.id)
        return try await api.createAlarm(request, token: "token")
    }

    func testReplayedCreationPatchesBeforeReportingSuccess() async throws {
        let remote = try await create(replayed: true)
        XCTAssertEqual(remote.id, "remote")
        XCTAssertEqual(CreationReplayURLProtocol.methods, ["POST", "PATCH"])
    }

    func testFreshCreationDoesNotAddAnotherRequest() async throws {
        _ = try await create(replayed: false)
        XCTAssertEqual(CreationReplayURLProtocol.methods, ["POST"])
    }

    func testFailedReplayPatchIsNotReportedAsSynced() async {
        do {
            _ = try await create(replayed: true, patchStatus: 503)
            XCTFail("PATCH가 실패하면 생성도 완료로 보고하지 않는다")
        } catch {
            guard case APIError.server(503, _, _) = error else { return XCTFail("unexpected error: \(error)") }
        }
    }
}

private final class CreationReplayURLProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    private nonisolated(unsafe) static var replayed = false
    private nonisolated(unsafe) static var patchStatus = 200
    private nonisolated(unsafe) static var requests: [String] = []

    static var methods: [String] {
        lock.lock()
        defer { lock.unlock() }
        return requests
    }

    static func configure(replayed: Bool, patchStatus: Int) {
        lock.lock()
        defer { lock.unlock() }
        self.replayed = replayed
        self.patchStatus = patchStatus
        requests = []
    }

    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "alarm-replay.example.test" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.lock.lock()
        Self.requests.append(request.httpMethod ?? "")
        let replay = Self.replayed
        let status = request.httpMethod == "PATCH" ? Self.patchStatus : 201
        Self.lock.unlock()
        let body = status < 300
            ? "{\"alarm\":{\"id\":\"remote\",\"creation_replayed\":\(replay)}}"
            : "{\"error\":\"unavailable\"}"
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status,
            httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
