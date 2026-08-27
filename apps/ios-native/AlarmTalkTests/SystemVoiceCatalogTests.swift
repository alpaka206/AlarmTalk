import XCTest
@testable import AlarmTalk

final class SystemVoiceCatalogTests: XCTestCase {
    func testBundledCatalogContainsTheFourReadySystemVoices() {
        let voices = bundledSystemVoiceProfiles()

        XCTAssertEqual(voices.map { String($0.id.suffix(3)) }, ["101", "102", "103", "104"])
        XCTAssertEqual(voices.map(\.name), ["아담", "미나", "하준", "소은"])
        XCTAssertTrue(voices.allSatisfy { $0.status == "ready" && isSystemVoice($0) })
    }
}
