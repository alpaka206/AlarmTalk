import SwiftUI

/// 잠금 표식 뱃지. Android `FeatureLockBadge.kt:18-41` 와 동등.
///
/// 사용처
///   - PlanGateDialog 상단 큰 잠금
///   - 잠긴 기능 옆 작은 잠금 (예: 비활성화된 "목소리 슬롯 추가" 버튼)
///
/// `tier` 를 주면 잠금 아이콘 옆에 작은 라벨(`Personal` / `Couple` / `Family`)
/// 칩이 함께 그려진다. 라벨 없이 잠금만 보이고 싶을 땐 nil 로 호출한다.
struct FeatureLockBadge: View {
    @Environment(\.voiceAlarmTheme) private var theme
    var size: CGFloat = 22
    var iconSize: CGFloat = 12
    var tier: PlanTier? = nil
    var accessibilityLabel: String? = "이용권 필요"

    var body: some View {
        if let tier {
            HStack(spacing: 4) {
                circleLockIcon
                Text(tier.displayLabel)
                    .font(theme.typography.labelSmall)
                    .foregroundStyle(theme.palette.onPrimaryContainer)
                    .padding(.vertical, 2)
                    .padding(.horizontal, 6)
                    .background(
                        Capsule().fill(theme.palette.primaryContainer)
                    )
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(accessibilityLabel ?? "이용권 필요 (\(tier.displayLabel))")
        } else {
            circleLockIcon
                .accessibilityLabel(accessibilityLabel ?? "이용권 필요")
        }
    }

    private var circleLockIcon: some View {
        ZStack {
            Circle()
                .fill(theme.palette.primaryContainer)
            Circle()
                .stroke(theme.palette.surface, lineWidth: 1)
            Image(systemName: "lock.fill")
                .font(.system(size: iconSize, weight: .semibold))
                .foregroundStyle(theme.palette.onPrimaryContainer)
        }
        .frame(width: size, height: size)
    }
}

#if DEBUG
#Preview("FeatureLockBadge (light)") {
    HStack(spacing: 12) {
        FeatureLockBadge()
        FeatureLockBadge(size: 36, iconSize: 18, tier: .personal)
        FeatureLockBadge(size: 36, iconSize: 18, tier: .couple)
        FeatureLockBadge(size: 36, iconSize: 18, tier: .family)
    }
    .padding()
    .voiceAlarmPreviewEnvironment()
}

#Preview("FeatureLockBadge (dark)") {
    HStack(spacing: 12) {
        FeatureLockBadge()
        FeatureLockBadge(size: 36, iconSize: 18, tier: .family)
    }
    .padding()
    .preferredColorScheme(.dark)
    .voiceAlarmPreviewEnvironment()
}
#endif
