import SwiftUI

/// 가족 그룹 멤버 + 초대코드 등록 + 공유 코드 목록.
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
                        Text("가족 그룹")
                            .font(.headline)
                        Text("멤버 \(socialFeatures.familyGroup?.members.count ?? 0)/\(group.maxMembers)")
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
                            Text(member.allowFamilyAlarms == true ? "상대방 알람 허용" : "상대방 알람 꺼짐")
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
            } else {
                EmptyStatePlaceholder(
                    title: "가족 그룹이 없어요.",
                    subtitle: "공유 코드를 등록하거나 가족 이용권 공유 코드를 만든 뒤 함께 쓰는 알람을 사용할 수 있어요.",
                    icon: "person.2"
                )
            }

            CodeRegisterRow(onCodeRegistered: onCodeRegistered)

            if socialFeatures.vouchers.isEmpty {
                Text("발급된 공유 코드가 없어요.")
                    .font(.footnote)
                    .foregroundStyle(AlarmTalkTheme.textSecondary)
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
                    .foregroundStyle(AlarmTalkTheme.text)
                Text("\(voucher.planName) · \(voucherStatusLabel(voucher.status)) · \(voucher.useCount ?? 0)/\(voucher.maxUses ?? 1)")
                    .font(.caption)
                    .foregroundStyle(AlarmTalkTheme.textSecondary)
            }
            Spacer()
            Image(systemName: "qrcode")
                .foregroundStyle(AlarmTalkTheme.primaryDark)
        }
        .padding(12)
        .background(AlarmTalkTheme.surfaceVariant)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private func sharedPassRoleLabel(_ role: String?) -> String {
    let trimmed = role?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    switch trimmed {
    case "owner":
        return "관리자"
    case "member":
        return "구성원"
    default:
        return trimmed.isEmpty ? "구성원" : trimmed
    }
}

private func voucherStatusLabel(_ status: String?) -> String {
    let trimmed = status?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    switch trimmed {
    case "active", "issued":
        return "사용 가능"
    case "pending":
        return "대기 중"
    case "redeemed", "used":
        return "사용됨"
    case "expired":
        return "만료됨"
    case "revoked", "cancelled", "canceled":
        return "취소됨"
    default:
        return trimmed.isEmpty ? "상태 없음" : trimmed
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
