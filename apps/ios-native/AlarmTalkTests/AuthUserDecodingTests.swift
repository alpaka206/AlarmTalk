import XCTest
@testable import AlarmTalk

final class AuthUserDecodingTests: XCTestCase {
    private func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }

    /// 옛 서버 응답에는 가족 알람 칸이 남아 있을 수 있다(모양이 어긋난 값까지) — 읽지 않고 넘긴다.
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
            { "days": [2], "start": "bad", "end": "18:30" }
          ],
          "dynamic_prompt_settings": {}
        }
        """.data(using: .utf8)!

        let user = try decoder().decode(AuthUser.self, from: json)

        XCTAssertEqual(user.id, "user-1")
        XCTAssertEqual(user.name, "")
        XCTAssertEqual(user.plan, "free")
        XCTAssertEqual(try XCTUnwrap(user.dynamicPromptSettings), .empty)
    }

    /// 업데이트 전 키체인에 저장된 세션 — 가족 알람 칸이 남아 있다. 못 읽으면 업데이트하자마자 로그아웃된다.
    func test_legacyKeychainSessionWithFamilyFieldsStillDecodes() throws {
        let json = """
        {
          "token": "stored-token",
          "user": {
            "id": "user-1", "email": "tester@example.com", "name": "Tester", "plan": "plus",
            "allowFamilyAlarms": true, "familyAlarmQuietDays": [1, 3],
            "familyAlarmQuietStart": "22:00", "familyAlarmQuietEnd": "07:00",
            "familyAlarmQuietWindows": [{ "days": [1, 3], "start": "22:00", "end": "07:00" }],
            "deletionStatus": "active"
          }
        }
        """.data(using: .utf8)!

        // 키체인은 기본 디코더로 읽는다(`KeychainStore.readSession`).
        let session = try JSONDecoder().decode(AuthSession.self, from: json)

        XCTAssertEqual(session.token, "stored-token")
        XCTAssertEqual(session.user.id, "user-1")
        XCTAssertEqual(session.user.name, "Tester")
        XCTAssertEqual(session.user.plan, "plus")
        XCTAssertEqual(session.user.deletionStatus, "active")
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
