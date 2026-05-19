import SwiftUI

/// 가족 그룹 멤버 + 초대코드 등록 + 공유 코드 목록.
///
/// ContentView 의 `peoplePanel` 을 옮긴 것. Phase 3-C3 가 MemberManagement 로
/// 확장하므로 본 파일은 기존 구조 그대로 보존한다.
struct PeoplePanel: View {
    @EnvironmentObject private var socialFeatures: SocialFeatureViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let group = socialFeatures.familyGroup?.group {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("가족 그룹")
                            .font(.headline)
                        Text("멤버 \(socialFeatures.familyGroup?.members.count ?? 0)/\(group.maxMembers)")
                            .font(.footnote)
                            .foregroundStyle(VoiceAlarmTheme.textSecondary)
                    }
                    Spacer()
                    PermissionPill(text: socialFeatures.familyGroup?.role ?? "member")
                }

                ForEach(socialFeatures.familyGroup?.members ?? []) { member in
                    HStack {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(member.name ?? member.email ?? member.userId)
                                .font(.subheadline.weight(.semibold))
                            Text(member.allowFamilyAlarms == true ? "상대방 알람 허용" : "상대방 알람 꺼짐")
                                .font(.caption)
                                .foregroundStyle(VoiceAlarmTheme.textSecondary)
                        }
                        Spacer()
                        Text(member.role)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(VoiceAlarmTheme.textSecondary)
                    }
                    .padding(12)
                    .background(VoiceAlarmTheme.surfaceVariant)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
            } else {
                EmptyStatePlaceholder(
                    title: "가족 그룹이 없어요.",
                    subtitle: "공유 코드를 등록하거나 가족 이용권 공유 코드를 만든 뒤 함께 쓰는 알람을 사용할 수 있어요.",
                    icon: "person.2"
                )
            }

            CodeRegisterRow()

            if socialFeatures.vouchers.isEmpty {
                Text("발급된 공유 코드가 없어요.")
                    .font(.footnote)
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
            } else {
                ForEach(socialFeatures.vouchers.prefix(4)) { voucher in
                    VoucherRow(voucher: voucher)
                }
            }
        }
        .sectionSurface()
    }
}

/// 공유 코드 한 줄.
///
/// ContentView 의 `voucherRow(_:)` 헬퍼를 옮긴 것. Billing 패널과
/// PeoplePanel 두 곳에서 사용한다.
struct VoucherRow: View {
    let voucher: VoucherItem

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(voucher.code)
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(VoiceAlarmTheme.text)
                Text("\(voucher.planName) · \(voucher.status) · \(voucher.useCount ?? 0)/\(voucher.maxUses ?? 1)")
                    .font(.caption)
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
            }
            Spacer()
            Image(systemName: "qrcode")
                .foregroundStyle(VoiceAlarmTheme.primaryDark)
        }
        .padding(12)
        .background(VoiceAlarmTheme.surfaceVariant)
        .clipShape(RoundedRectangle(cornerRadius: 8))
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
