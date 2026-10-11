import Foundation
import Testing
@testable import AlarmTalk

/// 가족 알람 보내기·이용권 나가기가 서버의 **거절 이유**를 말하는지 본다(`docs/spec/error-codes.md` §4).
/// 안드로이드 `FamilyAlarmFailureMessageTest` 와 짝이다 — 같은 코드를 같은 뜻으로 말해야 한다.
struct FamilyAlarmFailureMessageTests {
    private func server(_ status: Int, _ code: String) -> APIError {
        APIError.server(status: status, message: "server sentence", errorCode: code)
    }

    @Test("가족 알람 거절 코드는 공용 표가 이유를 말하고 모르는 코드는 화면 폴백이다")
    func familyAlarmRejections() {
        let fallback = String(localized: "상대 알람 설정에 실패했어요.")
        let expected: [(APIError, String)] = [
            (server(403, "FAMILY_ALARM_DISABLED"), String(localized: "상대가 알람을 받지 않도록 설정해 뒀어요.")),
            (server(400, "FAMILY_ALARM_LEAD_TIME"), String(localized: "상대 알람은 조금 더 뒤로 맞춰 주세요. 상대 기기에 전달될 시간이 조금 필요해요.")),
            (server(403, "FAMILY_ALARM_QUIET_TIME"), String(localized: "상대가 받을 수 없는 시간이에요.")),
        ]
        for (error, message) in expected {
            #expect(APIErrorMessages.message(for: error, fallback: fallback) == message)
            #expect(message != fallback)
        }
        #expect(APIErrorMessages.message(for: server(500, "SOMETHING_NEW"), fallback: fallback) == fallback)
        #expect(APIErrorMessages.message(for: URLError(.badServerResponse), fallback: fallback) == fallback)
    }

    @Test("관리자의 나가기 거절은 그 이유를 말한다")
    func ownerCannotLeave() {
        let fallback = String(localized: "이용권에서 나가지 못했어요")
        #expect(APIErrorMessages.message(for: server(409, "OWNER_CANNOT_LEAVE"), fallback: fallback)
                == String(localized: "관리자는 이용권에서 나갈 수 없어요."))
        #expect(APIErrorMessages.message(for: server(403, "NOT_MEMBER"), fallback: fallback) == fallback)
    }

    /// 안드로이드 `values-en`·`values-ja` 와 같은 문장이어야 한다.
    @Test("영어·일본어 번역은 안드로이드와 같은 문장이다", arguments: ["en", "ja"])
    func translationsMatchAndroid(language: String) throws {
        let path = try #require(Bundle.main.path(forResource: language, ofType: "lproj"))
        let bundle = try #require(Bundle(path: path))
        let expected: [String: [String: String]] = [
            "상대가 알람을 받지 않도록 설정해 뒀어요.": [
                "en": "The other person has turned off alarms from others.",
                "ja": "相手がアラームを受け取らない設定にしています。",
            ],
            "상대 알람은 조금 더 뒤로 맞춰 주세요. 상대 기기에 전달될 시간이 조금 필요해요.": [
                "en": "Set alarms for others a little later. It takes a moment to reach their phone.",
                "ja": "相手のアラームはもう少し後に設定してください。相手の端末に届くまで少し時間がかかります。",
            ],
            "상대가 받을 수 없는 시간이에요.": [
                "en": "The other person can't receive alarms at this time.",
                "ja": "相手が受け取れない時間帯です。",
            ],
            "관리자는 이용권에서 나갈 수 없어요.": [
                "en": "The admin can't leave the plan.",
                "ja": "管理者はプランから退出できません。",
            ],
        ]
        for (key, values) in expected {
            #expect(bundle.localizedString(forKey: key, value: nil, table: nil) == values[language])
        }
    }
}
