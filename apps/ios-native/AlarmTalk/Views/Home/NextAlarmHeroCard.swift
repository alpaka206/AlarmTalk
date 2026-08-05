import Foundation
import SwiftUI

/// 홈 상단의 큰 "다음 알람" 히어로 카드.
///
/// Android `ui/home/HomeCards.kt:50-141` 의 `NextAlarmHeroCard` 미러.
/// - `nextAlarm == nil` 이면 알람 만들기 안내 표면을 보여준다.
/// - 카드 자체가 버튼 — 탭하면 `onTap()` 으로 부모(HomeView)에 알람 편집 진입을 위임한다.
/// - 표면: WakerHeroShape(24) 라운드 + outlineVariant 1px 테두리 + 20 패딩.
struct NextAlarmHeroCard: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let nextAlarm: LocalAlarmRecord?
    let onTap: () -> Void

    private var hasAlarm: Bool { nextAlarm != nil }

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(hasAlarm ? "다음 알람" : "아직 알람이 없어요.")
                        .font(theme.typography.labelLarge)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                    Text(hasAlarm ? (nextAlarm?.timeString ?? "") : "알람 예약")
                        .font(hasAlarm ? theme.typography.displayLarge : theme.typography.displaySmall)
                        .foregroundStyle(theme.palette.onSurface)
                        .lineLimit(1)
                        .minimumScaleFactor(0.72)
                }

                waveform(active: hasAlarm)

                HStack(alignment: .center) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(heroLabel)
                            .font(.pretendard(.semibold, size: 16))
                            .foregroundStyle(theme.palette.onSurface)
                            .lineLimit(1)
                            .truncationMode(.tail)
                        Text(hasAlarm ? "수정하기" : "바로 시작해봐요.")
                            .font(theme.typography.bodyMedium)
                            .foregroundStyle(theme.palette.onSurfaceVariant)
                            .lineLimit(1)
                            .truncationMode(.tail)
                    }
                    Spacer()
                    Image(systemName: "arrow.right")
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(theme.palette.primary)
                        .padding(.leading, 12)
                }
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.palette.surface)
            .clipShape(RoundedRectangle(cornerRadius: theme.shapes.large, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: theme.shapes.large, style: .continuous)
                    .stroke(theme.palette.outlineVariant, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    /// 다음 알람 라벨 — 비어 있으면 음성 안내 문구로 대체(Android takeIf isNotBlank 미러).
    private var heroLabel: String {
        if let label = nextAlarm?.label, !label.isEmpty { return label }
        return "좋아하는 목소리로 알람 예약"
    }

    /// 무한 위상 애니메이션으로 막대 높이·투명도를 변조하는 40-bar 파형.
    /// Android `HomeVoiceWaveform` 미러: 전체 폭에 SpaceBetween 으로 분배.
    private func waveform(active: Bool) -> some View {
        let levels: [Double] = [
            0.18, 0.24, 0.16, 0.34, 0.28, 0.52, 0.38, 0.70,
            0.42, 0.60, 0.32, 0.56, 0.24, 0.66, 0.46, 0.78,
            0.40, 0.62, 0.34, 0.58, 0.28, 0.54, 0.36, 0.64,
            0.44, 0.72, 0.30, 0.48, 0.22, 0.42, 0.18, 0.36,
            0.26, 0.50, 0.20, 0.40, 0.16, 0.32, 0.14, 0.28,
        ]
        return TimelineView(.animation) { timeline in
            let t = timeline.date.timeIntervalSinceReferenceDate
            // 1.7s 주기 0 → 2π 위상 (Android tween 1700ms LinearEasing Restart 미러).
            let phase = (t.truncatingRemainder(dividingBy: 1.7) / 1.7) * 2 * Double.pi
            HStack(alignment: .center, spacing: 0) {
                ForEach(Array(levels.enumerated()), id: \.offset) { index, level in
                    let wave = ((sin(phase + Double(index) * 0.56) + 1) / 2).clampedUnit
                    let animatedLevel = (level * (0.72 + 0.28 * wave)).clamped(min: 0.12, max: 0.88)
                    let alpha = active ? (0.58 + 0.38 * wave) : (0.24 + 0.28 * wave)
                    Capsule()
                        .fill(theme.palette.primary.opacity(alpha))
                        .frame(width: 2, height: CGFloat(8 + animatedLevel * 34))
                    if index < levels.count - 1 {
                        Spacer(minLength: 0)
                    }
                }
            }
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .center)
        }
        .frame(height: 44)
    }
}

private extension Double {
    var clampedUnit: Double { clamped(min: 0, max: 1) }
    func clamped(min lower: Double, max upper: Double) -> Double {
        Swift.min(Swift.max(self, lower), upper)
    }
}

#if DEBUG
#Preview("Empty (light)") {
    NextAlarmHeroCard(nextAlarm: nil, onTap: {})
        .padding()
}

#Preview("Empty (dark)") {
    NextAlarmHeroCard(nextAlarm: nil, onTap: {})
        .padding()
        .preferredColorScheme(.dark)
}
#endif
