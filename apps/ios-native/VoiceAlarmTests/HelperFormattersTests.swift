import XCTest
@testable import VoiceAlarm

final class HelperFormattersTests: XCTestCase {

    func test_characterStageEmoji_matchesAndroidStageEmoji() {
        XCTAssertEqual(HelperFormatters.characterStageEmoji(nil), "🌰")
        XCTAssertEqual(HelperFormatters.characterStageEmoji("seed"), "🌰")
        XCTAssertEqual(HelperFormatters.characterStageEmoji("sprout"), "🌱")
        XCTAssertEqual(HelperFormatters.characterStageEmoji("tree"), "🌳")
        XCTAssertEqual(HelperFormatters.characterStageEmoji("bloom"), "🌸")
        XCTAssertEqual(HelperFormatters.characterStageEmoji("flower"), "🌸")
    }

    func test_characterStageName_matchesAndroidStageLabel() {
        XCTAssertEqual(HelperFormatters.characterStageName(nil), "씨앗")
        XCTAssertEqual(HelperFormatters.characterStageName("seed"), "씨앗")
        XCTAssertEqual(HelperFormatters.characterStageName("sprout"), "새싹")
        XCTAssertEqual(HelperFormatters.characterStageName("tree"), "나무")
        XCTAssertEqual(HelperFormatters.characterStageName("bloom"), "꽃")
        XCTAssertEqual(HelperFormatters.characterStageName("flower"), "꽃")
    }
}
