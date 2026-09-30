import Foundation
import Testing
@testable import AlarmTalk

/// 잠금 화면·다이내믹 아일랜드의 알람 표시가 **영어·일본어 기기에서 한국어로 뜨지 않는다**.
///
/// 두 표면이다: AlarmKit 이 그리는 울림 알럿(앱이 만든 `AlarmPresentation`)과 위젯 프로세스의
/// Live Activity(`AlarmLiveActivity`). 예전에는 ① 다시 울림 버튼과 카운트다운 제목을
/// `LocalizedStringResource(stringLiteral:)` 에 보간한 문자열로 만들어 보간 결과("5분 더 자기")가
/// 통째로 키가 됐고, ② 편집기가 저장하는 기본 이름 `"알람"` 을 그대로 끼웠고, ③ 위젯에는 문자열
/// 카탈로그가 아예 없었다(코덱스 #836).
///
/// `-testLanguage ko` 로 돌므로 번역은 번들의 `<언어>.lproj` 를 직접 연다
/// (`WeatherPresetCityLocalizationTests` 와 같은 방식).
struct AlarmKitPresentationLocalizationTests {

    @Test("다시 울림 버튼·카운트다운 제목은 서식 키로 만든다")
    func usesFormatKeys() {
        #expect(AlarmKitViewModel.snoozeButtonText(minutes: 7).key == "%lld분 더 자기")
        #expect(AlarmKitViewModel.countdownTitle(label: "출근").key == "%@ 다시 울릴 준비 중")
    }

    /// 편집기는 빈 이름을 한국어 `"알람"` 으로 저장한다(`AlarmEditDraft.toRecord`). 그걸 끼우면
    /// 번역된 뒷부분 앞에 한국어가 남는다 — "알람 will ring again soon".
    @Test("기본 이름·빈 이름이면 이름 없는 문구다", arguments: ["알람", "Alarm", "アラーム", "", "   "])
    func defaultLabelIsOmitted(label: String) {
        #expect(AlarmKitViewModel.countdownTitle(label: label).key == "다시 울릴 준비 중")
        #expect(AlarmDefaultLabel.custom(label) == nil)
    }

    @Test("사용자가 붙인 이름은 앞뒤 공백만 지우고 그대로 쓴다")
    func customLabelIsKept() {
        #expect(AlarmDefaultLabel.custom("  출근 알람 ") == "출근 알람")
        #expect(AlarmDefaultLabel.custom(nil) == nil)
    }

    @Test("울림 알럿 문구에 영어·일본어 번역이 있다", arguments: [
        ("en", "Again in 7 min", "Work will ring again soon", "Ringing again soon"),
        ("ja", "7分後にもう一度", "Work まもなく再び鳴ります", "まもなく再び鳴ります"),
    ])
    func formatKeysAreTranslated(language: String, snooze: String, countdown: String, unnamed: String) throws {
        let bundle = try Self.localization(language, in: Bundle.main)
        let snoozeFormat = bundle.localizedString(forKey: "%lld분 더 자기", value: nil, table: nil)
        let countdownFormat = bundle.localizedString(forKey: "%@ 다시 울릴 준비 중", value: nil, table: nil)
        #expect(String(format: snoozeFormat, 7) == snooze)
        #expect(String(format: countdownFormat, "Work") == countdown)
        #expect(bundle.localizedString(forKey: "다시 울릴 준비 중", value: nil, table: nil) == unnamed)
    }

    /// Live Activity(`AlarmLiveActivity`)와 그 시계(`AlarmTalkMetadata.clockLabel`)가 쓰는 키.
    /// 위젯 코드에 문구를 더하면 여기에도 더한다 — 카탈로그에서 빠지면 그 문구만 한국어로 뜬다.
    static let liveActivityKeys = [
        "끄기", "다시 울리기", "다시 울림", "다시 울림 대기 중", "알람", "알람 소리로 깨워요", "알람 울림",
        "알람 후 음성으로 깨워요", "예약됨", "오전", "오후", "음성 알람", "음성으로 깨워요", "일시정지",
        "일시정지됨", "지금 울리는 중",
    ]

    @Test("Live Activity 문구는 위젯 번들에 영어·일본어 번역이 있다", arguments: ["en", "ja"])
    func liveActivityStringsAreTranslated(language: String) throws {
        let bundle = try Self.localization(language, in: Self.widgetBundle())
        for key in Self.liveActivityKeys {
            let value = bundle.localizedString(forKey: key, value: nil, table: nil)
            #expect(value != key, "\(language) 번역 없음: \(key)")
        }
    }

    // MARK: - Helpers

    private static func localization(_ language: String, in bundle: Bundle) throws -> Bundle {
        let path = try #require(bundle.path(forResource: language, ofType: "lproj"))
        return try #require(Bundle(path: path))
    }

    /// 앱에 들어 있는 위젯 확장(`com.alarmtalk.app.widget`).
    private static func widgetBundle() throws -> Bundle {
        let plugIns = try #require(Bundle.main.builtInPlugInsURL)
        let appexes = try FileManager.default.contentsOfDirectory(at: plugIns, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "appex" }
            .compactMap(Bundle.init(url:))
        return try #require(appexes.first { $0.bundleIdentifier == "com.alarmtalk.app.widget" })
    }
}
