import SwiftUI

/// 알람 자체 음량 슬라이더 (0..100%).
///
/// Android `AlarmSettingsCard.kt` 의 `alarmVolumePercent` 슬라이더 대응. 시스템
/// 음량과 별개로 알람음원이 재생되는 *상대* 게인. 0 인 경우 "무음" 으로 표시.
struct AlarmVolumeSlider: View {
    @Binding var volume: Int

    @Environment(\.voiceAlarmTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: theme.spacing.xs) {
            HStack {
                Image(systemName: speakerIconName)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(theme.palette.onSurfaceVariant)
                Text(label)
                    .font(theme.typography.titleSmall)
                    .foregroundStyle(theme.palette.onSurface)
                Spacer()
                Text(valueLabel)
                    .font(theme.typography.labelLarge)
                    .foregroundStyle(theme.palette.primary)
                    .monospacedDigit()
            }

            Slider(
                value: sliderBinding,
                in: 0...100,
                step: 1
            )
            .tint(theme.palette.primary)
            .accessibilityLabel(Text("알람 음량"))
            .accessibilityValue(Text(valueLabel))
        }
    }

    private var sliderBinding: Binding<Double> {
        Binding(
            get: { Double(max(0, min(100, volume))) },
            set: { newValue in
                let clamped = max(0, min(100, Int(newValue.rounded())))
                if clamped != volume {
                    volume = clamped
                }
            }
        )
    }

    private var speakerIconName: String {
        switch volume {
        case 0: return "speaker.slash.fill"
        case ..<34: return "speaker.wave.1.fill"
        case ..<67: return "speaker.wave.2.fill"
        default: return "speaker.wave.3.fill"
        }
    }

    private var label: String { "알람 음량" }

    private var valueLabel: String {
        volume <= 0 ? "무음" : "\(volume)%"
    }
}

// MARK: - Preview

#if DEBUG
private struct AlarmVolumePreviewHost: View {
    @State private var volume = 80
    var body: some View {
        AlarmVolumeSlider(volume: $volume)
            .padding(20)
    }
}

#Preview("AlarmVolumeSlider — light") {
    AlarmTalkThemeProvider { AlarmVolumePreviewHost() }
}

#Preview("AlarmVolumeSlider — dark") {
    AlarmTalkThemeProvider { AlarmVolumePreviewHost() }
        .preferredColorScheme(.dark)
}
#endif
