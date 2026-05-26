import XCTest
@testable import VoiceAlarm

final class AuthUserDecodingTests: XCTestCase {
    private func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }

    func test_authUserDecodingFallsBackLikeAndroidSessionStore() throws {
        let json = """
        {
          "id": "user-1",
          "email": "tester@example.com",
          "name": null,
          "plan": null,
          "allow_family_alarms": null,
          "family_alarm_quiet_days": [7, 1, 1, 3, -1],
          "family_alarm_quiet_start": "bad",
          "family_alarm_quiet_end": null,
          "family_alarm_quiet_windows": [
            { "days": [6, 6, 0], "start": "22:00", "end": "08:30" },
            { "days": [], "start": "09:00", "end": "18:30" },
            { "days": [2], "start": "bad", "end": "18:30" }
          ],
          "dynamic_prompt_settings": {}
        }
        """.data(using: .utf8)!

        let user = try decoder().decode(AuthUser.self, from: json)

        XCTAssertEqual(user.name, "")
        XCTAssertEqual(user.plan, "free")
        XCTAssertFalse(user.allowFamilyAlarms ?? true)
        XCTAssertEqual(user.familyAlarmQuietDays, [0, 6])
        XCTAssertEqual(user.familyAlarmQuietStart, "22:00")
        XCTAssertEqual(user.familyAlarmQuietEnd, "08:30")
        XCTAssertEqual(
            user.familyAlarmQuietWindows ?? [],
            [FamilyAlarmQuietWindow(days: [0, 6], start: "22:00", end: "08:30")]
        )
        XCTAssertEqual(try XCTUnwrap(user.dynamicPromptSettings), .empty)
    }

    func test_dynamicPromptSettingsDecodingTrimsBlankValues() throws {
        let json = """
        {
          "weather": {
            "country": "  대한민국  ",
            "city": " "
          },
          "fortune": {
            "gender": " female ",
            "birth_date": "",
            "birth_time": " 09:30 "
          }
        }
        """.data(using: .utf8)!

        let settings = try decoder().decode(DynamicPromptSettings.self, from: json)

        XCTAssertEqual(settings.weather.country, "대한민국")
        XCTAssertNil(settings.weather.city)
        XCTAssertEqual(settings.fortune.gender, "female")
        XCTAssertNil(settings.fortune.birthDate)
        XCTAssertEqual(settings.fortune.birthTime, "09:30")
    }
}
