import SwiftUI

/// 알람 자체 음량 슬라이더 (0..100%).
///
/// 정직한 한계: iOS 의 OS 알람 톤은 AlarmKit 이 소유하며 *시스템 알람 음량* 으로
/// 울린다 — 알람별 음량 공개 API 가 없다. 따라서 이 슬라이더는 앱이 켜져 있을 때
/// 재생되는 in-app 음성 폴백의 *상대* 게인에만 적용되고, 실제 OS 알람 톤 크기에는
/// 영향을 주지 못한다. (Android 는 자체 ringing 을 소유해 `alarmVolumePercent` 가
/// 실제 알람음에 적용되지만, iOS 는 그 동등성을 갖지 못한다.) 0 이면 "무음"
/// 으로 표시하며 in-app 폴백 재생을 끈다.
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

            Text(caption)
                .font(theme.typography.bodySmall)
                .foregroundStyle(theme.palette.onSurfaceVariant)
                .fixedSize(horizontal: false, vertical: true)
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

    /// OS 알람 톤은 시스템 알람 음량으로 울리므로 (iOS 한계), 이 슬라이더가
    /// 실제로 제어하는 대상을 정직하게 안내한다.
    private var caption: String {
        volume <= 0
            ? "0% 에서는 앱이 켜져 있을 때 재생되는 음성 폴백이 꺼집니다. OS 알람 톤은 기기의 시스템 알람 음량으로 계속 울립니다."
            : "앱이 켜져 있을 때 재생되는 음성 폴백 크기에만 적용됩니다. OS 알람 톤은 기기의 시스템 알람 음량으로 울립니다."
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
