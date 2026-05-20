import SwiftUI

/// 캐릭터 성장 패널 — 스테이지/레벨/연속 일수/스탯/수동 보정 버튼.
///
/// ContentView 의 `growthPanel` 을 옮긴 것. 수동 "기상 성공 반영" 버튼은
/// 평상시 dismiss/snooze 흐름에서 AlarmAppContext 가 자동 큐잉하므로 디버그용.
/// 호출은 자동 큐 경로와 동일하게 멱등 nonce 로 위임해 더블 grant 를 방지한다.
struct GrowthPanel: View {
    @EnvironmentObject private var socialFeatures: SocialFeatureViewModel
    @EnvironmentObject private var characterEvents: CharacterEventStore

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            let character = socialFeatures.character?.character
            let progress = socialFeatures.character?.progress
            let streak = socialFeatures.character?.streak
            HStack(spacing: 14) {
                ZStack {
                    Circle()
                        .fill(Color(red: 0.88, green: 0.94, blue: 0.82))
                    Text(HelperFormatters.characterStageLabel(character?.stage))
                        .font(.headline.weight(.bold))
                        .foregroundStyle(VoiceAlarmTheme.text)
                }
                .frame(width: 58, height: 58)

                VStack(alignment: .leading, spacing: 6) {
                    Text(character?.name ?? "Naro")
                        .font(.headline)
                    Text("LV.\(character?.level ?? 1) · 애정 \(character?.affection ?? 0)")
                        .font(.subheadline)
                        .foregroundStyle(VoiceAlarmTheme.textSecondary)
                    ProgressView(value: progress?.progressRatio ?? 0)
                        .tint(VoiceAlarmTheme.accent)
                }
            }

            HStack(spacing: 10) {
                MetricTile(title: "연속", value: "\(streak?.current ?? 0)일")
                MetricTile(title: "최장", value: "\(streak?.longest ?? 0)일")
                MetricTile(title: "오늘 XP", value: "\(character?.dailyXp ?? 0)")
            }

            if let stats = socialFeatures.character?.stats {
                HStack(spacing: 10) {
                    MetricTile(title: "성실", value: "\(stats.diligence)")
                    MetricTile(title: "건강", value: "\(stats.health)")
                    MetricTile(title: "꾸준함", value: "\(stats.consistency)")
                }
            }

            // Phase 2-B5: 평상시 알람 dismiss/snooze 시 AlarmAppContext 가
            // characterEvents.queue 를 자동 호출하므로 이 버튼은 디버그/수동 보정용.
            // 호출은 자동 큐 경로와 동일하게 멱등 nonce 로 위임해 더블 grant 방지.
            Button {
                Task {
                    let now = Date()
                    let occurredAtMillis = Int64(now.timeIntervalSince1970 * 1000)
                    let alarmID = "manual-\(occurredAtMillis)"
                    let nonce = CharacterEventStore.buildClientNonce(
                        alarmID: alarmID,
                        eventType: .alarmCompleted,
                        occurredAtMillis: occurredAtMillis
                    )
                    await characterEvents.queue(
                        eventType: .alarmCompleted,
                        occurredAtMillis: occurredAtMillis,
                        clientNonce: nonce,
                        sourceAlarmId: alarmID,
                        context: ["source": "manual_button"]
                    )
                }
            } label: {
                Label("기상 성공 반영", systemImage: "checkmark.circle")
            }
            .buttonStyle(.bordered)
            .disabled(socialFeatures.isBusy)
        }
        .sectionSurface()
    }
}

#if DEBUG
#Preview("GrowthPanel (light)") {
    ScrollView {
        GrowthPanel().padding()
    }
    .voiceAlarmPreviewEnvironment()
}

#Preview("GrowthPanel (dark)") {
    ScrollView {
        GrowthPanel().padding()
    }
    .preferredColorScheme(.dark)
    .voiceAlarmPreviewEnvironment()
}
#endif
