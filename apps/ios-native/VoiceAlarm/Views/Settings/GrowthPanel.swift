import SwiftUI

/// 캐릭터 성장 패널 — 스테이지/레벨/연속 일수/스탯/동기화 상태/최근 기록.
///
/// ContentView 의 `growthPanel` 을 옮긴 것. 성장 이벤트 생성은 Android 처럼
/// 알람 dismiss/snooze 흐름에서만 자동 큐잉하고, 이 화면은 동기화/조회만 담당한다.
struct GrowthPanel: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var socialFeatures: SocialFeatureViewModel
    @EnvironmentObject private var characterEvents: CharacterEventStore

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("캐릭터 성장")
                    .font(.headline.weight(.bold))
                    .foregroundStyle(VoiceAlarmTheme.text)

                Spacer()

                Button {
                    Task { await syncAndRefreshCharacter() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .disabled(socialFeatures.isBusy || characterEvents.isFlushing)
                .accessibilityLabel(Text(hasUnreflectedEvents ? "성장 반영" : "캐릭터 새로고침"))
            }

            if let characterResponse = socialFeatures.character {
                CharacterSummaryView(response: characterResponse)
            } else {
                CharacterEmptyStateView(isBusy: socialFeatures.isBusy) {
                    Task { await socialFeatures.refreshAll(session: auth.session, force: true) }
                }
            }

            if hasUnreflectedEvents {
                CharacterSyncStatusView(
                    pendingCount: pendingCount,
                    failedCount: failedCount
                )
            }

            if !recentEvents.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("최근 성장 기록")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(VoiceAlarmTheme.textSecondary)

                    ForEach(recentEvents) { event in
                        CharacterEventRecordRow(event: event)
                    }
                }
            }

        }
        .sectionSurface()
    }

    private var pendingCount: Int {
        characterEvents.events.filter { $0.syncState == CharacterEventSyncState.pending.rawValue }.count
    }

    private var failedCount: Int {
        characterEvents.events.filter { $0.syncState == CharacterEventSyncState.failed.rawValue }.count
    }

    private var hasUnreflectedEvents: Bool {
        pendingCount + failedCount > 0
    }

    private var recentEvents: [CharacterEventEntity] {
        Array(
            characterEvents.events
                .sorted { $0.createdAtMillis > $1.createdAtMillis }
                .prefix(3)
        )
    }

    @MainActor
    private func syncAndRefreshCharacter() async {
        if hasUnreflectedEvents {
            _ = await characterEvents.flushPending()
        }
        await socialFeatures.refreshAll(session: auth.session, force: true)
    }
}

private struct CharacterSummaryView: View {
    let response: CharacterResponse

    var body: some View {
        let character = response.character
        let progress = response.progress
        let levelSpan = max(progress.levelSpan, 1)
        let xpIntoLevel = min(max(progress.xpIntoLevel, 0), levelSpan)

        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 14) {
                ZStack {
                    Circle()
                        .fill(Color(red: 0.88, green: 0.94, blue: 0.82))
                    Text(HelperFormatters.characterStageEmoji(character.stage))
                        .font(.headline.weight(.bold))
                        .foregroundStyle(VoiceAlarmTheme.text)
                }
                .frame(width: 64, height: 64)

                VStack(alignment: .leading, spacing: 6) {
                    Text("LV.\(character.level) \(HelperFormatters.characterStageName(character.stage))")
                        .font(.headline)
                        .foregroundStyle(VoiceAlarmTheme.text)
                    Text("연속 \(response.streak.current)일 · 최장 \(response.streak.longest)일")
                        .font(.subheadline)
                        .foregroundStyle(VoiceAlarmTheme.textSecondary)
                }
            }

            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("XP")
                        .font(.caption.weight(.semibold))
                    Spacer()
                    Text("\(xpIntoLevel)/\(levelSpan)")
                        .font(.caption)
                        .foregroundStyle(VoiceAlarmTheme.textSecondary)
                }
                ProgressView(value: min(max(progress.progressRatio, 0.0), 1.0))
                    .tint(VoiceAlarmTheme.accent)
                Text("다음 레벨까지 \(progress.xpToNextLevel) XP")
                    .font(.caption)
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
            }

            HStack(spacing: 10) {
                MetricTile(title: "성실함", value: "\(response.stats.diligence)")
                MetricTile(title: "꾸준함", value: "\(response.stats.consistency)")
            }

            HStack(spacing: 10) {
                MetricTile(title: "건강", value: "\(response.stats.health)")
                MetricTile(title: "애정도", value: "\(character.affection)")
            }
        }
    }
}

private struct CharacterEmptyStateView: View {
    let isBusy: Bool
    let onRefresh: () -> Void

    var body: some View {
        VStack(alignment: .center, spacing: 12) {
            ZStack {
                Circle()
                    .fill(Color(red: 0.88, green: 0.94, blue: 0.82))
                Text(HelperFormatters.characterStageEmoji(nil))
                    .font(.headline.weight(.bold))
                    .foregroundStyle(VoiceAlarmTheme.text)
            }
            .frame(width: 64, height: 64)

            Text("캐릭터 정보를 불러오는 중이에요.")
                .font(.subheadline)
                .foregroundStyle(VoiceAlarmTheme.textSecondary)

            Button(action: onRefresh) {
                Label("새로고침", systemImage: "arrow.clockwise")
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .disabled(isBusy)
        }
        .frame(maxWidth: .infinity)
    }
}

private struct CharacterSyncStatusView: View {
    let pendingCount: Int
    let failedCount: Int

    var body: some View {
        let needsCheck = failedCount > 0

        HStack {
            Label {
                Text(needsCheck ? "반영 확인 필요" : "성장 반영 대기")
            } icon: {
                Image(systemName: needsCheck ? "exclamationmark.triangle" : "clock.arrow.circlepath")
            }
                .font(.subheadline.weight(.semibold))
            Spacer()
            Text("\(pendingCount + failedCount)개")
                .font(.subheadline.weight(.bold))
        }
        .foregroundStyle(needsCheck ? VoiceAlarmTheme.error : VoiceAlarmTheme.primary)
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background((needsCheck ? VoiceAlarmTheme.error : VoiceAlarmTheme.primary).opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct CharacterEventRecordRow: View {
    let event: CharacterEventEntity

    var body: some View {
        HStack(spacing: 12) {
            Text(eventTimeLabel(event))
                .font(.subheadline.weight(.medium))
                .foregroundStyle(VoiceAlarmTheme.text)

            Spacer()

            Text(eventXpLabel(event.eventType))
                .font(.caption.weight(.semibold))
                .foregroundStyle(eventXpColor(event.eventType))
        }
        .padding(.vertical, 6)
    }
}

private func eventXpLabel(_ event: String) -> String {
    switch event {
    case CharacterEventType.alarmCompleted.rawValue:
        return "+5 XP"
    case CharacterEventType.alarmSnoozed.rawValue, "alarm_dismissed":
        return "-5 XP"
    default:
        return "+0 XP"
    }
}

private func eventXpColor(_ event: String) -> Color {
    switch event {
    case CharacterEventType.alarmCompleted.rawValue:
        return VoiceAlarmTheme.primary
    case CharacterEventType.alarmSnoozed.rawValue, "alarm_dismissed":
        return VoiceAlarmTheme.error
    default:
        return VoiceAlarmTheme.textSecondary
    }
}

private func eventTimeLabel(_ event: CharacterEventEntity) -> String {
    let date = Date(timeIntervalSince1970: TimeInterval(event.occurredAtMillis) / 1000)
    let components = Calendar.current.dateComponents(
        [.year, .month, .day, .hour, .minute],
        from: date
    )
    return String(
        format: "%04d-%02d-%02d %02d:%02d",
        components.year ?? 1970,
        components.month ?? 1,
        components.day ?? 1,
        components.hour ?? 0,
        components.minute ?? 0
    )
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
