import SwiftUI
import UIKit

/// 가족/커플 그룹 멤버 관리 화면.
///
/// Android `apps/android-native/.../ui/members/MemberManagementScreen.kt:48-332` 의
/// 모든 동작을 1:1 포팅했다.
///
/// 기능 요약
///   - 그룹 정보 카드: 현재 인원 / 최대 인원, 내 역할 칩
///   - 소유자 전용 공유 코드 카드: 코드 표시 + 클립보드 복사 + Share Sheet,
///     코드가 없을 땐 발급 버튼 노출. 정원 가득 차면 발급/공유 비활성.
///   - 구성원 리스트: 소유자(관리자) 표시, "나" 표시, allowFamilyAlarms 상태,
///     소유자가 다른 멤버를 내보낼 수 있는 액션 버튼.
///   - 강퇴 확인 alert: 안전한 destructive 액션.
struct MemberManagementView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var socialFeatures: SocialFeatureViewModel
    @Environment(\.voiceAlarmTheme) private var theme
    @Environment(\.dismiss) private var dismiss

    @State private var pendingRemoveMember: FamilyGroupMember?
    @State private var isSharePresented = false
    @State private var shareText: String = ""
    @State private var showFamilyAlarmDialog = false

    private var familyGroup: FamilyGroupCurrentResponse? { socialFeatures.familyGroup }
    private var group: FamilyGroup? { familyGroup?.group }
    private var members: [FamilyGroupMember] { familyGroup?.members ?? [] }
    private var currentUserID: String? { auth.session?.user.id }
    private var isOwner: Bool { familyGroup?.role == "owner" && group != nil }
    private var activePlanKey: String? { socialFeatures.subscription?.plan?.key }
    private var planLabel: String {
        switch activePlanKey {
        case "couple": return "커플"
        case "family": return "가족"
        default: return "공유"
        }
    }

    /// 멤버 정렬: 소유자 먼저, 그 다음 가입일 오름차순.
    private var sortedMembers: [FamilyGroupMember] {
        members.sorted { lhs, rhs in
            if (lhs.role == "owner") != (rhs.role == "owner") {
                return lhs.role == "owner"
            }
            return lhs.joinedAt < rhs.joinedAt
        }
    }

    private var isCapacityFull: Bool {
        guard let group else { return false }
        return sortedMembers.count >= group.maxMembers
    }

    /// 현재 활성 plan 에 맞는 INV- 시작 가족 공유 voucher 가 있다면 그것을 사용.
    private var shareVoucher: VoucherItem? {
        socialFeatures.vouchers.first { voucher in
            guard voucher.code.hasPrefix("INV-"),
                  voucher.planType == "family",
                  !["expired", "revoked", "cancelled"].contains(voucher.status)
            else { return false }
            if let activePlanKey {
                return voucher.planKey == activePlanKey
            }
            return true
        }
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                header

                if group == nil {
                    Text("참여 중인 공유 이용권이 없어요.")
                        .font(theme.typography.bodyMedium)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                        .padding(.vertical, 24)
                } else {
                    capacityRow

                    if let user = auth.session?.user {
                        FamilyAlarmPermissionCard(
                            allowFamilyAlarms: user.allowFamilyAlarms ?? false,
                            quietWindows: user.familyAlarmQuietWindows ?? [],
                            isBusy: auth.isBusy || socialFeatures.isBusy,
                            onToggle: { nextValue in
                                Task {
                                    await auth.updateProfile(allowFamilyAlarms: nextValue)
                                    await socialFeatures.refreshAll(session: auth.session)
                                }
                            },
                            onEditQuietTime: { showFamilyAlarmDialog = true }
                        )
                    }

                    if isOwner {
                        sectionTitle("공유 코드")
                        shareCodeSection
                    }

                    sectionTitle("구성원")
                    ForEach(sortedMembers) { member in
                        MemberRow(
                            member: member,
                            isMe: member.userId == currentUserID,
                            showRemove: isOwner
                                && member.role != "owner"
                                && member.userId != currentUserID,
                            removeEnabled: !socialFeatures.isBusy,
                            onRemove: { pendingRemoveMember = member }
                        )
                    }

                    if !isOwner, let group, members.contains(where: { $0.userId == currentUserID }) {
                        leaveButton(group: group)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
        .background(theme.palette.background.ignoresSafeArea())
        .navigationTitle("구성원과 공유 코드")
        .navigationBarTitleDisplayMode(.inline)
        .alert(
            "멤버 내보내기",
            isPresented: Binding(
                get: { pendingRemoveMember != nil },
                set: { if !$0 { pendingRemoveMember = nil } }
            ),
            presenting: pendingRemoveMember
        ) { member in
            Button("내보내기", role: .destructive) {
                guard let groupId = group?.id else { return }
                Task {
                    await socialFeatures.removeMember(
                        groupId: groupId,
                        userId: member.userId,
                        session: auth.session
                    )
                }
                pendingRemoveMember = nil
            }
            Button("취소", role: .cancel) {
                pendingRemoveMember = nil
            }
        } message: { member in
            let label = member.name ?? member.email ?? "이 멤버"
            Text("\(label)을(를) 정말 내보낼까요? 다시 들어오려면 새 초대 코드가 필요해요.")
        }
        .sheet(isPresented: $isSharePresented) {
            ActivityShareSheet(text: shareText)
                .ignoresSafeArea()
        }
        .sheet(isPresented: $showFamilyAlarmDialog) {
            FamilyAlarmQuietTimeDialog(
                initialWindows: auth.session?.user.familyAlarmQuietWindows ?? [],
                onCancel: { showFamilyAlarmDialog = false },
                onConfirm: { windows in
                    showFamilyAlarmDialog = false
                    Task {
                        await auth.updateProfile(
                            allowFamilyAlarms: true,
                            quietWindows: windows
                        )
                        await socialFeatures.refreshAll(session: auth.session)
                    }
                }
            )
            .presentationDetents([.large])
        }
        .task(id: auth.session?.token) {
            await socialFeatures.refreshAll(session: auth.session)
        }
    }

    // MARK: - Sections

    private var header: some View {
        HStack(spacing: 0) {
            Button {
                dismiss()
            } label: {
                Image(systemName: "chevron.backward")
                    .padding(8)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("뒤로")

            Spacer().frame(width: 4)
        }
    }

    private var capacityRow: some View {
        Text("현재 \(sortedMembers.count)/\(group?.maxMembers ?? 0)명")
            .font(theme.typography.bodyMedium)
            .foregroundStyle(theme.palette.onSurfaceVariant)
    }

    private func sectionTitle(_ text: String) -> some View {
        Text(text)
            .font(theme.typography.titleMedium.weight(.semibold))
            .foregroundStyle(theme.palette.onSurface)
            .padding(.top, 6)
    }

    @ViewBuilder
    private var shareCodeSection: some View {
        if let voucher = shareVoucher {
            shareCodeCard(voucher: voucher)
        } else {
            VStack(alignment: .leading, spacing: 10) {
                Text(isCapacityFull
                     ? "정원이 가득 차서 더 이상 공유할 수 없어요."
                     : "공유 코드가 아직 없어요. \(planLabel) 구성원을 초대할 INV 코드를 만들어 주세요.")
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(theme.palette.onSurfaceVariant)

                Button {
                    Task { await socialFeatures.ensureFamilyShareCode(session: auth.session) }
                } label: {
                    Text(isCapacityFull ? "공유 불가" : "공유 코드 만들기")
                        .font(theme.typography.labelLarge)
                        .frame(maxWidth: .infinity, minHeight: 46)
                }
                .buttonStyle(.bordered)
                .disabled(socialFeatures.isBusy || isCapacityFull)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
        }
    }

    private func shareCodeCard(voucher: VoucherItem) -> some View {
        let isFull = isCapacityFull
            || ((voucher.useCount ?? 0) >= (voucher.maxUses ?? 1))

        return VStack(alignment: .leading, spacing: 8) {
            Text(voucher.code)
                .font(theme.typography.titleMedium.weight(.semibold))
                .foregroundStyle(theme.palette.onSurface)
                .textSelection(.enabled)

            Text(isFull
                 ? "\(voucher.useCount ?? 0)/\(voucher.maxUses ?? 1)명 사용 · 정원이 가득 차서 공유할 수 없어요"
                 : "\(voucher.useCount ?? 0)/\(voucher.maxUses ?? 1)명 사용")
                .font(theme.typography.bodySmall)
                .foregroundStyle(theme.palette.onSurfaceVariant)

            HStack(spacing: 8) {
                Button {
                    UIPasteboard.general.string = voucher.code
                } label: {
                    Label("코드 복사", systemImage: "doc.on.doc")
                        .font(theme.typography.labelLarge)
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.bordered)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))

                Button {
                    Task {
                        await socialFeatures.refreshAll(session: auth.session)
                        shareText = shareVoucher?.code ?? voucher.code
                        isSharePresented = true
                    }
                } label: {
                    Label(isFull ? "공유 불가" : "공유하기", systemImage: "square.and.arrow.up")
                        .font(theme.typography.labelLarge)
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .tint(theme.palette.primary)
                .foregroundStyle(theme.palette.onPrimary)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .disabled(socialFeatures.isBusy || isFull)
            }
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(theme.palette.surfaceVariant)
        )
    }

    private func leaveButton(group: FamilyGroup) -> some View {
        Button(role: .destructive) {
            Task {
                await socialFeatures.leaveFamilyGroup(
                    groupId: group.id,
                    session: auth.session
                )
            }
        } label: {
            Label("그룹 나가기", systemImage: "rectangle.portrait.and.arrow.right")
                .font(theme.typography.labelLarge)
                .frame(maxWidth: .infinity, minHeight: 48)
        }
        .buttonStyle(.bordered)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .disabled(socialFeatures.isBusy)
        .padding(.top, 8)
    }
}

/// 한 멤버 행. Android `MemberRow:264-332` 와 동등.
private struct FamilyAlarmPermissionCard: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let allowFamilyAlarms: Bool
    let quietWindows: [FamilyAlarmQuietWindow]
    let isBusy: Bool
    let onToggle: (Bool) -> Void
    let onEditQuietTime: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("상대 알람 허용")
                        .font(theme.typography.bodyMedium.weight(.medium))
                        .foregroundStyle(theme.palette.onSurface)
                    Text("함께 쓰는 사람이 내 알람을 맞출 수 있게 해요.")
                        .font(theme.typography.bodySmall)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                }
                Spacer()
                Toggle(
                    "",
                    isOn: Binding(
                        get: { allowFamilyAlarms },
                        set: { onToggle($0) }
                    )
                )
                .labelsHidden()
                .disabled(isBusy)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)

            if allowFamilyAlarms {
                Divider()
                    .overlay(theme.palette.outlineVariant)
                Button(action: onEditQuietTime) {
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("알람 받지 않을 시간")
                                .font(theme.typography.bodyMedium.weight(.medium))
                                .foregroundStyle(theme.palette.onSurface)
                            Text(HelperFormatters.quietScheduleLabel(quietWindows))
                                .font(theme.typography.bodySmall)
                                .foregroundStyle(theme.palette.onSurfaceVariant)
                                .lineLimit(1)
                        }
                        Spacer()
                        Text("수정")
                            .font(theme.typography.labelLarge)
                            .foregroundStyle(theme.palette.primary)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(isBusy)
            }
        }
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(theme.palette.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(theme.palette.outlineVariant, lineWidth: 1)
        )
    }
}

private struct MemberRow: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let member: FamilyGroupMember
    let isMe: Bool
    let showRemove: Bool
    let removeEnabled: Bool
    let onRemove: () -> Void

    var body: some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 2) {
                Text(member.name ?? member.email ?? "멤버")
                    .font(theme.typography.bodyMedium.weight(.medium))
                    .foregroundStyle(theme.palette.onSurface)
                if let email = member.email, member.name != nil {
                    Text(email)
                        .font(theme.typography.bodySmall)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                }
                if let allow = member.allowFamilyAlarms {
                    Text(allow ? "상대방 알람 허용" : "상대방 알람 꺼짐")
                        .font(theme.typography.bodySmall)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                }
            }
            Spacer()

            if let label = chipLabel {
                Text(label)
                    .font(theme.typography.labelSmall)
                    .padding(.vertical, 4)
                    .padding(.horizontal, 10)
                    .background(
                        Capsule().fill(theme.palette.secondaryContainer)
                    )
                    .foregroundStyle(theme.palette.onSecondaryContainer)
            }

            if showRemove {
                Button(action: onRemove) {
                    Image(systemName: "person.fill.xmark")
                        .foregroundStyle(theme.palette.error)
                        .padding(8)
                }
                .buttonStyle(.plain)
                .disabled(!removeEnabled)
                .accessibilityLabel("내보내기")
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(isMe
                      ? theme.palette.secondaryContainer.opacity(0.5)
                      : theme.palette.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(theme.palette.outlineVariant, lineWidth: 1)
        )
    }

    private var chipLabel: String? {
        if member.role == "owner" { return "관리자" }
        if isMe { return "나" }
        return nil
    }
}

/// UIKit Share Sheet 를 SwiftUI 에서 띄우기 위한 래퍼.
/// Android 의 `Intent.ACTION_SEND` 와 동등.
private struct ActivityShareSheet: UIViewControllerRepresentable {
    let text: String

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [text], applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}

#if DEBUG
#Preview("MemberManagementView (light)") {
    NavigationStack {
        MemberManagementView()
    }
    .voiceAlarmPreviewEnvironment()
}

#Preview("MemberManagementView (dark)") {
    NavigationStack {
        MemberManagementView()
    }
    .preferredColorScheme(.dark)
    .voiceAlarmPreviewEnvironment()
}
#endif
