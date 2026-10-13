import SwiftUI

/// 가족 그룹 멤버 + 초대 코드 등록. 더보기의 '초대 코드 등록' 화면이다.
///
/// ContentView 의 `peoplePanel` 을 옮긴 것. Phase 3-C3 가 MemberManagement 로
/// 확장하므로 본 파일은 기존 구조 그대로 보존한다.
struct PeoplePanel: View {
    @EnvironmentObject private var socialFeatures: SocialFeatureViewModel

    var onCodeRegistered: (CodeRegistrationDestination) -> Void = { _ in }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let group = socialFeatures.familyGroup?.group {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(String(localized: "가족 그룹"))
                            .font(.headline)
                        Text(String(localized: "멤버 \(socialFeatures.familyGroup?.members.count ?? 0)/\(group.maxMembers)"))
                            .font(.footnote)
                            .foregroundStyle(AlarmTalkTheme.textSecondary)
                    }
                    Spacer()
                    PermissionPill(text: sharedPassRoleLabel(socialFeatures.familyGroup?.role))
                }

                ForEach(socialFeatures.familyGroup?.members ?? []) { member in
                    HStack {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(member.name ?? member.email ?? member.userId)
                                .font(.subheadline.weight(.semibold))
                            Text(member.allowFamilyAlarms == true ? String(localized: "상대방 알람 허용") : String(localized: "상대방 알람 꺼짐"))
                                .font(.caption)
                                .foregroundStyle(AlarmTalkTheme.textSecondary)
                        }
                        Spacer()
                        Text(sharedPassRoleLabel(member.role))
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(AlarmTalkTheme.textSecondary)
                    }
                    .padding(12)
                    .background(AlarmTalkTheme.surfaceVariant)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
            }
            // ⚠ **"…이 없어요" 빈 상태를 다시 넣지 말 것**(2026-08-13 지시).
            // 이 화면이 하는 일은 **초대 코드를 등록하는 것 하나**다(선물 코드는 2026-10-14 에
            // 없앴다 — `CodeRegisterRow` 주석). 없는 것을 두 줄에 걸쳐
            // 설명하면 정작 해야 할 일(입력칸)이 아래로 밀리고, 처음 온 사람은 화면 대부분이
            // '없다' 는 말인 화면을 본다. 그룹은 **있을 때만** 보여준다.

            CodeRegisterRow(onCodeRegistered: onCodeRegistered)

            // ⚠ **입력칸 아래 '내가 발급한 코드' 목록(`VoucherRow`)을 되살리지 말 것**(2026-10-14). 접두와 무관하게
            // 늘어놓아 지운 선물 코드(GIFT-)까지 코드 칸 바로 밑에 남겼고, 행마다 QR 글리프를 달아 없는 QR 기능을
            // 내보였다(App Store 지침 3.1.1 은 QR 코드를 금지된 해제 수단으로 든다). 안드로이드 같은 화면
            // (`ui/social/SocialPanels.kt` 의 `FamilyConnectionPanel`)에는 이런 목록이 없다. 초대 코드 공유는
            // 이용권 화면의 커플·가족 카드와 구성원 관리 화면에서 한다.
        }
        .sectionSurface()
    }
}

private func sharedPassRoleLabel(_ role: String?) -> String {
    let trimmed = role?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    switch trimmed {
    case "owner":
        return String(localized: "관리자")
    case "member":
        return String(localized: "구성원")
    default:
        // 알 수 없는 role 은 서버 원문 그대로 — 번역 대상이 아니다.
        return trimmed.isEmpty ? String(localized: "구성원") : trimmed
    }
}

#if DEBUG
#Preview("PeoplePanel (light)") {
    ScrollView {
        PeoplePanel().padding()
    }
    .voiceAlarmPreviewEnvironment()
}

#Preview("PeoplePanel (dark)") {
    ScrollView {
        PeoplePanel().padding()
    }
    .preferredColorScheme(.dark)
    .voiceAlarmPreviewEnvironment()
}
#endif
