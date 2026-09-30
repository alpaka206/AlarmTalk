import Foundation
import Testing
@testable import AlarmTalk

/// 울림 알럿(AlarmKit 이 그리는 잠금 화면·다이내믹 아일랜드)의 **보간 문구도 번역된다**.
///
/// 예전에는 다시 울림 버튼과 카운트다운 제목을 `LocalizedStringResource(stringLiteral:)` 에 보간한
/// 문자열로 만들어, 보간 결과("5분 더 자기")가 통째로 키가 됐다 — 카탈로그에 그런 키가 없으니
/// 영어·일본어 기기에서도 한국어가 떴다(코덱스 #836). 서식 키로 만들고, 그 키에 번역이 있는지 본다.
///
/// `-testLanguage ko` 로 돌므로 번역은 앱 번들의 `<언어>.lproj` 를 직접 연다
/// (`WeatherPresetCityLocalizationTests` 와 같은 방식).
struct AlarmKitPresentationLocalizationTests {

    @Test("다시 울림 버튼·카운트다운 제목은 서식 키로 만든다")
    func usesFormatKeys() {
        #expect(AlarmKitViewModel.snoozeButtonText(minutes: 7).key == "%lld분 더 자기")
        #expect(AlarmKitViewModel.countdownTitle(label: "출근").key == "%@ 다시 울릴 준비 중")
    }

    @Test("영어·일본어 번역이 있다", arguments: [
        ("en", "Again in 7 min", "Work will ring again soon"),
        ("ja", "7分後にもう一度", "Work まもなく再び鳴ります"),
    ])
    func formatKeysAreTranslated(language: String, snooze: String, countdown: String) throws {
        let path = try #require(Bundle.main.path(forResource: language, ofType: "lproj"))
        let bundle = try #require(Bundle(path: path))
        let snoozeFormat = bundle.localizedString(forKey: "%lld분 더 자기", value: nil, table: nil)
        let countdownFormat = bundle.localizedString(forKey: "%@ 다시 울릴 준비 중", value: nil, table: nil)
        #expect(String(format: snoozeFormat, 7) == snooze)
        #expect(String(format: countdownFormat, "Work") == countdown)
    }
}
