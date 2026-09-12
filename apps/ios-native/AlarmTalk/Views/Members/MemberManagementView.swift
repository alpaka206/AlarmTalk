import SwiftUI
import UIKit

/// 가족/커플 그룹 멤버 관리 화면.
///
/// Android `apps/android-native/.../ui/members/MemberManagementScreen.kt:48-332` 의
/// 모든 동작을 1:1 포팅했다.
///
/// 기능 요약
///   - 공유 이용권 요약: 이용권 종류 / 현재 인원 / 최대 인원
///   - 소유자 전용 공유 코드 카드: 코드 표시 + 클립보드 복사 + Share Sheet,
///     코드가 없을 땐 발급 버튼 노출. 정원 가득 차면 발급/공유 비활성.
///   - 구성원 리스트: 소유자(관리자) 표시, "나" 표시, allowFamilyAlarms 상태,
///     소유자가 다른 멤버를 내보낼 수 있는 액션 버튼.
///   - 강퇴 확인 alert: 안전한 destructive 액션.
struct MemberManagementView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var socialFeatures: SocialFeatureViewModel
    @Environment(\.voiceAlarmTheme) private var theme

    @State private var pendingRemoveMember: FamilyGroupMember?
    @State private var isSharePresented = false
    @State private var shareText: String = ""
    @State private var showFamilyAlarmDialog = false
    @State private var showRegenerateConfirm = false

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
                if group == nil {
                    EmptyStatePlaceholder(
                        title: "현재 함께 쓰는 이용권이 없어요.",
                        subtitle: "가족·커플 이용권을 등록하면 여기에서 함께 쓰는 사람을 관리할 수 있어요.",
                        icon: "person.2"
                    )
                    .padding(.vertical, 12)
                } else {
                    capacityRow

                    if let user = auth.session?.user {
                        FamilyAlarmPermissionCard(
                            title: activePlanKey == "couple"
                                ? "커플이 내 알람 맞추기 허용"
                                : "가족이 내 알람 맞추기 허용",
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

                    // 정원은 **구성원 옆**에 둔다 — 공유 코드 옆에 두면 '코드 사용량' 으로
                    // 읽힌다(분모도 다르다: 코드는 소유자를 뺀 max_members - 1).
                    HStack {
                        sectionTitle("구성원")
                        Spacer()
                        if let group {
                            Text("\(sortedMembers.count)/\(group.maxMembers)명")
                                .font(theme.typography.bodySmall)
                                .foregroundStyle(theme.palette.onSurfaceVariant)
                                .monospacedDigit()
                        }
                    }
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
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
        .homeGradientBackground()
        .navigationTitle("공유 이용권")
        .navigationBarTitleDisplayMode(.inline)
        .alert(
            "구성원 내보내기",
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
        } message: { _ in
            Text("이 구성원을 내보낼까요? 다시 초대하려면 새 초대 코드가 필요해요.")
        }
        .alert(
            "공유 코드 재발급",
            isPresented: $showRegenerateConfirm
        ) {
            Button("코드 재발급", role: .destructive) {
                showRegenerateConfirm = false
                Task {
                    await socialFeatures.regenerateFamilyShareCode(session: auth.session)
                }
            }
            Button("취소", role: .cancel) {
                showRegenerateConfirm = false
            }
        } message: {
            Text("재발급하면 지금 코드는 더 이상 쓸 수 없어요. 이미 코드를 보낸 사람에게는 새 코드를 다시 보내야 해요.")
        }
        .sheet(isPresented: $isSharePresented) {
            BillingActivityShareSheet(text: shareText)
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
        // ⚠ **토큰을 id 로 쓰지 말 것 — 스스로를 취소한다.**
        // `GET /auth/me` 는 부를 때마다 **새 JWT** 를 발급하고
        // `refreshUser()` 가 그걸 세션에 갈아 끼운다. 전경 복귀마다 그게
        // 돌므로, 토큰을 id 로 두면 그 순간 이 task 가 접히고 진행 중이던
        // URLSession 요청이 `NSURLErrorCancelled` 로 끊긴다. 그 OS 문구의
        // 한국어가 "취소됨" 이라, 사용자는 취소한 적 없는 "취소됨" 을 본다
        // (2026-08-10 사용자 보고 → 원인 확인).
        // 다시 돌아야 하는 건 **계정이 바뀔 때**뿐이므로 user.id 로 건다.
        .task(id: auth.session?.user.id) {
            await socialFeatures.refreshAll(session: auth.session)
        }
    }

    // MARK: - Sections

    /// ⚠ **인원수는 여기 두지 않는다**(2026-08-31 리뷰). 구성원 섹션 옆으로 옮겼는데
    /// 이 행에도 남겨 두면 같은 숫자가 한 화면에 두 번 나온다. 여기는 **어떤 이용권인지**만
    /// 말한다(안드로이드에는 이 행이 없다 — 인원은 구성원 옆 한 곳뿐이다).
    private var capacityRow: some View {
        Text("\(planLabel) 이용권")
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
                     : "공유 코드가 아직 없어요. \(planLabel) 구성원을 초대할 초대 코드를 만들어 주세요.")
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
                .clipShape(RoundedRectangle(cornerRadius: theme.shapes.small, style: .continuous))
            }
        }
    }

    private func shareCodeCard(voucher: VoucherItem) -> some View {
        // ⚠ **정원은 '코드가 몇 번 쓰였는가' 가 아니라 '지금 몇 명인가' 다**(2026-08-31).
        // 서버가 교환을 막는 기준도 그것이다(`voucher-redemption.ts` 의 GROUP_FULL 은
        // member_count vs max_members). 코드 사용 횟수를 같이 보면 **재발급 한 번에 0 으로
        // 리셋**되어, 정원이 찼는데도 공유 버튼이 살아난다(서버가 거절해 눌러 봐야 안다).
        // ⚠ **정원과 '코드 소진' 은 다른 상태다**(2026-08-31 리뷰). 정원이 찼다가 구성원을
        // 내보내면 자리는 나지만 그 코드의 교환 기록은 그대로라 서버가 `CODE_ALREADY_USED`
        // 로 계속 막는다. 정원만 보면 **먹지 않을 코드로 공유 버튼이 살아난다.**
        // 소진된 코드는 공유를 막고 재발급으로 안내한다(그 버튼은 항상 열려 있다).
        let codeExhausted = (voucher.maxUses ?? 1) > 0
            && (voucher.useCount ?? 0) >= (voucher.maxUses ?? 1)
        let isFull = isCapacityFull || codeExhausted

        return VStack(alignment: .leading, spacing: 8) {
            Text(voucher.code)
                .font(theme.typography.titleMedium.weight(.semibold))
                .foregroundStyle(theme.palette.onSurface)
                .textSelection(.enabled)

            if isFull {
                Text(isCapacityFull
                     ? "정원이 가득 차서 공유할 수 없어요"
                     : "이 코드는 다 썼어요. 재발급하면 다시 공유할 수 있어요.")
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
            }

            HStack(spacing: 8) {
                // ⚠ **복사도 공유와 같은 게이트다**(2026-08-31 리뷰). 공유 시트만 막으면
                // 소유자가 **못 쓰는 코드를 복사해 보낼 수 있고**, 받는 쪽이 등록에서
                // `CODE_ALREADY_USED` 로 실패한다 — 막는 뜻이 사라진다.
                // 재발급은 계속 열어 둔다(그게 이 상태의 탈출구다).
                Button {
                    UIPasteboard.general.string = voucher.code
                } label: {
                    Label("코드 복사", systemImage: "doc.on.doc")
                        .font(theme.typography.labelLarge)
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.bordered)
                .disabled(socialFeatures.isBusy || isFull)
                .clipShape(RoundedRectangle(cornerRadius: theme.shapes.small, style: .continuous))

                Button {
                    Task {
                        await socialFeatures.refreshAll(session: auth.session, force: true)
                        guard let latestVoucher = shareVoucher else {
                            socialFeatures.statusMessage = "공유 코드를 다시 불러오지 못했어요."
                            return
                        }
                        // 새로고침 뒤 값으로 다시 판정한다 — 정원과 코드 소진 둘 다.
                        let latestExhausted = (latestVoucher.maxUses ?? 1) > 0
                            && (latestVoucher.useCount ?? 0) >= (latestVoucher.maxUses ?? 1)
                        guard !isCapacityFull else {
                            socialFeatures.statusMessage = "정원이 가득 차서 공유할 수 없어요."
                            return
                        }
                        guard !latestExhausted else {
                            socialFeatures.statusMessage = "이 코드는 다 썼어요. 재발급하면 다시 공유할 수 있어요."
                            return
                        }
                        // 클립보드는 **코드만** — 받은 사람이 붙여넣기로 바로 등록한다.
                        // 안내는 공유 본문에만 싣는다(안드로이드 `ShareCode.kt` 와 같다).
                        UIPasteboard.general.string = latestVoucher.code
                        shareText = CodeShareText.invite(code: latestVoucher.code)
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
                .clipShape(RoundedRectangle(cornerRadius: theme.shapes.small, style: .continuous))
                .disabled(socialFeatures.isBusy || isFull)
            }

            Button {
                showRegenerateConfirm = true
            } label: {
                Text("코드 재발급")
                    .font(theme.typography.labelLarge)
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.bordered)
            .clipShape(RoundedRectangle(cornerRadius: theme.shapes.small, style: .continuous))
            .disabled(socialFeatures.isBusy)

            Text("코드가 외부에 노출됐다면 재발급해서 기존 코드를 막을 수 있어요.")
                .font(theme.typography.bodySmall)
                .foregroundStyle(theme.palette.onSurfaceVariant)
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: theme.shapes.small, style: .continuous)
                .fill(theme.palette.surfaceVariant)
        )
    }

}

/// 함께 쓰는 사람이 **내 알람을 맞추게 할지** 정하는 카드.
/// 안드로이드 `ui/members/MemberManagementScreen.kt` 의 `FamilyAlarmPermissionCard`.
///
/// ⚠ **제목은 플랜에 따라 갈린다.** 예전 iOS 는 "상대 알람 허용" 한 줄로 고정이었는데,
/// 그 말은 *내가 알람을 받는 걸 허용한다* 로도 읽힌다 — 방향이 정반대인데 화면에서
/// 구분할 방법이 없었다. 안드로이드처럼 **누가 · 무엇을** 다 적어 모호함을 없앤다
/// (`social_allow_partner_alarm`/`_couple`). 제목이 다 말하므로 설명 줄은 두지 않는다.
private struct FamilyAlarmPermissionCard: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let title: LocalizedStringKey
    let allowFamilyAlarms: Bool
    let quietWindows: [FamilyAlarmQuietWindow]
    let isBusy: Bool
    let onToggle: (Bool) -> Void
    let onEditQuietTime: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(theme.typography.bodyMedium.weight(.medium))
                        .foregroundStyle(theme.palette.onSurface)
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
                .alarmTalkSwitch()
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
            RoundedRectangle(cornerRadius: AlarmTalkTheme.Shape.card, style: .continuous)
                .fill(theme.palette.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: AlarmTalkTheme.Shape.card, style: .continuous)
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
                        .frame(width: 44, height: 44)
                        // ⚠ 없으면 글리프만 눌린다 — `frame`/`padding` 이 넓힌 자리는 투명해 히트테스트를 건너뛴다.
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(!removeEnabled)
                .accessibilityLabel("내보내기")
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(
            RoundedRectangle(cornerRadius: theme.shapes.small, style: .continuous)
                .fill(isMe
                      ? theme.palette.secondaryContainer.opacity(0.5)
                      : theme.palette.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: theme.shapes.small, style: .continuous)
                .stroke(theme.palette.outlineVariant, lineWidth: 1)
        )
    }

    private var chipLabel: String? {
        if member.role == "owner" { return "관리자" }
        if isMe { return "나" }
        return nil
    }
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
