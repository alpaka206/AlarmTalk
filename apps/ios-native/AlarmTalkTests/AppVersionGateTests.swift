import XCTest
@testable import AlarmTalk

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

    // MARK: - 날씨 출처 토큰(코덱스 #845) — 판정 자체는 `WeatherAttributionTests`

    /// 응답 전에는 출처를 말하지 않는다 — 기본값이 숨김이다.
    func test_weatherAttribution_isNilBeforeTheCheck() {
        let gate = AppVersionGate(api: MockAppVersionAPI(), appVersionCode: 7)

        XCTAssertNil(gate.weatherAttribution)
        XCTAssertFalse(WeatherAttribution.showsLine(gate.weatherAttribution))
    }

    /// 서버가 준 토큰을 그대로 들고, 지역 시트는 그 값으로 줄을 그린다.
    func test_weatherAttribution_keepsTheServerToken() async {
        let api = MockAppVersionAPI()
        api.result = .success(AppVersionResponse(minSupportedVersion: 7, weatherAttribution: "kma_jma_nws"))
        let gate = AppVersionGate(api: api, appVersionCode: 7)

        await gate.checkAppVersion()

        XCTAssertEqual(gate.weatherAttribution, "kma_jma_nws")
        XCTAssertTrue(WeatherAttribution.showsLine(gate.weatherAttribution))
    }

    /// 지금 서버(Open-Meteo)·옛 서버는 토큰이 없다 — 줄을 숨긴다.
    func test_weatherAttribution_staysHiddenWithoutAToken() async {
        let api = MockAppVersionAPI()
        api.result = .success(AppVersionResponse(minSupportedVersion: 7))
        let gate = AppVersionGate(api: api, appVersionCode: 7)

        await gate.checkAppVersion()

        XCTAssertNil(gate.weatherAttribution)
        XCTAssertFalse(WeatherAttribution.showsLine(gate.weatherAttribution))
    }

    /// 확인이 실패하면 앞 응답의 토큰을 지운다 — 그 사이 원천을 되돌린 서버의 옛 원천을 말하지 않는다.
    func test_weatherAttribution_isClearedWhenTheCheckFails() async {
        let api = MockAppVersionAPI()
        api.result = .success(AppVersionResponse(minSupportedVersion: 7, weatherAttribution: "kma_jma_nws"))
        let gate = AppVersionGate(api: api, appVersionCode: 7)
        await gate.checkAppVersion()
        XCTAssertEqual(gate.weatherAttribution, "kma_jma_nws")

        api.result = .failure(APIError.invalidResponse)
        await gate.checkAppVersion()

        XCTAssertNil(gate.weatherAttribution)
        XCTAssertFalse(WeatherAttribution.showsLine(gate.weatherAttribution))
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
