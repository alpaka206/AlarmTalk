import Foundation
import XCTest
@testable import AlarmTalk

final class AlarmEditorLocalizationTests: XCTestCase {
    func testRelationshipPickerDisplaysLocalizedNamesAndStoresContractValues() throws {
        for language in ["en", "ja"] {
            let path = try XCTUnwrap(Bundle.main.path(forResource: language, ofType: "lproj"))
            let bundle = try XCTUnwrap(Bundle(path: path))
            for preset in VoiceRelationshipPreset.allCases where preset != .custom {
                XCTAssertNotEqual(preset.localizedDisplayLabel(bundle: bundle), preset.label)
                XCTAssertEqual(VoiceRelationshipSelection(preset: preset).resolved, preset.label)
            }
            XCTAssertEqual(displayRelationshipLabel("직접 정한 관계", bundle: bundle), "직접 정한 관계")
        }
    }

    private func localized(_ key: String, language: String) throws -> String {
        let path = try XCTUnwrap(Bundle.main.path(forResource: language, ofType: "lproj"))
        let bundle = try XCTUnwrap(Bundle(path: path))
        return bundle.localizedString(forKey: key, value: nil, table: nil)
    }

    func testPlayModeAndVoiceRowHaveSingularNames() throws {
        for (language, alarm, voice) in [("en", "Alarm", "Voice"), ("ja", "アラーム", "声")] {
            XCTAssertEqual(try localized("alarm.playMode.alarm", language: language), alarm)
            XCTAssertEqual(try localized("alarm.playMode.voice", language: language), voice)
            XCTAssertEqual(try localized("alarm.editor.voice", language: language), voice)
        }
        XCTAssertEqual(try localized("alarm.editor.defaultVoice", language: "en"), "Default voice")
    }

    func testReplacementMessageUsesTimeWithoutAStoredKoreanAlarmName() throws {
        let key = "%@ 알람을 새 알람으로 교체할까요?"
        XCTAssertEqual(String(format: try localized(key, language: "en"), "07:30"), "Replace the 07:30 alarm with your new one?")
        XCTAssertEqual(String(format: try localized(key, language: "ja"), "07:30"), "07:30のアラームを新しいアラームに置き換えますか？")
    }

    func testWeekdaysAndTimeColumnsHaveTranslatedLabels() throws {
        for key in ["일", "월", "화", "수", "목", "금", "토", "일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일", "오전", "오후", "시", "분", "평일", "주말", "매일", "없음"] {
            for language in ["en", "ja"] {
                XCTAssertNotEqual(try localized(key, language: language), key, "\(language): \(key)")
            }
        }
        XCTAssertEqual(try localized("매일", language: "en"), "Every day")
        XCTAssertEqual(String(format: try localized("%@ 외 %lld개", language: "en"), "Mon 7:00 ~ 8:00", Int64(3)), "Mon 7:00 ~ 8:00 and 3 more")
    }

    func testEditorMessagesKeepTheirNumericAndTextArguments() throws {
        let quota = "직접 입력 문구는 한 달에 %lld번까지 새로 만들 수 있어요. 이미 만들어 둔 문구는 그대로 쓸 수 있어요."
        XCTAssertEqual(String(format: try localized(quota, language: "en"), Int64(10)), "You can create 10 new custom messages a month. Messages you already made still work.")
        XCTAssertEqual(String(format: try localized("매주: %@", language: "ja"), "月、水"), "毎週：月、水")
        for key in ["클래식", "운세 정보", "알람 권한이 필요해요", "이 기기에서는 알람음을 고를 수 없어 기본 알람음으로 울려요.", "실제 알람 문구가 아니라 인사말로 들려드려요.", "녹음하거나 파일을 선택해 주세요.", "기본 인사말", "날씨", "운세", "응원", "약", "직접 입력"] {
            for language in ["en", "ja"] {
                XCTAssertNotEqual(try localized(key, language: language), key, "\(language): \(key)")
            }
        }
    }
}
