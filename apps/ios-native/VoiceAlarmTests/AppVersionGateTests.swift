import XCTest
@testable import VoiceAlarm

@MainActor
final class AppVersionGateTests: XCTestCase {
    func test_updateRequired_whenInstalledBelowMinSupported() async {
        let api = MockAppVersionAPI()
        api.result = .success(AppVersionResponse(minSupportedVersion: 5, storeUrl: "https://apps.apple.com/app/id1"))
        let gate = AppVersionGate(api: api, appVersionCode: 3)

        await gate.checkAppVersion()

        XCTAssertTrue(gate.updateRequired)
        XCTAssertEqual(gate.storeURL.absoluteString, "https://apps.apple.com/app/id1")
    }

    func test_updateNotRequired_whenInstalledAtOrAboveMinSupported() async {
        let api = MockAppVersionAPI()
        api.result = .success(AppVersionResponse(minSupportedVersion: 3))
        let gate = AppVersionGate(api: api, appVersionCode: 3)

        await gate.checkAppVersion()

        XCTAssertFalse(gate.updateRequired)
    }

    func test_updateNotRequired_onNetworkFailure() async {
        let api = MockAppVersionAPI()
        api.result = .failure(APIError.invalidResponse)
        let gate = AppVersionGate(api: api, appVersionCode: 1)

        await gate.checkAppVersion()

        XCTAssertFalse(gate.updateRequired)
    }

    func test_storeURL_fallsBackToAppStore_whenBlank() async {
        let api = MockAppVersionAPI()
        api.result = .success(AppVersionResponse(minSupportedVersion: 9, storeUrl: ""))
        let gate = AppVersionGate(api: api, appVersionCode: 1)

        await gate.checkAppVersion()

        XCTAssertTrue(gate.updateRequired)
        XCTAssertEqual(gate.storeURL.absoluteString, "https://apps.apple.com")
    }
}

private final class MockAppVersionAPI: AppVersionProviding, @unchecked Sendable {
    var result: Result<AppVersionResponse, Error> = .success(AppVersionResponse())

    func appVersion(platform: String) async throws -> AppVersionResponse {
        switch result {
        case .success(let response):
            return response
        case .failure(let error):
            throw error
        }
    }
}
