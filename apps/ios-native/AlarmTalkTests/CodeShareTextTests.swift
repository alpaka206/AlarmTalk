import Foundation
import Testing
@testable import AlarmTalk

/// 코드 공유 문구.
///
/// ⚠ 이 테스트가 지키는 것은 **코드만 보내지 않는다** 는 것 하나다. 예전 iOS 는 공유
/// 시트에 `voucher.code` 여덟 글자만 넘겨서, 받은 사람이 이게 무엇인지도 앱을 어디서
/// 받는지도 알 수 없었다. 안드로이드는 처음부터 안내를 함께 보냈다.
///
/// ⚠ **공유 문구는 초대 하나다.** 선물 코드 문구는 선물하기와 함께 2026-10-14 에 없앴다
/// (App Store 지침 3.1.1 두 번째 반려) — 되살리지 말 것. 할인·무료 이용은 스토어 오퍼 코드로 준다.
struct CodeShareTextTests {

    @Test("초대 문구에 코드·설치 링크·등록 위치가 모두 들어간다")
    func inviteCarriesEverything() {
        let text = CodeShareText.invite(code: "INV-AAAA-BBBB-CCCC")
        #expect(text.contains("INV-AAAA-BBBB-CCCC"))
        #expect(text.contains(CodeShareText.installURL))
        // 받는 사람이 어디에 넣어야 하는지 — 이게 빠지면 코드를 쥐고도 못 쓴다.
        #expect(text.contains("더보기 → 초대 코드 등록"))
        // 코드 한 줄짜리로 되돌아가는 회귀를 잡는다.
        #expect(text.count > 40)
    }

    /// ⚠ 3단계의 이름은 **더보기 탭에 실제로 있는 행**이어야 한다(`MenuView` 의 행 = `AuxiliaryScreen.people`
    /// 의 제목, 둘 다 '초대 코드 등록'). 행 이름만 바꾸고 공유 문구를 두면 받는 사람이 없는 메뉴를 찾는다.
    /// 안드로이드 `share_code_invite_body` 도 같은 경로를 쓴다(`common_tab_code_register`).
    /// 이 테스트는 `-testLanguage ko` 로 돌므로 번역은 앱 번들의 `<언어>.lproj` 를 직접 연다.
    @Test("등록 위치는 더보기 탭의 실제 행 이름이다", arguments: ["ko", "en", "ja"])
    func registrationStepNamesTheMenuRow(language: String) throws {
        let path = try #require(Bundle.main.path(forResource: language, ofType: "lproj"))
        let bundle = try #require(Bundle(path: path))
        let tab = bundle.localizedString(forKey: "더보기", value: nil, table: nil)
        let row = bundle.localizedString(forKey: "초대 코드 등록", value: nil, table: nil)
        let body = bundle.localizedString(
            forKey: "알람톡에서 내 목소리 알람을 같이 쓰자!\n\n초대 코드: %1$@\n\n1. 알람톡 설치 %2$@\n2. 가입하고 로그인\n3. 더보기 → 초대 코드 등록에 위 코드 입력",
            value: nil,
            table: nil
        )
        let expected: [String: (row: String, step: String)] = [
            "ko": ("초대 코드 등록", "\(tab) → \(row)"),
            "en": ("Register invite code", "\(tab) → \(row)"),
            "ja": ("招待コード登録", "「\(tab)」→「\(row)」"),
        ]
        let want = try #require(expected[language])
        #expect(row == want.row)
        #expect(body.contains(want.step), "\(language): \(body)")
        #expect(body.contains("%1$@") && body.contains("%2$@"))
    }

    /// ⚠ 링크는 스토어 직링크가 아니라 랜딩이어야 한다 — 받는 사람이 어느 기기인지
    /// 모르므로 두 스토어를 한곳에서 안내하는 랜딩으로 보낸다.
    @Test("설치 링크는 스토어 직링크가 아니라 랜딩이다")
    func installLinkIsLanding() {
        #expect(CodeShareText.installURL == "https://alarm-talk.com")
        let text = CodeShareText.invite(code: "INV-1")
        #expect(!text.contains("play.google.com"))
        #expect(!text.contains("apps.apple.com"))
    }

    /// ⚠ 랜딩 루트는 기기 언어와 상관없이 **한국어 페이지**다(정적 export — 언어 감지가 없다).
    /// 영어·일본어 문구가 루트를 가리키면 받는 사람이 한국어 페이지에 떨어진다. 이 테스트는
    /// `-testLanguage ko` 로 돌므로 번역은 앱 번들의 `<언어>.lproj` 를 직접 열어 확인한다.
    /// 안드로이드 `values-en`·`values-ja` 의 `share_code_invite_body` 와
    /// **같은 주소**여야 한다(`ShareCodeTextTest`).
    @Test("영어·일본어 문구는 그 언어의 랜딩을 가리킨다", arguments: [
        ("en", "https://alarm-talk.com/en/"),
        ("ja", "https://alarm-talk.com/ja/"),
    ])
    func installURLFollowsTextLanguage(language: String, expected: String) throws {
        let path = try #require(Bundle.main.path(forResource: language, ofType: "lproj"))
        let bundle = try #require(Bundle(path: path))
        #expect(bundle.localizedString(forKey: "https://alarm-talk.com", value: nil, table: nil) == expected)
    }

    /// 서식 인자가 어긋나면 `%1$@` 가 그대로 남거나 자리가 바뀐다.
    @Test("서식 자리표시자가 남지 않는다")
    func noLeftoverPlaceholders() {
        let text = CodeShareText.invite(code: "INV-1")
        #expect(!text.contains("%1$@"))
        #expect(!text.contains("%2$@"))
    }
}
