import SwiftUI

/// 가족 초대 코드 / 이용권 코드 등록 행.
///
/// ContentView 의 `codeRegisterRow` 를 옮긴 것. PeoplePanel 에서 사용한다.
struct CodeRegisterRow: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var socialFeatures: SocialFeatureViewModel

    var onCodeRegistered: (CodeRegistrationDestination) -> Void = { _ in }

    @State private var inviteCodeDraft = ""
    @State private var voucherCodeDraft = ""
    @State private var showCodeInputs = false
    @State private var pendingDialog: CodeRegisterDialog?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if canManageShareCode {
                Text("공유 이용권을 관리 중이에요.")
                    .font(.footnote)
                    .foregroundStyle(AlarmTalkTheme.textSecondary)
            } else if hasActivePlan && !showCodeInputs {
                Text("\(activePlanName ?? "현재") 이용권 사용 중이에요. 등록은 이용권이 종료된 다음 가능해요.")
                    .font(.footnote)
                    .foregroundStyle(AlarmTalkTheme.textSecondary)
                Button {
                    if isSharedMember, let groupId = currentGroup?.id {
                        pendingDialog = .leave(groupId)
                    } else {
                        showCodeInputs = true
                    }
                } label: {
                    Text(isSharedMember ? "현재 이용권 나가고 새 코드 등록하기" : "다른 코드 등록하기")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .foregroundStyle(isSharedMember ? AlarmTalkTheme.error : AlarmTalkTheme.text)
                .disabled(socialFeatures.isBusy)
            } else {
                if hasActivePlan {
                    Text("등록하면 현재 \(activePlanName ?? "이용권") 이용권이 변경돼요.")
                        .font(.footnote)
                        .foregroundStyle(AlarmTalkTheme.textSecondary)
                }

                codeInputSection(
                    title: "초대 코드",
                    placeholder: "INV-XXXX-XXXX-XXXX",
                    text: Binding(
                        get: { inviteCodeDraft },
                        set: { inviteCodeDraft = normalizedCode($0, maxLength: 18) }
                    ),
                    submitLabel: "참여"
                )

                codeInputSection(
                    title: "이용권 코드",
                    placeholder: "GIFT-XXXX-XXXX-XXXX",
                    text: Binding(
                        get: { voucherCodeDraft },
                        set: { voucherCodeDraft = normalizedCode($0, maxLength: 19) }
                    ),
                    submitLabel: "등록"
                )
            }
        }
        .sheet(item: $pendingDialog) { dialog in
            switch dialog {
            case .leave(let groupId):
                CodeRegisterConfirmSheet(
                    title: "현재 이용권 나가고 새 코드 등록",
                    description: "현재 이용권에서 나가고 새 코드를 등록할까요?",
                    confirmLabel: "나가고 등록하기",
                    destructive: true,
                    onDismiss: { pendingDialog = nil },
                    onConfirm: {
                        pendingDialog = nil
                        showCodeInputs = true
                        Task {
                            await socialFeatures.leaveFamilyGroup(
                                groupId: groupId,
                                session: auth.session
                            )
                            await auth.refreshUser()
                        }
                    }
                )
                .presentationDetents([.medium])
            case .register(let code):
                CodeRegisterConfirmSheet(
                    title: "코드 등록",
                    description: registerDescription,
                    confirmLabel: "등록",
                    destructive: false,
                    onDismiss: { pendingDialog = nil },
                    onConfirm: {
                        pendingDialog = nil
                        inviteCodeDraft = ""
                        voucherCodeDraft = ""
                        Task {
                            if let destination = await socialFeatures.registerCode(
                                code,
                                session: auth.session
                            ) {
                                await auth.refreshUser()
                                await MainActor.run {
                                    onCodeRegistered(destination)
                                }
                            }
                        }
                    }
                )
                .presentationDetents([.medium])
            }
        }
    }

    private var currentGroup: FamilyGroup? {
        socialFeatures.familyGroup?.group
    }

    private var isSharedMember: Bool {
        currentGroup != nil && socialFeatures.familyGroup?.role == "member"
    }

    private var canManageShareCode: Bool {
        currentGroup != nil &&
            socialFeatures.familyGroup?.role == "owner" &&
            socialFeatures.subscription?.plan?.planType == "family"
    }

    private var activePlanName: String? {
        guard socialFeatures.subscription?.subscription != nil else { return nil }
        return socialFeatures.subscription?.plan?.name
            ?? codeRegisterPlanName(socialFeatures.subscription?.plan?.key)
    }

    private var hasActivePlan: Bool {
        activePlanName != nil
    }

    private var registerDescription: String {
        if hasActivePlan {
            return "등록 가능한 코드라면 현재 \(activePlanName ?? "이용권") 이용권은 종료되고 새 이용권으로 바뀌어요. 등록할까요?"
        }
        return "이 코드를 등록할까요?"
    }

    private func codeInputSection(
        title: String,
        placeholder: String,
        text: Binding<String>,
        submitLabel: String
    ) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(AlarmTalkTheme.text)
            HStack(spacing: 8) {
                TextField(placeholder, text: text)
                    .textFieldStyle(.roundedBorder)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                Button {
                    pendingDialog = .register(text.wrappedValue)
                } label: {
                    Text(submitLabel)
                }
                .buttonStyle(.borderedProminent)
                .tint(AlarmTalkTheme.primary)
                .foregroundStyle(AlarmTalkTheme.text)
                .disabled(
                    text.wrappedValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
                        socialFeatures.isBusy
                )
            }
        }
    }
}

private enum CodeRegisterDialog: Identifiable, Equatable {
    case leave(String)
    case register(String)

    var id: String {
        switch self {
        case .leave(let groupId): return "leave-\(groupId)"
        case .register(let code): return "register-\(code)"
        }
    }
}

private struct CodeRegisterConfirmSheet: View {
    let title: String
    let description: String
    let confirmLabel: String
    let destructive: Bool
    let onDismiss: () -> Void
    let onConfirm: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(title)
                        .font(.headline.weight(.bold))
                        .foregroundStyle(AlarmTalkTheme.text)
                    Text(description)
                        .font(.footnote)
                        .foregroundStyle(AlarmTalkTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer()
                Button(action: onDismiss) {
                    Image(systemName: "xmark")
                        .font(.subheadline.weight(.semibold))
                        .padding(8)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("닫기")
            }

            if destructive {
                Button(role: .destructive, action: onConfirm) {
                    Text(confirmLabel)
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                }
                .buttonStyle(.borderedProminent)
                .tint(AlarmTalkTheme.error)
                .foregroundStyle(.white)
            } else {
                Button(action: onConfirm) {
                    Text(confirmLabel)
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                }
                .buttonStyle(.borderedProminent)
                .tint(AlarmTalkTheme.primary)
                .foregroundStyle(.white)
            }
        }
        .padding(20)
        .background(AlarmTalkTheme.background)
    }
}

private func normalizedCode(_ value: String, maxLength: Int) -> String {
    String(
        value
            .uppercased()
            .filter { $0.isLetter || $0.isNumber || $0 == "-" }
            .prefix(maxLength)
    )
}

private func codeRegisterPlanName(_ planKey: String?) -> String {
    switch planKey {
    case "free":
        return "무료"
    case "personal", "individual", "plus":
        return "개인"
    case "couple":
        return "커플"
    case "family":
        return "가족"
    default:
        return "이용권"
    }
}

#if DEBUG
#Preview("CodeRegisterRow") {
    CodeRegisterRow()
        .padding()
        .voiceAlarmPreviewEnvironment()
}
#endif
