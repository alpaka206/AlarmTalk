import XCTest
@testable import AlarmTalk

/// 서버 재사용(`cacheHit`)도 **한 번 센다**(2026-10-27 — `docs/spec/voice-and-message.md` §8). 그래서 사용 기록
/// `manual_result_reused`(server)는 새 제작과 같이 서버가 말한 정산 수단·사용월을 싣는다(`docs/spec/usage-events.md` §7).
/// 기기 캐시 재사용(local)은 서버를 타지 않아 그대로 `none` 이다. 안드로이드 짝은 `ManualServerReuseChargeWiringTest`.
final class ManualServerReuseChargeTests: XCTestCase {
    func test_serverReuseCarriesTheServersChargeAndMonth() throws {
        let source = try AppSourceText.read("VoiceStudioViewModel.swift")
        let answer = String(try AppSourceText.region(
            of: source,
            from: "private func recordManualGenerationAnswer(",
            to: "private func recordManualGenerationFailure("
        ))
        let reuse = String(try AppSourceText.region(of: answer, from: "reuseLocation: .server,", to: "return"))
        XCTAssertTrue(reuse.contains("chargedSource: response.chargedSource.flatMap(UsageEventProps.ChargedSource.init(rawValue:))"))
        XCTAssertTrue(reuse.contains("usageMonth: response.usageMonth"))
        XCTAssertFalse(reuse.contains("ChargedSource.none"), "서버 재사용을 '세지 않음' 으로 적지 않는다")

        let local = String(try AppSourceText.region(of: source, from: "func recordManualLocalReuse(", to: "charCount: textCount"))
        XCTAssertTrue(local.contains("reuseLocation: .local"))
        XCTAssertTrue(local.contains("chargedSource: UsageEventProps.ChargedSource.none"))
    }
}
