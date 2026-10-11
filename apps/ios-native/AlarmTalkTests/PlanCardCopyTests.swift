import Foundation
import Testing
@testable import AlarmTalk

/// 이용권 화면 카드의 기능 문구(2026-09-30).
///
/// 개인 카드는 "날씨·운세 등 매일 다른 문구" 라고 적었는데 둘 다 사실이 아니었다 — 날씨·운세
/// 문구는 기본 목소리로 **무료**이고(`docs/spec/voice-and-message.md` §2), 클립은 준비된 것을
/// 돌려 쓴다. 개인 이용권이 더하는 것은 그 문구를 **등록한 목소리로** 듣는 것이다.
///
/// 안드로이드 `billing_plan_*feature*` 문자열의 짝이다(`PlanCardCopyTest` — 같은 글자를 지킨다).
/// `-testLanguage ko` 로 돌므로 번역은 앱 번들의 `<언어>.lproj` 를 직접 연다
/// (`CodeShareTextTests` 와 같은 방식).
struct PlanCardCopyTests {

    @Test("개인 카드는 문구 종류가 아니라 등록한 목소리로 듣는 것을 말한다")
    func personalCardSellsTheVoice() {
        #expect(PlanCard.features(for: .personal) == ["원하는 목소리 1개 등록", "등록한 목소리로 듣는 날씨·운세 문구"])
    }

    @Test("영어·일본어 문구가 안드로이드 values-en·values-ja 와 같다", arguments: [
        ("en", "Weather and fortune messages in your registered voice"),
        ("ja", "登録した声で聞く天気・運勢メッセージ"),
    ])
    func personalLineIsTranslated(language: String, expected: String) throws {
        let path = try #require(Bundle.main.path(forResource: language, ofType: "lproj"))
        let bundle = try #require(Bundle(path: path))
        #expect(bundle.localizedString(forKey: "등록한 목소리로 듣는 날씨·운세 문구", value: nil, table: nil) == expected)
    }

    /// 등록은 본인 목소리만이 아니라 **적법한 권한과 동의를 받은 사람의 목소리**도 받는다(이용약관
    /// 제7조). '내 목소리'·'own voice'·'自分の声' 라고 쓰면 엄마·연인 목소리를 등록하려는 사람에게
    /// 안 되는 것처럼 읽힌다(코덱스 #835).
    @Test("개인 카드는 본인 목소리만 되는 것처럼 말하지 않는다", arguments: ["en", "ja"])
    func personalCardDoesNotSayOwnVoiceOnly(language: String) throws {
        let path = try #require(Bundle.main.path(forResource: language, ofType: "lproj"))
        let bundle = try #require(Bundle(path: path))
        for key in PlanCard.features(for: .personal) {
            let translated = bundle.localizedString(forKey: key, value: nil, table: nil)
            for text in [key, translated] {
                for claim in ["내 목소리", "own voice", "自分の声"] {
                    #expect(!text.localizedCaseInsensitiveContains(claim), "개인 카드가 '\(claim)' 이라고 한다: \(text)")
                }
            }
        }
    }

    /// 커플 카드의 이 줄은 2026-09-30 까지 번역만 안드로이드와 달랐다("Set a partner's alarm" /
    /// "相手のアラームを設定") — 한국어 키가 같아 대조에서 눈에 띄지 않았다.
    @Test("커플 카드 '상대 알람 맞춰주기' 번역도 안드로이드와 같다", arguments: [
        ("en", "Set your partner's alarm"),
        ("ja", "相手のアラーム設定"),
    ])
    func coupleMessageLineMatchesAndroid(language: String, expected: String) throws {
        let path = try #require(Bundle.main.path(forResource: language, ofType: "lproj"))
        let bundle = try #require(Bundle(path: path))
        #expect(bundle.localizedString(forKey: "상대 알람 맞춰주기", value: nil, table: nil) == expected)
    }

    /// 카탈로그에 키가 없으면 `localizedString` 은 키(한국어)를 그대로 돌려준다 — 그러면 영어·
    /// 일본어 기기의 이용권 화면에 한국어 한 줄이 섞인다.
    @Test("모든 카드의 모든 줄에 영어·일본어 번역이 있다", arguments: ["en", "ja"])
    func everyLineIsTranslated(language: String) throws {
        let path = try #require(Bundle.main.path(forResource: language, ofType: "lproj"))
        let bundle = try #require(Bundle(path: path))
        for tier in PlanTier.allCases {
            for key in PlanCard.features(for: tier) {
                let translated = bundle.localizedString(forKey: key, value: nil, table: nil)
                #expect(translated != key, "\(language) 에 '\(key)' 번역이 없다")
            }
        }
    }

    @Test("어느 카드도 매일 새 문구를 약속하지 않는다", arguments: ["en", "ja"])
    func noCardPromisesDailyLines(language: String) throws {
        let path = try #require(Bundle.main.path(forResource: language, ofType: "lproj"))
        let bundle = try #require(Bundle(path: path))
        for tier in PlanTier.allCases {
            for key in PlanCard.features(for: tier) {
                let translated = bundle.localizedString(forKey: key, value: nil, table: nil)
                for text in [key, translated] {
                    for claim in ["매일", "every day", "daily", "毎日"] {
                        #expect(!text.localizedCaseInsensitiveContains(claim), "\(tier) 카드가 '\(claim)' 을 약속한다: \(text)")
                    }
                }
            }
        }
    }
}
