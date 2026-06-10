import SwiftUI

/// 홈 화면 하단의 캐릭터 진행 요약 카드.
///
/// ContentView 의 `characterMiniCard` 를 옮긴 것. 부모(HomeView)는 캐릭터 시트로의
/// 전환만 책임지고, 값은 `SocialFeatureViewModel.character` 에서 읽는다.
struct CharacterMiniCard: View {
    @EnvironmentObject private var socialFeatures: SocialFeatureViewModel
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 14) {
                let characterResponse = socialFeatures.character
                let character = characterResponse?.character
                let progressModel = characterResponse?.progress
                let levelSpan = max(progressModel?.levelSpan ?? 100, 1)
                let xpIntoLevel = min(max(progressModel?.xpIntoLevel ?? 0, 0), levelSpan)
                let progress = Double(xpIntoLevel) / Double(levelSpan)
                let streak = characterResponse?.streak.current ?? 0
                ZStack {
                    Circle()
                        .fill(Color(red: 0.88, green: 0.94, blue: 0.82))
                    Text(HelperFormatters.characterStageEmoji(character?.stage))
                        .font(.caption.weight(.bold))
                        .foregroundStyle(AlarmTalkTheme.text)
                }
                .frame(width: 52, height: 52)

                VStack(alignment: .leading, spacing: 7) {
                    HStack {
                        Text("LV.\(character?.level ?? 1)")
                            .font(.headline)
                            .foregroundStyle(AlarmTalkTheme.text)
                        Spacer()
                        Text("연속 \(streak)일")
                            .font(.caption)
                            .foregroundStyle(AlarmTalkTheme.textSecondary)
                    }
                    ProgressView(value: progress)
                        .tint(AlarmTalkTheme.accent)
                }
                Image(systemName: "arrow.right")
                    .foregroundStyle(AlarmTalkTheme.accent)
            }
            .sectionSurface()
        }
        .buttonStyle(.plain)
    }
}

#if DEBUG
#Preview("CharacterMiniCard (light)") {
    CharacterMiniCard(onTap: {})
        .padding()
        .voiceAlarmPreviewEnvironment()
}

#Preview("CharacterMiniCard (dark)") {
    CharacterMiniCard(onTap: {})
        .padding()
        .preferredColorScheme(.dark)
        .voiceAlarmPreviewEnvironment()
}
#endif
