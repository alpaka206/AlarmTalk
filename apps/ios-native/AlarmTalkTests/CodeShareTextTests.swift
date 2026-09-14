import Testing
@testable import AlarmTalk

/// 코드 공유 문구.
///
/// ⚠ 이 테스트가 지키는 것은 **코드만 보내지 않는다** 는 것 하나다. 예전 iOS 는 공유
/// 시트에 `voucher.code` 여덟 글자만 넘겨서, 받은 사람이 이게 무엇인지도 앱을 어디서
/// 받는지도 알 수 없었다. 안드로이드는 처음부터 안내를 함께 보냈다.
struct CodeShareTextTests {

    @Test("초대 문구에 코드·설치 링크·등록 위치가 모두 들어간다")
    func inviteCarriesEverything() {
        let text = CodeShareText.invite(code: "INV-AAAA-BBBB-CCCC")
        #expect(text.contains("INV-AAAA-BBBB-CCCC"))
        #expect(text.contains(CodeShareText.installURL))
        // 받는 사람이 어디에 넣어야 하는지 — 이게 빠지면 코드를 쥐고도 못 쓴다.
        #expect(text.contains("코드 등록"))
        // 코드 한 줄짜리로 되돌아가는 회귀를 잡는다.
        #expect(text.count > 40)
    }

    @Test("선물 문구도 마찬가지")
    func giftCarriesEverything() {
        let text = CodeShareText.gift(code: "GIFT-1234-5678")
        #expect(text.contains("GIFT-1234-5678"))
        #expect(text.contains(CodeShareText.installURL))
        #expect(text.contains("코드 등록"))
    }

    /// ⚠ 안드로이드 `ui/billing/BillingPanels.kt` 의 `shareVoucher` 와 **같은 판정**이어야
    /// 한다. 어긋나면 이용권을 선물해 놓고 "가족으로 합류하자" 고 말하게 된다.
    @Test("GIFT- 접두사만 선물 문구로 간다", arguments: [
        ("GIFT-1111", true),
        ("gift-1111", true),   // 대소문자 무시
        ("INV-1111", false),
        ("ABCD1234", false),   // 접두사 없는 옛 코드는 초대로 본다
    ])
    func kindDetection(code: String, isGift: Bool) {
        let text = CodeShareText.forCode(code)
        #expect(text.contains("이용권을 보냈어요") == isGift)
    }

    /// ⚠ 링크는 스토어 직링크가 아니라 랜딩이어야 한다 — 받는 사람이 어느 기기인지
    /// 모르고, App Store 주소는 숫자 앱 ID 가 정해진 뒤에야 만들 수 있다.
    @Test("설치 링크는 스토어 직링크가 아니라 랜딩이다")
    func installLinkIsLanding() {
        #expect(CodeShareText.installURL == "https://alarm-talk.com")
        let text = CodeShareText.invite(code: "INV-1")
        #expect(!text.contains("play.google.com"))
        #expect(!text.contains("apps.apple.com"))
    }

    /// 서식 인자가 어긋나면 `%1$@` 가 그대로 남거나 자리가 바뀐다.
    @Test("서식 자리표시자가 남지 않는다")
    func noLeftoverPlaceholders() {
        for text in [CodeShareText.invite(code: "INV-1"), CodeShareText.gift(code: "GIFT-1")] {
            #expect(!text.contains("%1$@"))
            #expect(!text.contains("%2$@"))
        }
    }
}
