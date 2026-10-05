import Foundation
import Testing
@testable import AlarmTalk

struct AuthConsentLocalizationTests {
    private func bundle(_ language: String) throws -> Bundle {
        let path = try #require(Bundle.main.path(forResource: language, ofType: "lproj"))
        return try #require(Bundle(path: path))
    }

    @Test("랜딩 강조 단어와 탭 제목을 분리하고 문장 안에서 단어 순서를 바꿀 수 있다", arguments: ["en", "ja"])
    func landingAndTab(language: String) throws {
        let bundle = try bundle(language)
        let keyword = bundle.localizedString(forKey: "auth.landing.voiceKeyword", value: nil, table: nil)
        let headline = bundle.localizedString(forKey: "좋아하는 %@로\n깨어나는 아침", value: nil, table: nil)
        #expect(String(format: headline, keyword) == (language == "en"
                ? "Wake up to\na voice you love" : "大好きな声で\n目覚める朝"))
        #expect(bundle.localizedString(forKey: "목소리", value: nil, table: nil)
                == (language == "en" ? "Voices" : "声"))
    }

    @Test("서버가 필수·선택을 지정하는 모든 동의 유형에 완성 문장이 있다", arguments: ["en", "ja"])
    func consentLabels(language: String) throws {
        let bundle = try bundle(language)
        for subject in ["만 14세 이상입니다", "이용약관 동의", "개인정보 처리방침 동의",
                        "음성 생체정보 처리 동의", "음성 AI 처리를 위한 국외 이전 동의", "광고성 정보 수신 동의"] {
            for optional in [false, true] {
                let key = (optional ? "[선택] " : "[필수] ") + subject
                let label = bundle.localizedString(forKey: key, value: nil, table: nil)
                let prefix = language == "en"
                    ? (optional ? "[Optional]" : "[Required]")
                    : (optional ? "［任意］" : "［必須］")
                #expect(label.hasPrefix(prefix))
                #expect(!label.contains(subject))
            }
        }
    }

    @Test("Apple·이메일·세션 오류와 동의 안내는 번들에서 조회한다", arguments: ["en", "ja"])
    func authAndConsentMessages(language: String) throws {
        let bundle = try bundle(language)
        for key in ["Apple 로그인 정보를 확인하지 못했어요.", "Apple identity token을 받지 못했어요.",
                    "인증 코드가 일치하지 않아요.", "이메일 인증이 완료됐어요.",
                    "세션이 만료됐어요. 다시 로그인해 주세요.", "필수 동의 내용", "선택 동의", "미동의",
                    "서비스 이용약관", "개인정보 처리방침", "설명 접기", "설명 펼치기"] {
            #expect(bundle.localizedString(forKey: key, value: nil, table: nil) != key)
        }
    }
}
