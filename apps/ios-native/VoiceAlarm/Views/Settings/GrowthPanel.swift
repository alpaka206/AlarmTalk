import SwiftUI

/// 캐릭터 성장 패널 — 스테이지/레벨/연속 일수/스탯/동기화 상태/최근 기록.
///
/// ContentView 의 `growthPanel` 을 옮긴 것. 수동 "기상 성공 반영" 버튼은
/// 평상시 dismiss/snooze 흐름에서 AlarmAppContext 가 자동 큐잉하므로 디버그용.
/// 호출은 자동 큐 경로와 동일하게 멱등 nonce 로 위임해 더블 grant 를 방지한다.
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

            if let achievements = socialFeatures.character?.achievements, !achievements.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("달성 기록")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(VoiceAlarmTheme.textSecondary)

                    ForEach(Array(achievements.prefix(3)), id: \.milestone) { achievement in
                        CharacterAchievementRow(achievement: achievement)
                    }
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

    private var pendingCount: Int {
        characterEvents.events.count { $0.syncState == CharacterEventSyncState.pending.rawValue }
    }

    private var failedCount: Int {
        characterEvents.events.count { $0.syncState == CharacterEventSyncState.failed.rawValue }
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
                    Text(HelperFormatters.characterStageLabel(character.stage))
                        .font(.headline.weight(.bold))
                        .foregroundStyle(VoiceAlarmTheme.text)
                }
                .frame(width: 64, height: 64)

                VStack(alignment: .leading, spacing: 6) {
                    Text("LV.\(character.level) \(character.name)")
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
                MetricTile(title: "성실", value: "\(response.stats.diligence)")
                MetricTile(title: "꾸준함", value: "\(response.stats.consistency)")
            }

            HStack(spacing: 10) {
                MetricTile(title: "건강", value: "\(response.stats.health)")
                MetricTile(title: "애정", value: "\(character.affection)")
            }

            HStack(spacing: 10) {
                MetricTile(title: "오늘 XP", value: "\(character.dailyXp ?? 0)")
                MetricTile(title: "총 XP", value: "\(character.xp)")
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
                Text(HelperFormatters.characterStageLabel(nil))
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
            VStack(alignment: .leading, spacing: 3) {
                Text(eventTitle(event.eventType))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(VoiceAlarmTheme.text)
                Text(eventTimeLabel(event))
                    .font(.caption)
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 3) {
                Text(eventXpLabel(event.eventType))
                    .font(.caption.weight(.bold))
                    .foregroundStyle(eventXpColor(event.eventType))
                Text(eventStateLabel(event.syncState))
                    .font(.caption2)
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
            }
        }
        .padding(.vertical, 6)
    }
}

private struct CharacterAchievementRow: View {
    let achievement: StreakAchievement

    var body: some View {
        HStack {
            Text("연속 \(achievement.milestone)일")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(VoiceAlarmTheme.text)
            Spacer()
            Text("+\(achievement.bonusXp) XP")
                .font(.caption.weight(.bold))
                .foregroundStyle(VoiceAlarmTheme.primary)
        }
        .padding(.vertical, 6)
    }
}

private func eventTitle(_ event: String) -> String {
    switch event {
    case CharacterEventType.alarmCompleted.rawValue:
        return "기상 성공"
    case CharacterEventType.alarmSnoozed.rawValue:
        return "다시 알림"
    case "alarm_dismissed":
        return "알람 종료"
    default:
        return "성장 이벤트"
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

private func eventStateLabel(_ state: String) -> String {
    switch state {
    case CharacterEventSyncState.synced.rawValue:
        return "반영됨"
    case CharacterEventSyncState.failed.rawValue:
        return "실패"
    default:
        return "대기"
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
