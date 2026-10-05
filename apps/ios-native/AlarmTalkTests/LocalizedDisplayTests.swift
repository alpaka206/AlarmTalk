import Foundation
import XCTest
@testable import AlarmTalk

final class LocalizedDisplayTests: XCTestCase {
    private func bundle(_ language: String) throws -> Bundle {
        let path = try XCTUnwrap(Bundle.main.path(forResource: language, ofType: "lproj"))
        return try XCTUnwrap(Bundle(path: path))
    }

    func testStoredFortuneValuesAreDisplayedWithoutChangingTheContract() throws {
        for (language, male, female, unknown) in [("en", "Male", "Female", "Unknown"), ("ja", "男性", "女性", "時間不明")] {
            let bundle = try bundle(language)
            XCTAssertEqual(FortunePromptInputFormat.displayLabel("남성", bundle: bundle), male)
            XCTAssertEqual(FortunePromptInputFormat.displayLabel("여성", bundle: bundle), female)
            XCTAssertEqual(FortunePromptInputFormat.displayLabel("시간 모름", bundle: bundle), unknown)
            XCTAssertEqual(FortunePromptInputFormat.displayLabel("09:31~11:30", bundle: bundle), "09:31~11:30")
            XCTAssertEqual(FortunePromptInputFormat.male, "남성")
            XCTAssertEqual(FortunePromptInputFormat.unknownTime, "시간 모름")
        }
    }

    func testBirthDateUnitsDoNotReuseWeekdayOrDurationKeys() throws {
        let english = try bundle("en")
        let japanese = try bundle("ja")
        XCTAssertEqual(FortunePromptInputFormat.yearLabel(1990, bundle: english), "1990")
        XCTAssertEqual(FortunePromptInputFormat.monthLabel(3, bundle: english), "3")
        XCTAssertEqual(FortunePromptInputFormat.dayLabel(7, bundle: english), "7")
        XCTAssertEqual(FortunePromptInputFormat.yearLabel(1990, bundle: japanese), "1990年")
        XCTAssertEqual(FortunePromptInputFormat.monthLabel(3, bundle: japanese), "3月")
        XCTAssertEqual(FortunePromptInputFormat.dayLabel(7, bundle: japanese), "7日")
        XCTAssertEqual(english.localizedString(forKey: "fortune.birth.month", value: nil, table: nil), "Month")
        XCTAssertEqual(english.localizedString(forKey: "fortune.birth.day", value: nil, table: nil), "Day")
    }

    func testSystemVoiceIDsChooseNamesAndPrivateNamesStayUntouched() throws {
        for (language, expected) in [("en", ["Siwoo", "Mina", "Dohyun", "Aeni"]), ("ja", ["シウ", "ミナ", "ドヒョン", "エニ"])] {
            let bundle = try bundle(language)
            for (voice, name) in zip(bundledSystemVoiceProfiles(), expected) {
                XCTAssertEqual(systemVoiceDisplayName(id: voice.id, fallback: voice.name, bundle: bundle), name)
            }
            XCTAssertEqual(systemVoiceDisplayName(id: "private-id", fallback: "미나", bundle: bundle), "미나")
            XCTAssertEqual(systemVoiceDisplayName(id: systemVoiceIDPrefix + "000000000999", fallback: "New name", bundle: bundle), "New name")
        }
        XCTAssertEqual(bundledSystemVoiceProfiles()[1].name, "미나")
    }

    func testRelationshipPresetsAreTranslatedAndCustomValuesStayUntouched() throws {
        for language in ["en", "ja"] {
            let bundle = try bundle(language)
            for preset in VoiceRelationshipPreset.allCases {
                XCTAssertNotEqual(preset.localizedDisplayLabel(bundle: bundle), preset.label)
                if preset != .custom {
                    XCTAssertEqual(displayRelationshipLabel(preset.label, bundle: bundle), preset.localizedDisplayLabel(bundle: bundle))
                }
            }
            XCTAssertEqual(displayRelationshipLabel("나의 소중한 친구", bundle: bundle), "나의 소중한 친구")
        }
        XCTAssertEqual(VoiceRelationshipPreset.custom.localizedDisplayLabel(bundle: try bundle("en")), "Custom")
    }

    func testReceivedAlarmHonorificIsAddedOnce() throws {
        let japanese = try bundle("ja")
        XCTAssertEqual(receivedAlarmDisplayLabel(sender: "田中", bundle: japanese), "田中さんから届いたアラーム")
        XCTAssertEqual(receivedAlarmDisplayLabel(sender: "田中さん", bundle: japanese), "田中さんから届いたアラーム")
        XCTAssertEqual(receivedAlarmDisplayLabel(sender: "민수님", bundle: japanese), "민수님から届いたアラーム")
        XCTAssertEqual(receivedAlarmDisplayLabel(sender: "Tanaka", bundle: try bundle("en")), "Alarm from Tanaka")
        XCTAssertEqual(receivedAlarmDisplayLabel(sender: nil, bundle: try bundle("en")), "Alarm from someone")
        XCTAssertEqual(receivedAlarmDisplayLabel(sender: "  ", bundle: japanese), "相手から届いたアラーム")
    }

    func testLegalLinksFollowAppLanguageWithKoreanFallback() {
        for (language, path) in [("ko", "ko"), ("en-US", "en"), ("ja", "ja"), ("fr", "ko")] {
            XCTAssertEqual(LegalLinks.url(for: "terms", language: language).absoluteString, "https://alarm-talk.com/\(path)/terms")
            XCTAssertEqual(LegalLinks.url(for: "privacy", language: language).absoluteString, "https://alarm-talk.com/\(path)/privacy")
        }
    }
}
