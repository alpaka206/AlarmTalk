import Foundation
import XCTest
@testable import AlarmTalk

/// **선물하기는 앱 어디에도 남지 않는다.**
///
/// ⚠ 2026-10-14 App Store 지침 3.1.1 두 번째 반려. 1.2.11 은 프로모 코드로, 1.2.12 는 **선물 코드**로
/// 반려됐다 — 애플은 "인앱 결제가 아닌 수단(쳐서 넣는 코드)으로 기능을 연다" 를 사례가 아니라 종류로
/// 본다. 한 번은 사례(프로모)만 지우고 종류(코드로 여는 유료 기능)를 남겨 같은 사유로 다시 반려됐다.
/// 선물 상품·구매·코드 등록·공유 문구를 서버와 두 앱에서 전부 없앴다 — **되살리지 말 것.**
/// 할인·무료 이용은 스토어의 오퍼 코드(App Store 오퍼 코드·Play 프로모션 코드)로 준다.
///
/// 상품 목록은 `SubscriptionManagerTests` 가, 오류 문구 표는 `CodeRegistrationErrorTests`·
/// `SocialFeatureViewModelBillingTests` 가 고정한다. 여기서는 **사용자에게 보이는 글자**를 본다 —
/// 앱 번들에 실린 번역(ko·en·ja)의 원문 키와 값 어디에도 선물이라는 말이 없어야 한다. 그리고 **공유하는
/// 코드**를 본다 — 예전에 만든 선물 바우처가 목록에 남아 있어도 공유 대상이 아니다.
final class GiftRemovalTests: XCTestCase {

    /// 이용권 화면이 공유하는 코드는 **초대 코드(INV-)뿐**이다. 안드로이드 `GiftCodeRemovalTest` 의 같은 이름 검사와
    /// 같은 입력·같은 기대값이다.
    ///
    /// 지금 서버는 `GET /billing/vouchers` 에서 INV- 만 준다(`routes/billing-query.ts`). 그래도 앱이 한 번 더 거른다 —
    /// 옛 서버나 앞서 받아 둔 목록에는 옛 선물 바우처(GIFT-)가 남아 있을 수 있고, 서버는 그 코드를 받지 않는다
    /// (`CODE_NOT_FOUND`). 같은 플랜 키여도 접두가 다르면 고르는 목록에서 빠져야 한다.
    func test_이용권_화면이_공유하는_코드는_초대_코드뿐이다() {
        func voucher(_ code: String, planKey: String) -> VoucherItem {
            VoucherItem(
                id: code,
                code: code,
                planKey: planKey,
                planName: planKey,
                planType: planKey,
                status: "issued",
                expiresAt: "2026-12-31T00:00:00.000Z"
            )
        }
        let vouchers = [
            voucher("INV-AAAA-BBBB-CCCC", planKey: "family"),
            voucher("GIFT-AAAA-BBBB-CCCC", planKey: "personal"),
            voucher("GIFT-DDDD-EEEE-FFFF", planKey: "family"),
        ]
        XCTAssertEqual(shareableVouchersForPlan(vouchers, planKey: "family").map(\.code), ["INV-AAAA-BBBB-CCCC"])
        XCTAssertTrue(
            shareableVouchersForPlan(vouchers, planKey: "personal").isEmpty,
            "개인 카드에 선물 바우처 공유 버튼이 다시 뜬다."
        )
    }

    /// 선물을 뜻하는 말. 한국어 원문은 키이고, en·ja 는 값이다(키도 함께 본다).
    private static let giftWords = ["선물", "gift", "ギフト", "プレゼント", "贈"]

    func test_번역_어디에도_선물_문구가_없다() throws {
        for language in ["ko", "en", "ja"] {
            let texts = try Self.bundledStrings(language: language)
            XCTAssertFalse(texts.isEmpty, "\(language): 번들에서 번역을 하나도 못 읽었다 — 검사가 비어 통과한다")
            for text in texts {
                for word in Self.giftWords where text.range(of: word, options: .caseInsensitive) != nil {
                    XCTFail("\(language): 선물 문구가 남아 있다 — \(text)")
                }
            }
        }
    }

    /// 앱 번들의 `<언어>.lproj` 에 실린 `Localizable` 문자열 표(키 + 값, 복수형 사전 포함).
    private static func bundledStrings(language: String) throws -> [String] {
        let lproj = try XCTUnwrap(
            Bundle.main.path(forResource: language, ofType: "lproj"),
            "\(language).lproj 가 앱 번들에 없다"
        )
        var texts: [String] = []
        for ext in ["strings", "stringsdict"] {
            let path = (lproj as NSString).appendingPathComponent("Localizable.\(ext)")
            guard let table = NSDictionary(contentsOfFile: path) else { continue }
            collect(table, into: &texts)
        }
        return texts
    }

    private static func collect(_ value: Any, into texts: inout [String]) {
        switch value {
        case let string as String:
            texts.append(string)
        case let dictionary as NSDictionary:
            for (key, nested) in dictionary {
                if let key = key as? String { texts.append(key) }
                collect(nested, into: &texts)
            }
        case let array as NSArray:
            for nested in array { collect(nested, into: &texts) }
        default:
            break
        }
    }
}
