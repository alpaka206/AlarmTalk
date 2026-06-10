import SwiftUI

/// 홈 상단의 큰 "다음 알람" 히어로 카드.
///
/// ContentView 의 `nextAlarmHeroCard` 를 그대로 옮긴 것.
/// - `nextAlarm == nil` 이면 알람 만들기 안내 표면을 보여준다.
/// - 카드 자체가 버튼 — 탭하면 `onTap()` 으로 부모(HomeView)에 알람 편집 진입을 위임한다.
struct NextAlarmHeroCard: View {
    let nextAlarm: LocalAlarmRecord?
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(nextAlarm == nil ? "아직 알람이 없어요." : "다음 알람")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(AlarmTalkTheme.textSecondary)
                    Text(nextAlarm?.timeString ?? "알람 예약")
                        .font(nextAlarm == nil ? .largeTitle.weight(.bold) : .system(size: 56, weight: .bold, design: .rounded))
                        .foregroundStyle(AlarmTalkTheme.text)
                        .lineLimit(1)
                        .minimumScaleFactor(0.72)
                }

                waveform(active: nextAlarm != nil)

                HStack(alignment: .center) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(nextAlarm?.label ?? "좋아하는 목소리로 알람 예약")
                            .font(.headline)
                            .foregroundStyle(AlarmTalkTheme.text)
                            .lineLimit(1)
                        Text(nextAlarm == nil ? "바로 시작해봐요." : "수정하기")
                            .font(.subheadline)
                            .foregroundStyle(AlarmTalkTheme.textSecondary)
                    }
                    Spacer()
                    Image(systemName: "arrow.right")
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(AlarmTalkTheme.primaryDark)
                }
            }
            .sectionSurface()
        }
        .buttonStyle(.plain)
    }

    /// 비활성/활성 상태에 따라 진폭 채도만 달라지는 데코레이션. 정적인 32-bar 파형.
    private func waveform(active: Bool) -> some View {
        let levels: [CGFloat] = [
            0.18, 0.24, 0.16, 0.34, 0.28, 0.52, 0.38, 0.70,
            0.42, 0.60, 0.32, 0.56, 0.24, 0.66, 0.46, 0.78,
            0.40, 0.62, 0.34, 0.58, 0.28, 0.54, 0.36, 0.64,
            0.44, 0.72, 0.30, 0.48, 0.22, 0.42, 0.18, 0.36,
        ]
        return HStack(alignment: .center, spacing: 4) {
            ForEach(Array(levels.enumerated()), id: \.offset) { _, level in
                RoundedRectangle(cornerRadius: 999)
                    .fill(AlarmTalkTheme.primary.opacity(active ? 0.82 : 0.36))
                    .frame(width: 2, height: 8 + level * 34)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .center)
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
