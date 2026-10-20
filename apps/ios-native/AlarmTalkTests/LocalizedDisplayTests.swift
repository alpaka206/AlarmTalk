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
            for alias in ["male", "M", "남자"] {
                XCTAssertEqual(FortunePromptInputFormat.displayLabel(alias, bundle: bundle), male)
            }
            for alias in ["female", "F", "여자"] {
                XCTAssertEqual(FortunePromptInputFormat.displayLabel(alias, bundle: bundle), female)
            }
            for alias in ["시간 모름", "모름", "알 수 없음"] {
                XCTAssertEqual(FortunePromptInputFormat.displayLabel(alias, bundle: bundle), unknown)
            }
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

    func testRelationshipPresetsAreTranslated() throws {
        for language in ["en", "ja"] {
            let bundle = try bundle(language)
            for preset in VoiceRelationshipPreset.allCases {
                XCTAssertNotEqual(preset.localizedDisplayLabel(bundle: bundle), preset.label)
            }
        }
        XCTAssertEqual(VoiceRelationshipPreset.custom.localizedDisplayLabel(bundle: try bundle("en")), "Custom")
    }

    /// 관계는 저장 문자열로 보낸다 — 직접 입력은 친 그대로(앞뒤 공백만 걷는다), 고른 것은 그 한국어 라벨이다.
    func testCustomRelationshipMatchingPresetKeepsUserInput() {
        let custom = VoiceRelationshipSelection(preset: .custom, customLabel: " 엄마 ")
        XCTAssertEqual(custom.resolved, "엄마")
        XCTAssertEqual(VoiceRelationshipSelection(preset: .mom).resolved, VoiceRelationshipPreset.mom.label)
        XCTAssertEqual(VoiceRelationshipSelection().resolved, "")
    }

    func testLegalLinksFollowAppLanguageWithKoreanFallback() {
        for (language, path) in [("ko", "ko"), ("en-US", "en"), ("ja", "ja"), ("fr", "ko")] {
            XCTAssertEqual(LegalLinks.url(for: "terms", language: language).absoluteString, "https://alarm-talk.com/\(path)/terms")
            XCTAssertEqual(LegalLinks.url(for: "privacy", language: language).absoluteString, "https://alarm-talk.com/\(path)/privacy")
        }
    }
}
