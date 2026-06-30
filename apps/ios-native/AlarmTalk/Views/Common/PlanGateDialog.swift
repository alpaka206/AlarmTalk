import SwiftUI

/// 유료 기능 게이팅 다이얼로그.
///
/// Android `apps/android-native/.../ui/components/PlanGateDialog.kt:26-78` 의
/// 가벼운 **중앙 모달**(Dialog + Surface, WakerDialogShape 28dp)을 1:1 로 맞춘다.
/// 제목 행(닫기 X) + bodyMedium 안내문 + 전체폭 확인 버튼 하나로만 구성하며,
/// Android 에 없는 큰 잠금 뱃지·"현재 플랜 → 필요" 진행 행·바텀시트 표현은 두지
/// 않는다.
///
/// 사용처
///   - Voice Studio 에서 클론 슬롯이 부족할 때
///   - Family 알람을 보내려는데 현재 플랜이 free/personal 일 때
///   - 백업/다중 알람 등 향후 유료 기능
///
/// 호출 패턴은 두 가지 모두 지원한다.
///
/// ```swift
/// // 1) PlanGateState 를 직접 item 으로 띄우기
/// @State private var planGate: PlanGateState?
/// ...
/// .planGate(item: $planGate, onConfirm: { ... open billing })
///
/// // 2) Bool 트리거 + 미리 만들어 둔 message
/// .planGate(
///     isPresented: $isPlanGatePresented,
///     state: PlanGateState(requiredPlan: .personal, currentPlan: currentPlan),
///     onConfirm: openBilling
/// )
/// ```
struct PlanGateDialog: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @Environment(\.dismiss) private var dismiss

    let state: PlanGateState
    let onConfirm: () -> Void

    var body: some View {
        ZStack {
            // 바깥 스크림 — 탭하면 닫힌다(Android Dialog 의 바깥 영역 dismiss 와 동일).
            Color.black.opacity(0.4)
                .ignoresSafeArea()
                .contentShape(Rectangle())
                .onTapGesture { dismiss() }

            VStack(alignment: .leading, spacing: 12) {
                // 제목 행 + 닫기 X (Android ModalDialogTitle: titleLarge Bold, 좌측 정렬).
                HStack(alignment: .top, spacing: 12) {
                    Text(state.title)
                        .font(theme.typography.titleLarge)
                        .fontWeight(.bold)
                        .foregroundStyle(theme.palette.onSurface)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.headline)
                            .foregroundStyle(theme.palette.onSurfaceVariant)
                            .frame(width: 32, height: 32)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text("닫기"))
                }

                Text(state.body)
                    .font(theme.typography.bodyMedium)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)

                Button(action: {
                    onConfirm()
                    dismiss()
                }) {
                    Text(state.confirmLabel)
                        .font(theme.typography.labelLarge)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, minHeight: 48)
                }
                .buttonStyle(.borderedProminent)
                .tint(theme.palette.primary)
                .foregroundStyle(theme.palette.onPrimary)
                .clipShape(RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous))
                // 안내문과 버튼 사이 간격을 Android(20dp)에 맞춘다(스택 12 + 8).
                .padding(.top, 8)
            }
            .padding(22)
            .frame(maxWidth: 380)
            // WakerDialogShape(28dp) = extraLarge.
            .background(
                RoundedRectangle(cornerRadius: theme.shapes.extraLarge, style: .continuous)
                    .fill(theme.palette.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: theme.shapes.extraLarge, style: .continuous)
                    .stroke(theme.palette.outlineVariant, lineWidth: 1)
            )
            .shadow(color: Color.black.opacity(0.18), radius: 18, y: 6)
            .padding(.horizontal, 24)
        }
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
        title: String = String(localized: "유료 기능이에요"),
        message: String? = nil,
        confirmLabel: String = String(localized: "요금제 변경하러 가기"),
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
            return String(localized: "이 기능은 무료 플랜에서도 사용할 수 있어요.")
        case .personal:
            return String(localized: "이 기능은 개인 플랜에서 사용할 수 있어요. 업그레이드해서 녹음과 공유 목소리 기능을 사용해 보세요.")
        case .couple:
            return String(localized: "이 기능은 커플 플랜에서 사용할 수 있어요. 두 사람의 알람을 함께 관리해 보세요.")
        case .family:
            return String(localized: "이 기능은 가족 플랜에서 사용할 수 있어요. 가족 구성원과 알람과 메시지를 함께 나눠보세요.")
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

    /// iOS 는 StoreKit entitlement, 백엔드 구독 응답, 세션의 마지막 plan 값이
    /// 짧은 시간 서로 다를 수 있다. 화면 게이트는 가장 높은 "최근 확인 상태"를
    /// 사용해 구매 직후 UI가 순간적으로 무료처럼 보이는 일을 줄인다.
    static func bestKnown(
        serverSubscription: BillingSubscriptionResponse?,
        storeTier: PlanTier = .free,
        userPlan: String? = nil
    ) -> PlanTier {
        var candidates = [storeTier]
        if serverSubscription == nil {
            candidates.append(PlanTier.from(userPlan))
        }
        if serverSubscription?.subscription?.status == "active" {
            candidates.append(PlanTier.from(serverSubscription?.plan?.key))
            candidates.append(PlanTier.from(serverSubscription?.plan?.planType))
        }
        return candidates.max { lhs, rhs in
            (tierOrder[lhs] ?? 0) < (tierOrder[rhs] ?? 0)
        } ?? .free
    }
}

// MARK: - View modifier

extension View {
    /// `PlanGateState` 가 nil 이 아니면 네이티브 시스템 alert 로 띄운다.
    func planGate(
        item: Binding<PlanGateState?>,
        onConfirm: @escaping () -> Void
    ) -> some View {
        self.alert(
            item.wrappedValue?.title ?? "",
            isPresented: Binding(
                get: { item.wrappedValue != nil },
                set: { if !$0 { item.wrappedValue = nil } }
            )
        ) {
            Button("닫기", role: .cancel) {
                item.wrappedValue = nil
            }
            Button(item.wrappedValue?.confirmLabel ?? String(localized: "요금제 변경하러 가기")) {
                onConfirm()
                item.wrappedValue = nil
            }
        } message: {
            Text(item.wrappedValue?.body ?? "")
        }
    }

    /// 상태가 항상 한 종류이며 표시 여부만 Bool 로 제어하고 싶을 때.
    func planGate(
        isPresented: Binding<Bool>,
        state: PlanGateState,
        onConfirm: @escaping () -> Void
    ) -> some View {
        self.alert(state.title, isPresented: isPresented) {
            Button("닫기", role: .cancel) {}
            Button(state.confirmLabel) {
                onConfirm()
            }
        } message: {
            Text(state.body)
        }
    }
}

#if DEBUG
#Preview("PlanGateDialog (light)") {
    PlanGateDialog(
        state: PlanGateState(currentPlan: .free, requiredPlan: .personal),
        onConfirm: {}
    )
    .voiceAlarmPreviewEnvironment()
}

#Preview("PlanGateDialog family (dark)") {
    PlanGateDialog(
        state: PlanGateState(currentPlan: .personal, requiredPlan: .family),
        onConfirm: {}
    )
    .preferredColorScheme(.dark)
    .voiceAlarmPreviewEnvironment()
}
#endif
