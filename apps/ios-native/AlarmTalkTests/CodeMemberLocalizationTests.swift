import Foundation
import Testing
@testable import AlarmTalk

@MainActor
struct CodeMemberLocalizationTests {
    @Test("등록을 시작하지 못했을 때 지난 작업 안내를 오류로 재사용하지 않는다")
    func busyRegistrationClearsPreviousMessage() async {
        let model = SocialFeatureViewModel()
        model.isBusy = true
        model.statusMessage = "지난 작업의 성공 안내"
        let session = AuthSession(token: "test-token", user: AuthUser(id: "code-test", email: "test@example.test"))
        let destination = await model.registerCode("INV-TEST", session: session)
        #expect(destination == nil)
        #expect(model.statusMessage == nil)
        #expect(model.isBusy)
        model.statusMessage = "이전 안내"
        let failure = await model.registerCodeReportingFailure("INV-TEST", session: session)
        #expect(failure == String(localized: "코드 등록에 실패했어요."))
    }

    @Test("코드 등록 버튼과 공유 그룹 이름을 각 역할에 맞게 표시한다", arguments: ["en", "ja"])
    func codeAndGroupLabels(language: String) throws {
        let path = try #require(Bundle.main.path(forResource: language, ofType: "lproj"))
        let bundle = try #require(Bundle(path: path))
        #expect(bundle.localizedString(forKey: "code.redeem.submit", value: nil, table: nil)
                == (language == "en" ? "Redeem" : "登録"))
        #expect(bundle.localizedString(forKey: "group.plan.shared", value: nil, table: nil)
                == (language == "en" ? "Shared" : "共有"))
        let plan = try #require(PlanTier.displayName(forPlanKey: "family", bundle: bundle))
        let format = bundle.localizedString(forKey: "%@ 이용권", value: nil, table: nil)
        #expect(String(format: format, plan) == (language == "en" ? "Family plan" : "ファミリー利用券"))
        let voucher = bundle.localizedString(forKey: "%@ · %@ · %lld/%lld", value: nil, table: nil)
        #expect(String(format: voucher, plan, "Active", 2, 4) == "\(plan) · Active · 2/4")
        let scoped = bundle.localizedString(forKey: "%1$@: %2$@", value: nil, table: nil)
        #expect(String(format: scoped, "Plan", "Error") == "Plan: Error")
    }
}
