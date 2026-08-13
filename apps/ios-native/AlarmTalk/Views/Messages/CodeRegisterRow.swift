// ⚠ **파일 이름이 `VoiceMessagePanel` 이었다 — 내용과 달랐다**(2026-08-12 개명).
// 음성 메시지 기능은 오래전에 없어졌는데 껍데기 이름만 남아, "음성 메시지 잔존물" 을
// 찾을 때 **살아 있는 코드 등록 UI 가 삭제 후보로 잡혔다.** 실제 내용은 이용권 코드 등록
// 행(`PeoplePanel` 이 쓴다)이다.
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
    /// 실패 사유. **입력창 바로 밑에** 빨간 글씨로 낸다.
    ///
    /// ⚠ **알럿으로 되돌리지 말 것**(2026-08-13 지시). 코드를 잘못 친 것은 그 자리에서
    /// 고치면 되는 일이라, 알럿을 띄우면 닫고 → 다시 입력창을 찾는 걸음이 하나 더 는다.
    /// 무엇이 틀렸는지도 입력한 값 옆에 있어야 읽힌다.
    @State private var codeError: String?

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
                    Text(isSharedMember ? "나가고 등록하기" : "다른 코드 등록")
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
                    // ⚠ **커스텀 `Binding` 의 setter 에서 정리하지 말 것.**
                    // 거기서 값을 바꿔도 `TextField` 가 제 내부 상태를 그대로 들고 있어
                    // **화면에는 친 그대로 남는다** — 소문자도 한글도 그대로 보이다가
                    // 제출할 때에야 바뀐다(2026-08-13 지적). `onChange` 로 고쳐야 반영된다.
                    // 같은 이유로 `WeatherCityPickerSheet` 도 `onChange` 를 쓴다.
                    TextField("초대·선물·프로모션 코드", text: $codeDraft)
                    // ⚠ **ASCII 키보드를 요구한다.** 한글은 걸러 내기 **전에** 아예 못 치게
                    // 하는 편이 낫다 — 걸러 내기만 하면 조합 중인 글자가 잠깐 보였다 사라져
                    // 고장처럼 보인다.
                    .keyboardType(.asciiCapable)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .onChange(of: codeDraft) { _, new in
                        let cleaned = InputSanitizer.sanitizeRedeemCode(new)
                        if cleaned != new { codeDraft = cleaned }
                        // 고치기 시작하면 지난 실패 문구를 지운다 — 남겨 두면 방금 고친
                        // 값에 대고 틀렸다고 말하는 셈이다.
                        codeError = nil
                    }
                    .alarmTalkFieldStyle()
                    Button("등록") {
                        pendingCode = codeDraft
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(AlarmTalkTheme.primary)
                    // ⚠ **글자색을 흰색으로 못 박지 말 것.** 다크 테마의 `primary` 는 밝은
                    // 하늘색이고 그 위 글자색(`onPrimary`)은 **진남색(#08243C)** 이다 —
                    // 흰색으로 고정하면 밝은 배경에 흰 글자가 되어 **안 보인다**
                    // (2026-08-13 지적). 편집기·목소리 화면의 다른 prominent 버튼들은
                    // 전부 `.tint` 만 주고 글자색은 시스템에 맡긴다. 여기만 달랐다.
                    .disabled(
                        codeDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
                            socialFeatures.isBusy
                    )
                }

                if let codeError {
                    Text(codeError)
                        .font(.footnote)
                        .foregroundStyle(AlarmTalkTheme.error)
                        .fixedSize(horizontal: false, vertical: true)
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
                        await MainActor.run { codeError = nil }
                        await auth.refreshUser()
                        await MainActor.run { onCodeRegistered(destination) }
                    } else {
                        // 실패 사유를 입력창 밑으로 **옮긴다.** 되돌려 넣어 주어야 다시
                        // 고칠 수 있다.
                        //
                        // ⚠ **위 배너의 문구도 지운다.** 안 지우면 화면 위(공용 상태 배너)와
                        // 입력창 밑에 **같은 말이 두 번** 뜬다(2026-08-13 지적).
                        // 이 화면에서는 입력창 밑이 제자리다 — 틀린 값 바로 옆이라야 읽힌다.
                        await MainActor.run {
                            codeError = socialFeatures.statusMessage ?? "잘못된 코드입니다."
                            socialFeatures.statusMessage = nil
                            codeDraft = code
                        }
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
