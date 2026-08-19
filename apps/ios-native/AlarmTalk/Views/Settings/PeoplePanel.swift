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
            }
            // ⚠ **"…이 없어요" 빈 상태를 다시 넣지 말 것**(2026-08-13 지시).
            // 이 화면이 하는 일은 **코드를 등록하는 것 하나**다. 없는 것을 두 줄에 걸쳐
            // 설명하면 정작 해야 할 일(입력칸)이 아래로 밀리고, 처음 온 사람은 화면 대부분이
            // '없다' 는 말인 화면을 본다. 그룹·공유 코드는 **있을 때만** 보여준다.

            CodeRegisterRow(onCodeRegistered: onCodeRegistered)

            ForEach(socialFeatures.vouchers.prefix(4)) { voucher in
                VoucherRow(voucher: voucher)
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
                .foregroundStyle(AlarmTalkTheme.primary)
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
        return String(localized: "관리자")
    case "member":
        return String(localized: "구성원")
    default:
        // 알 수 없는 role 은 서버 원문 그대로 — 번역 대상이 아니다.
        return trimmed.isEmpty ? String(localized: "구성원") : trimmed
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
