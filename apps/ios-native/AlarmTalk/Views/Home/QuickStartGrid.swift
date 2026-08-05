import SwiftUI

/// 홈 화면 "바로 가기" 영역. 음성 탭 진입, 새 알람 만들기, 상대 알람 시트 진입.
///
/// Android `ui/home/HomeCards.kt:191-322` 의 `QuickStartGrid`/`HomeActionCard` 미러.
/// 부모(HomeView)가 라우팅 의무를 가져가므로 각 카드는 단순 콜백을 호출한다.
/// 아이콘 원형 배경/전경은 M3 컨테이너 토큰을 쓴다(목소리·상대=secondaryContainer,
/// 새 알람=primaryContainer; 잠금 시 surfaceVariant).
struct QuickStartGrid: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let onOpenVoices: () -> Void
    let onOpenEditor: () -> Void
    let canCreateFamilyAlarm: Bool
    let onOpenFamilyAlarm: () -> Void
    var voiceLocked: Bool = false
    var alarmLocked: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("바로 가기")
                .font(.headline)
                .foregroundStyle(theme.palette.onBackground)
            HStack(spacing: 12) {
                QuickActionCard(
                    title: "목소리",
                    icon: "mic",
                    background: theme.palette.secondaryContainer,
                    foreground: theme.palette.onSecondaryContainer,
                    locked: voiceLocked,
                    action: onOpenVoices
                )
                QuickActionCard(
                    title: "새 알람",
                    icon: "alarm",
                    background: theme.palette.primaryContainer,
                    foreground: theme.palette.onPrimaryContainer,
                    locked: alarmLocked,
                    action: onOpenEditor
                )
            }
            if canCreateFamilyAlarm {
                QuickActionCard(
                    title: "상대 알람 맞춰주기",
                    icon: "person.2",
                    background: theme.palette.secondaryContainer,
                    foreground: theme.palette.onSecondaryContainer,
                    locked: alarmLocked,
                    action: onOpenFamilyAlarm
                )
            }
        }
    }
}

/// 홈 바로가기에서 쓰는 카드 한 장. 아이콘 + 라벨.
struct QuickActionCard: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let title: String
    let icon: String
    let background: Color
    let foreground: Color
    var locked: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                ZStack {
                    Circle()
                        .fill(locked ? theme.palette.surfaceVariant : background)
                    Image(systemName: icon)
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(locked ? theme.palette.onSurfaceVariant : foreground)
                    if locked {
                        FeatureLockBadge(size: 20, iconSize: 11)
                            .offset(x: 16, y: -16)
                    }
                }
                .frame(width: 42, height: 42)

                Text(title)
                    .font(.headline)
                    .foregroundStyle(locked ? theme.palette.onSurfaceVariant : theme.palette.onSurface)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Spacer()
            }
            .padding(14)
            .frame(maxWidth: .infinity)
            .background(theme.palette.surface)
            .clipShape(RoundedRectangle(cornerRadius: theme.shapes.medium, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: theme.shapes.medium, style: .continuous)
                    .stroke(theme.palette.outlineVariant, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }
}

#if DEBUG
#Preview("QuickStart (light)") {
    QuickStartGrid(
        onOpenVoices: {},
        onOpenEditor: {},
        canCreateFamilyAlarm: true,
        onOpenFamilyAlarm: {},
        voiceLocked: true,
        alarmLocked: false
    )
        .padding()
        .voiceAlarmPreviewEnvironment()
}

#Preview("QuickStart (dark)") {
    QuickStartGrid(
        onOpenVoices: {},
        onOpenEditor: {},
        canCreateFamilyAlarm: true,
        onOpenFamilyAlarm: {},
        voiceLocked: false,
        alarmLocked: true
    )
        .padding()
        .preferredColorScheme(.dark)
        .voiceAlarmPreviewEnvironment()
}
#endif
