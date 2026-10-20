import Foundation
import Testing
@testable import AlarmTalk

@MainActor
struct BillingLocalizationTests {
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
        // 커플·가족 이용권은 없어졌다 — 그 키도 모르는 키다.
        for key in ["couple", "family", "unknown"] {
            #expect(PlanTier.displayName(forPlanKey: key, bundle: bundle) == nil)
        }
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

    @Test("영어 구매 복원 결과는 한 건과 여러 건을 구분한다")
    func restoredPurchaseCount() throws {
        let english = try bundle("en")
        #expect(RestoreResult.restored(count: 1).localizedUserMessage(bundle: english) == "Restored 1 purchase.")
        #expect(RestoreResult.restored(count: 3).localizedUserMessage(bundle: english) == "Restored 3 purchases.")
    }

    @Test("복원 결과의 건수는 서식 인자로 유지된다", arguments: ["en", "ja"])
    func formatArguments(language: String) throws {
        let bundle = try bundle(language)
        let failedVerification = "결제를 확인하지 못했어요. '이전 구매 복원'을 눌러 다시 시도해 주세요."
        #expect(bundle.localizedString(forKey: failedVerification, value: nil, table: nil) != failedVerification)
        let restore = bundle.localizedString(forKey: "이전 구매 %lld건을 복원했어요.", value: nil, table: nil)
        #expect(String(format: restore, 3).contains("3"))
        #expect(!restore.contains("이전 구매"))
    }

    /// 이용권 새로고침 오류는 '무엇: 왜' 한 줄이다(`SocialFeatureViewModel.scopedRefreshErrorMessage`).
    @Test("이용권 새로고침 오류의 '라벨: 이유' 서식은 언어와 무관하다", arguments: ["en", "ja"])
    func scopedRefreshErrorFormat(language: String) throws {
        let bundle = try bundle(language)
        let scoped = bundle.localizedString(forKey: "%1$@: %2$@", value: nil, table: nil)
        #expect(String(format: scoped, "Plan", "Error") == "Plan: Error")
    }
}
