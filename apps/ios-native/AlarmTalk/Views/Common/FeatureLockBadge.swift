import SwiftUI

/// 잠금 표식 뱃지. Android `FeatureLockBadge.kt:19-42` 와 1:1.
///
/// primaryContainer 원 + 1px surface 보더 + onPrimaryContainer **아웃라인** 자물쇠
/// 하나로만 구성한다. 티어 라벨 칩(개인/커플/가족)은 두지 않는다 — Android 도 라벨
/// 없이 자물쇠만 그린다.
///
/// 사용처
///   - 잠긴 기능 옆 작은 잠금 (예: 비활성화된 "목소리 슬롯 추가" 버튼)
struct FeatureLockBadge: View {
    @Environment(\.voiceAlarmTheme) private var theme
    var size: CGFloat = 22
    var iconSize: CGFloat = 12
    var accessibilityLabel: String? = "이용권 필요"

    var body: some View {
        ZStack {
            Circle()
                .fill(theme.palette.primaryContainer)
            Circle()
                .stroke(theme.palette.surface, lineWidth: 1)
            // Android `Icons.Outlined.Lock` 와 동일한 아웃라인 자물쇠(채움 아님).
            Image(systemName: "lock")
                .font(.system(size: iconSize, weight: .semibold))
                .foregroundStyle(theme.palette.onPrimaryContainer)
        }
        .frame(width: size, height: size)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityLabel ?? "이용권 필요")
    }
}

#if DEBUG
#Preview("FeatureLockBadge (light)") {
    HStack(spacing: 12) {
        FeatureLockBadge()
        FeatureLockBadge(size: 36, iconSize: 18)
        FeatureLockBadge(size: 58, iconSize: 27)
    }
    .padding()
    .voiceAlarmPreviewEnvironment()
}

#Preview("FeatureLockBadge (dark)") {
    HStack(spacing: 12) {
        FeatureLockBadge()
        FeatureLockBadge(size: 36, iconSize: 18)
    }
    .padding()
    .preferredColorScheme(.dark)
    .voiceAlarmPreviewEnvironment()
}
#endif
