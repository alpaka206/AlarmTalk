import Foundation
import Testing
@testable import AlarmTalk

@MainActor
struct SettingsHomeLocalizationTests {
    private func bundle(_ language: String) throws -> Bundle {
        let path = try #require(Bundle.main.path(forResource: language, ofType: "lproj"))
        return try #require(Bundle(path: path))
    }

    @Test("받지 않는 시간의 요일도 번역하고 목록 끄기는 울림 해제와 구분한다", arguments: ["en", "ja"])
    func quietScheduleAndToggle(language: String) throws {
        let bundle = try bundle(language)
        let windows = [FamilyAlarmQuietWindow(days: [1, 2, 3, 4, 5], start: "07:00", end: "18:00")]
        let member = FamilyGroupMember(id: "member", userId: "user", role: "member", joinedAt: "2026-10-05", familyAlarmQuietWindows: windows)
        let weekdays = language == "en" ? "Weekdays" : "平日"
        #expect(FamilyAlarmScheduleRules.quietScheduleLabel(member, bundle: bundle) == "\(weekdays) 07:00-18:00")
        #expect(HelperFormatters.quietDaysLabel([0, 6], bundle: bundle) == (language == "en" ? "Weekend" : "週末"))
        #expect(HelperFormatters.quietDaysLabel(Array(0...6), bundle: bundle) == (language == "en" ? "Every day" : "毎日"))
        #expect(HelperFormatters.quietDaysLabel([1, 3], bundle: bundle) == (language == "en" ? "Mon,Wed" : "月,水"))
        #expect(bundle.localizedString(forKey: "알람 끄기", value: nil, table: nil) == (language == "en" ? "Turn alarm off" : "アラームをオフにする"))
    }

    @Test("홈의 날짜·목소리 서식을 언어에 맞게 표시하고 이름 없는 구성원은 단수다", arguments: ["en", "ja"])
    func rowAndRecipient(language: String) throws {
        let bundle = try bundle(language)
        let format = bundle.localizedString(forKey: "%@ · %@ 목소리", value: nil, table: nil)
        #expect(String(format: format, "10/5", "Mina") == (language == "en" ? "10/5 · Mina" : "10/5 · Minaの声"))
        #expect(bundle.localizedString(forKey: "member.unnamed", value: nil, table: nil)
                == (language == "en" ? "Member" : "メンバー"))
        #expect(bundle.localizedString(forKey: "누구를 깨울까요?", value: nil, table: nil)
                == (language == "en" ? "Who is this alarm for?" : "誰を起こしますか？"))
    }

    @Test("설정·동기화 결과·권한 안내의 문장을 번역 번들에서 조회한다", arguments: ["en", "ja"])
    func settingsAndSyncMessages(language: String) throws {
        let bundle = try bundle(language)
        for key in ["시스템 설정과 같이", "밝은 모드", "어두운 모드", "내 계정", "미설정",
                    "문구 정보", "법적 정보", "라이선스 전문을 불러오지 못했어요.",
                    "동기화하려면 먼저 로그인해 주세요", "알람 변경사항 일부를 저장하지 못했어요. 이 기기의 알람은 그대로 울려요.",
                    "알람 변경사항 일부를 저장하지 못했고, 받은 알람 일부를 불러오지 못했어요.",
                    "받은 알람 일부를 불러오지 못했어요. 잠시 후 다시 동기화해 주세요."] {
            #expect(bundle.localizedString(forKey: key, value: nil, table: nil) != key)
        }
        let format = bundle.localizedString(forKey: "알람 권한을 허용해야 알람을 켤 수 있어요. %@", value: nil, table: nil)
        #expect(String(format: format, "Consequence").hasSuffix("Consequence"))
    }
}
