import SwiftUI

/// 가족 초대 코드 / 이용권 코드 등록 행.
///
/// ContentView 의 `codeRegisterRow` 를 옮긴 것. PeoplePanel 에서 사용한다.
struct CodeRegisterRow: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var socialFeatures: SocialFeatureViewModel

    var onCodeRegistered: (CodeRegistrationDestination) -> Void = { _ in }

    @State private var codeDraft = ""
    @State private var showCodeInputs = false
    /// 나가기 확인 대상 그룹. nil 이면 알럿을 띄우지 않는다.
    @State private var leaveGroupId: String?
    /// 등록 확인 대상 코드. nil 이면 알럿을 띄우지 않는다.
    @State private var pendingCode: String?

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
                        leaveGroupId = groupId
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

                // ⚠ **입력창은 하나다.** 예전에는 '초대 코드'(INV-…)와 '이용권 코드'(GIFT-…)로
                // 나뉘어 있었는데, 서버는 처음부터 통합 엔드포인트(`POST /code/register`)로
                // 바우처·가족 초대·프로모를 **한 번에 판별**한다. 칸을 나누면 두 가지가 깨진다:
                //   1. **프로모션 코드가 갈 곳이 없다.** 어느 칸에 넣어야 하는지 화면이
                //      말해 주지 않고, 라벨은 오히려 "둘 중 하나여야 한다" 고 오해시킨다.
                //   2. 받는 사람은 자기 코드가 어떤 종류인지 모른다 — 그건 서버가 안다.
                // 안드로이드는 이미 한 칸으로 합쳐 두었다(`ui/social/SocialPanels.kt` 의
                // "통합 입력" 주석과 `CodeRedeemField`). iOS 만 옛 2칸으로 남아 있었다.
                Text("코드 입력")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(AlarmTalkTheme.text)
                Text("초대 코드, 이용권 선물 코드, 프로모션 코드 모두 등록할 수 있어요.")
                    .font(.footnote)
                    .foregroundStyle(AlarmTalkTheme.textSecondary)
                HStack(spacing: 8) {
                    TextField("초대·선물·프로모션 코드", text: Binding(
                        get: { codeDraft },
                        set: { codeDraft = InputSanitizer.sanitizeRedeemCode($0) }
                    ))
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .alarmTalkFieldStyle()
                    Button("등록") {
                        pendingCode = codeDraft
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(AlarmTalkTheme.primary)
                    .foregroundStyle(.white)
                    .disabled(
                        codeDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
                            socialFeatures.isBusy
                    )
                }
            }
        }
        // ⚠ **확인은 시스템 알럿으로 낸다.** 예전에는 하프 시트(`presentationDetents([.medium])`)
        // 였는데, 그 껍데기는 제목 옆에 X 를 따로 두어 '닫기' 와 '취소' 가 같은 일을 하는
        // 버튼 둘이 됐다(CLAUDE.md 「모달」 — 취소와 같은 일을 하는 버튼을 두 개 두지 않는다).
        // 다른 확인형 모달은 이미 전부 `.alert` 로 통일돼 있었고 여기만 남아 있었다.
        .alert(
            "현재 이용권에서 나가고 새 코드를 등록할까요?",
            isPresented: Binding(
                get: { leaveGroupId != nil },
                set: { if !$0 { leaveGroupId = nil } }
            ),
            presenting: leaveGroupId
        ) { groupId in
            Button("취소", role: .cancel) { leaveGroupId = nil }
            Button("나가고 등록하기", role: .destructive) {
                leaveGroupId = nil
                showCodeInputs = true
                Task {
                    await socialFeatures.leaveFamilyGroup(groupId: groupId, session: auth.session)
                    await auth.refreshUser()
                }
            }
        }
        .alert(
            "이 코드를 등록할까요?",
            isPresented: Binding(
                get: { pendingCode != nil },
                set: { if !$0 { pendingCode = nil } }
            ),
            presenting: pendingCode
        ) { code in
            Button("취소", role: .cancel) { pendingCode = nil }
            Button("등록") {
                pendingCode = nil
                codeDraft = ""
                Task {
                    if let destination = await socialFeatures.registerCode(code, session: auth.session) {
                        await auth.refreshUser()
                        await MainActor.run { onCodeRegistered(destination) }
                    }
                }
            }
        } message: { _ in
            // 이용권을 쓰는 중일 때만 부가 설명이 붙는다(안드로이드와 같다).
            if hasActivePlan {
                Text("등록 가능한 코드라면 현재 \(activePlanName ?? "이용권") 이용권은 종료되고 새 이용권으로 바뀌어요.")
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
