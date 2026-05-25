import SwiftUI

/// 유료 기능 게이팅 다이얼로그(시트).
///
/// Android `apps/android-native/.../ui/components/PlanGateDialog.kt:26-101` 의
/// 디자인과 카피를 1:1 포팅했다. iOS 에서는 `.sheet` 또는 `.alert` 대신 본
/// 커스텀 시트를 사용해 잠금 아이콘 + 카피 + 두 버튼 레이아웃을 유지한다.
///
/// 사용처
///   - Voice Studio 에서 클론 슬롯이 부족할 때
///   - Family 알람을 보내려는데 현재 플랜이 free/personal 일 때
///   - 백업/다중 알람 등 향후 유료 기능
///
/// 호출 패턴은 두 가지 모두 지원한다.
///
/// ```swift
/// // 1) PlanGateState 를 직접 sheet item 으로 띄우기
/// @State private var planGate: PlanGateState?
/// ...
/// .planGate(item: $planGate, onConfirm: { ... open billing })
///
/// // 2) Bool 트리거 + 미리 만들어 둔 message
/// .planGate(
///     isPresented: $isPlanGatePresented,
///     state: PlanGateState(requiredPlan: .plus, currentPlan: currentPlan),
///     onConfirm: openBilling
/// )
/// ```
struct PlanGateDialog: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @Environment(\.dismiss) private var dismiss

    let state: PlanGateState
    let onConfirm: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            HStack {
                Spacer()
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.headline)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                        .frame(width: 32, height: 32)
                        .background(theme.palette.surfaceVariant, in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("닫기"))
            }
            .padding(.horizontal, 22)
            .padding(.top, 16)

            FeatureLockBadge(size: 58, iconSize: 27)
                .padding(.top, 2)

            VStack(spacing: 7) {
                Text(state.title)
                    .font(theme.typography.titleLarge)
                    .foregroundStyle(theme.palette.onSurface)
                    .multilineTextAlignment(.center)
                Text(state.body)
                    .font(theme.typography.bodyMedium)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
                    .multilineTextAlignment(.center)
            }
            .padding(.horizontal, 22)

            HStack(spacing: 8) {
                Image(systemName: "lock.shield.fill")
                    .foregroundStyle(theme.palette.primary)
                Text("현재 플랜: \(state.currentPlan.displayLabel)")
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
                Spacer()
                Image(systemName: "arrow.right")
                    .foregroundStyle(theme.palette.onSurfaceVariant)
                Text("필요: \(state.requiredPlan.displayLabel)")
                    .font(theme.typography.bodySmall.weight(.semibold))
                    .foregroundStyle(theme.palette.onSurface)
            }
            .padding(.horizontal, 22)
            .padding(.vertical, 10)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(theme.palette.surfaceVariant)
            )
            .padding(.horizontal, 22)

            VStack(spacing: 8) {
                Button(action: {
                    onConfirm()
                    dismiss()
                }) {
                    Text(state.confirmLabel)
                        .font(theme.typography.labelLarge)
                        .frame(maxWidth: .infinity, minHeight: 48)
                }
                .buttonStyle(.borderedProminent)
                .tint(theme.palette.primary)
                .foregroundStyle(theme.palette.onPrimary)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))

            }
            .padding(.horizontal, 22)
            .padding(.bottom, 22)

            Spacer(minLength: 0)
        }
        .padding(.top, 6)
        .background(theme.palette.surface)
        .presentationDetents([.fraction(0.45), .medium])
        .presentationDragIndicator(.visible)
    }
}

/// PlanGate 상태값. View modifier 들이 sheet item 으로 사용.
struct PlanGateState: Identifiable, Equatable {
    let id = UUID()
    let title: String
    let body: String
    let confirmLabel: String
    let currentPlan: PlanTier
    let requiredPlan: PlanTier

    init(
        title: String = "유료 기능이에요",
        message: String? = nil,
        confirmLabel: String = "요금제 변경하러 가기",
        currentPlan: PlanTier,
        requiredPlan: PlanTier
    ) {
        self.title = title
        self.body = message ?? PlanGateState.defaultMessage(requiredPlan: requiredPlan)
        self.confirmLabel = confirmLabel
        self.currentPlan = currentPlan
        self.requiredPlan = requiredPlan
    }

    static func defaultMessage(requiredPlan: PlanTier) -> String {
        switch requiredPlan {
        case .free:
            return "이 기능은 무료 플랜에서도 사용할 수 있어요."
        case .personal:
            return "이 기능은 개인 플랜에서 사용할 수 있어요. 업그레이드해서 더 많은 보이스 슬롯을 열어보세요."
        case .couple:
            return "이 기능은 커플 플랜에서 사용할 수 있어요. 두 사람의 알람을 함께 관리해 보세요."
        case .family:
            return "이 기능은 가족 플랜에서 사용할 수 있어요. 가족 구성원과 알람과 메시지를 함께 나눠보세요."
        }
    }
}

/// 백엔드 plan key 와 1:1. Android `BillingApi` 의 plan key 표기를 따른다.
///
/// 백엔드 표준 키: `free` / `personal` / `couple` / `family`. iOS BillingPanel
/// 가 사용하던 임시 `plus_monthly` / `family_monthly` 는 PlanTier 의 `apiKey`
/// 매핑으로 흡수한다.
enum PlanTier: String, CaseIterable, Codable, Equatable {
    case free
    case personal
    case couple
    case family

    /// 화면에 노출하는 한국어 라벨.
    var displayLabel: String {
        switch self {
        case .free: return "무료"
        case .personal: return "개인"
        case .couple: return "커플"
        case .family: return "가족"
        }
    }

    /// 백엔드 plan key (소문자).
    var apiKey: String { rawValue }

    /// 현재 플랜이 `required` 이상의 권한을 가지는지. 가족 > 커플 > 개인 > 무료.
    func meetsOrExceeds(_ required: PlanTier) -> Bool {
        Self.tierOrder[self] ?? 0 >= Self.tierOrder[required] ?? 0
    }

    private static let tierOrder: [PlanTier: Int] = [
        .free: 0,
        .personal: 1,
        .couple: 2,
        .family: 3,
    ]

    /// `AuthUser.plan` 또는 `BillingPlan.key` 등에서 받은 문자열을 안전하게 매핑.
    /// 알 수 없는 값은 `.free` 로 폴백.
    static func from(_ raw: String?) -> PlanTier {
        guard let raw = raw?.lowercased() else { return .free }
        if let direct = PlanTier(rawValue: raw) { return direct }
        // 과거 코드의 키들을 흡수.
        switch raw {
        case "plus", "plus_monthly", "plus_yearly":
            return .personal
        case "couple_monthly", "couple_yearly":
            return .couple
        case "family_monthly", "family_yearly":
            return .family
        default:
            return .free
        }
    }
}

// MARK: - View modifier

extension View {
    /// `PlanGateState` 가 nil 이 아니면 시트로 띄운다.
    func planGate(
        item: Binding<PlanGateState?>,
        onConfirm: @escaping () -> Void
    ) -> some View {
        self.sheet(item: item) { state in
            PlanGateDialog(state: state, onConfirm: onConfirm)
        }
    }

    /// 상태가 항상 한 종류이며 표시 여부만 Bool 로 제어하고 싶을 때.
    func planGate(
        isPresented: Binding<Bool>,
        state: PlanGateState,
        onConfirm: @escaping () -> Void
    ) -> some View {
        self.sheet(isPresented: isPresented) {
            PlanGateDialog(state: state, onConfirm: onConfirm)
        }
    }
}

#if DEBUG
#Preview("PlanGateDialog (light)") {
    Color.clear.sheet(isPresented: .constant(true)) {
        PlanGateDialog(
            state: PlanGateState(currentPlan: .free, requiredPlan: .personal),
            onConfirm: {}
        )
    }
    .voiceAlarmPreviewEnvironment()
}

#Preview("PlanGateDialog family (dark)") {
    Color.clear.sheet(isPresented: .constant(true)) {
        PlanGateDialog(
            state: PlanGateState(currentPlan: .personal, requiredPlan: .family),
            onConfirm: {}
        )
    }
    .preferredColorScheme(.dark)
    .voiceAlarmPreviewEnvironment()
}
#endif
