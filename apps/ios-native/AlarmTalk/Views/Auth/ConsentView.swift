import SwiftUI

/// 로그인 후 필수 약관/개인정보 동의를 받는 게이트 화면.
/// 신규 가입자뿐 아니라 기존 가입자도 미동의 시 이 화면을 통과해야 앱을 쓸 수 있다.
///
/// 필수: 만14세 이상 / 이용약관 / 개인정보 처리방침
/// 선택: 광고성 정보 수신(마케팅)
///
/// Android `ConsentScreen.kt` 의 1:1 포팅.
struct ConsentView: View {
    let busy: Bool
    let onAgree: (_ marketingAgreed: Bool) -> Void
    let onOpenTerms: () -> Void
    let onOpenPrivacy: () -> Void

    @State private var age14 = false
    @State private var terms = false
    @State private var privacy = false
    @State private var marketing = false

    private var allRequiredChecked: Bool { age14 && terms && privacy }
    private var allChecked: Bool { allRequiredChecked && marketing }

    private func setAll(_ value: Bool) {
        age14 = value
        terms = value
        privacy = value
        marketing = value
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer().frame(height: 24)

            Text("서비스 이용을 위해\n약관에 동의해 주세요")
                .font(.title2.weight(.bold))
                .foregroundStyle(AlarmTalkTheme.text)

            Spacer().frame(height: 8)

            Text("원활한 서비스 제공을 위해 아래 약관에 대한 동의가 필요해요.")
                .font(.subheadline)
                .foregroundStyle(AlarmTalkTheme.textSecondary)

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Spacer().frame(height: 24)
                    ConsentRow(
                        checked: allChecked,
                        onToggle: { setAll(!allChecked) },
                        label: "약관 전체 동의",
                        emphasized: true
                    )
                    Spacer().frame(height: 4)
                    Divider()
                    Spacer().frame(height: 4)
                    ConsentRow(checked: age14, onToggle: { age14.toggle() }, label: "[필수] 만 14세 이상입니다")
                    ConsentRow(checked: terms, onToggle: { terms.toggle() }, label: "[필수] 이용약관 동의", onOpenDetail: onOpenTerms)
                    ConsentRow(checked: privacy, onToggle: { privacy.toggle() }, label: "[필수] 개인정보 처리방침 동의", onOpenDetail: onOpenPrivacy)
                    ConsentRow(checked: marketing, onToggle: { marketing.toggle() }, label: "[선택] 광고성 정보 수신 동의")
                }
            }

            Button {
                onAgree(marketing)
            } label: {
                Text(busy ? "처리 중…" : "동의하고 시작하기")
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity, minHeight: 50)
            }
            .buttonStyle(.borderedProminent)
            .tint(AlarmTalkTheme.primary)
            .disabled(!allRequiredChecked || busy)
            .padding(.vertical, 16)
        }
        .padding(.horizontal, 24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(AlarmTalkTheme.background)
    }
}

private struct ConsentRow: View {
    let checked: Bool
    let onToggle: () -> Void
    let label: String
    var emphasized: Bool = false
    var onOpenDetail: (() -> Void)? = nil

    var body: some View {
        HStack(spacing: 8) {
            Button(action: onToggle) {
                HStack(spacing: 8) {
                    Image(systemName: checked ? "checkmark.square.fill" : "square")
                        .font(.title3)
                        .foregroundStyle(checked ? AlarmTalkTheme.primary : AlarmTalkTheme.textSecondary)
                    Text(label)
                        .font(emphasized ? .body.weight(.bold) : .body)
                        .foregroundStyle(AlarmTalkTheme.text)
                        .multilineTextAlignment(.leading)
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if let onOpenDetail {
                Button("보기", action: onOpenDetail)
                    .font(.subheadline)
                    .foregroundStyle(AlarmTalkTheme.primary)
            }
        }
        .padding(.vertical, 4)
    }
}

#if DEBUG
#Preview("Consent (light)") {
    ConsentView(busy: false, onAgree: { _ in }, onOpenTerms: {}, onOpenPrivacy: {})
        .voiceAlarmPreviewEnvironment()
}

#Preview("Consent (dark)") {
    ConsentView(busy: false, onAgree: { _ in }, onOpenTerms: {}, onOpenPrivacy: {})
        .preferredColorScheme(.dark)
        .voiceAlarmPreviewEnvironment()
}
#endif
