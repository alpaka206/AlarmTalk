import Foundation
import Testing
@testable import AlarmTalk

@MainActor
struct BillingLocalizationTests {
    @Test("공유 코드의 서버 한국어 이름은 보존하고 화면은 플랜 키로 번역한다", arguments: ["en", "ja"])
    func voucherPlanName(language: String) throws {
        let bundle = try bundle(language)
        var voucher = VoucherItem(id: "voucher", code: "INV-TEST", planKey: "couple", planName: "서버의 커플 이용권",
                                  planType: "family", status: "active", expiresAt: "2099-01-01")
        #expect(voucher.localizedPlanName(bundle: bundle) == (language == "en" ? "Couple" : "カップル"))
        #expect(voucher.planName == "서버의 커플 이용권")
        voucher.planKey = "unknown"
        #expect(voucher.localizedPlanName(bundle: bundle) == (language == "en" ? "Plan" : "利用券"))
        #expect(!voucher.localizedPlanName(bundle: bundle).contains(voucher.planName))
    }

    private func bundle(_ language: String) throws -> Bundle {
        let path = try #require(Bundle.main.path(forResource: language, ofType: "lproj"))
        return try #require(Bundle(path: path))
    }

    @Test("플랜 이름은 서버 키와 별칭으로 표시하고 모르는 키는 추측하지 않는다", arguments: ["en", "ja"])
    func planNames(language: String) throws {
        let bundle = try bundle(language)
        for key in ["personal", "individual", "plus", "plus_monthly", "plus_yearly"] {
            #expect(PlanTier.displayName(forPlanKey: key, bundle: bundle)
                    == (language == "en" ? "Personal" : "パーソナル"))
        }
        #expect(PlanTier.displayName(forPlanKey: "family", bundle: bundle)
                == (language == "en" ? "Family" : "ファミリー"))
        #expect(PlanTier.displayName(forPlanKey: "unknown", bundle: bundle) == nil)
        #expect(PlanTier.displayName(forPlanKey: nil, bundle: bundle) == nil)
    }

    @Test("가격 폴백은 KRW를 명시하고 월 서식과 결제 버튼의 역할을 구분한다", arguments: ["en", "ja"])
    func pricesAndActions(language: String) throws {
        let bundle = try bundle(language)
        let amount = try #require(FallbackPlanPrice.label(for: .personal, bundle: bundle))
        let monthly = bundle.localizedString(forKey: "월 %@", value: nil, table: nil)
        #expect(String(format: monthly, amount) == (language == "en" ? "KRW 3,900/month" : "月額3,900ウォン"))
        #expect(FallbackPlanPrice.label(for: .free, bundle: bundle) == nil)
        #expect(bundle.localizedString(forKey: "0원", value: nil, table: nil) == (language == "en" ? "Free" : "無料"))
        #expect(bundle.localizedString(forKey: "billing.confirm.subscribe", value: nil, table: nil)
                == (language == "en" ? "Subscribe" : "決済する"))
        #expect(bundle.localizedString(forKey: "결제하기", value: nil, table: nil)
                == (language == "en" ? "Pay" : "決済する"))
    }

    @Test("복원 결과의 건수와 다운그레이드 안내의 이름은 서식 인자로 유지된다", arguments: ["en", "ja"])
    func formatArguments(language: String) throws {
        let bundle = try bundle(language)
        let failedVerification = "결제를 확인하지 못했어요. '이전 구매 복원'을 눌러 다시 시도해 주세요."
        #expect(bundle.localizedString(forKey: failedVerification, value: nil, table: nil) != failedVerification)
        let restore = bundle.localizedString(forKey: "이전 구매 %lld건을 복원했어요.", value: nil, table: nil)
        #expect(String(format: restore, 3).contains("3"))
        #expect(!restore.contains("이전 구매"))
        let key = "지금은 결제되지 않아요. 지금 이용권을 기간 끝까지 쓰고, 다음 갱신일에 %@ 이용권으로 바뀌어요. 함께 쓰는 인원이 줄어서, 정원을 넘는 멤버는 그룹에서 나가게 돼요."
        let format = bundle.localizedString(forKey: key, value: nil, table: nil)
        #expect(format != key)
        #expect(String(format: format, "Personal").contains("Personal"))
    }
}
