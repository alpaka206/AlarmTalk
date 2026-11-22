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
                    == (language == "en" ? "Plus" : "プラス"))
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

    /// 복원 결과는 서버가 확인한 결과를 말한다(2026-11-22 — 스토어 개수로 'n건 복원' 이라고 하지 않는다).
    /// 문장은 안드로이드 `msg_gb_plan_applied`·`billing_restore_none` 의 번역과 같다.
    @Test("복원 결과 문장은 안드로이드와 같은 번역이다")
    func restoreResultTranslations() throws {
        let english = try bundle("en")
        #expect(RestoreResult.restored.localizedUserMessage(bundle: english) == "Your plan has been applied.")
        #expect(RestoreResult.nothingToRestore.localizedUserMessage(bundle: english) == "No purchases to restore. Check your store account.")
        let japanese = try bundle("ja")
        #expect(RestoreResult.restored.localizedUserMessage(bundle: japanese) == "プランを適用しました。")
        #expect(RestoreResult.nothingToRestore.localizedUserMessage(bundle: japanese) == "復元できる購入がありません。ストアのアカウントをご確認ください。")
    }

    @Test("결제 확인 실패 문장은 번역이 있다", arguments: ["en", "ja"])
    func formatArguments(language: String) throws {
        let bundle = try bundle(language)
        let failedVerification = "결제를 확인하지 못했어요. '이전 구매 복원'을 눌러 다시 시도해 주세요."
        #expect(bundle.localizedString(forKey: failedVerification, value: nil, table: nil) != failedVerification)
    }

    /// 이용권 새로고침 오류는 '무엇: 왜' 한 줄이다(`SocialFeatureViewModel.scopedRefreshErrorMessage`).
    @Test("이용권 새로고침 오류의 '라벨: 이유' 서식은 언어와 무관하다", arguments: ["en", "ja"])
    func scopedRefreshErrorFormat(language: String) throws {
        let bundle = try bundle(language)
        let scoped = bundle.localizedString(forKey: "%1$@: %2$@", value: nil, table: nil)
        #expect(String(format: scoped, "Plan", "Error") == "Plan: Error")
    }
}
