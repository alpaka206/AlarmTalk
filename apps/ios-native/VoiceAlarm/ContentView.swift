import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var store: LocalAlarmStore
    @EnvironmentObject private var alarmKit: AlarmKitViewModel

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    statusSection
                    alarmSection
                    limitationSection
                }
                .padding(20)
            }
            .background(VoiceAlarmTheme.background)
            .navigationTitle("Voice Alarm")
        }
    }

    private var statusSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("AlarmKit")
                .font(.headline)
            Text("Authorization: \(alarmKit.authorizationLabel)")
                .foregroundStyle(VoiceAlarmTheme.textSecondary)
            if let message = alarmKit.statusMessage {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
            }
            Button("Request Alarm Permission") {
                Task { await alarmKit.requestAuthorization() }
            }
            .buttonStyle(.borderedProminent)
            .tint(VoiceAlarmTheme.primary)
            .foregroundStyle(VoiceAlarmTheme.text)
        }
        .sectionSurface()
    }

    private var alarmSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Local Alarms")
                .font(.headline)
            HStack {
                Button("1 min test alarm") {
                    Task { await alarmKit.scheduleOneMinuteTest(store: store) }
                }
                .buttonStyle(.borderedProminent)
                .tint(VoiceAlarmTheme.primary)
                .foregroundStyle(VoiceAlarmTheme.text)

                Button("Weekly repeat test") {
                    Task { await alarmKit.scheduleWeeklyMorningTest(store: store) }
                }
                .buttonStyle(.bordered)
            }

            if store.alarms.isEmpty {
                Text("No local AlarmKit IDs stored")
                    .font(.footnote)
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
            } else {
                ForEach(store.alarms) { alarm in
                    VStack(alignment: .leading, spacing: 4) {
                        Text("\(timeLabel(alarm)) \(alarm.label)")
                            .font(.subheadline.weight(.semibold))
                        Text(alarm.enabled ? "Enabled" : "Inactive")
                            .font(.caption)
                            .foregroundStyle(VoiceAlarmTheme.textSecondary)
                    }
                }
            }
        }
        .sectionSurface()
    }

    private var limitationSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("PoC limits")
                .font(.headline)
            Text("Custom local voice alarm audio must be validated on a physical device and target iOS release.")
            Text("Critical Alerts are not the default plan.")
            Text("No APNs, push, server cron, or network fetch is used for ringing.")
        }
        .font(.footnote)
        .foregroundStyle(VoiceAlarmTheme.textSecondary)
        .sectionSurface()
    }

    private func timeLabel(_ alarm: LocalAlarmRecord) -> String {
        String(format: "%02d:%02d", alarm.hour, alarm.minute)
    }
}

private extension View {
    func sectionSurface() -> some View {
        self
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(VoiceAlarmTheme.surface)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(VoiceAlarmTheme.surfaceVariant, lineWidth: 1)
            )
    }
}
