import ActivityKit
import AlarmKit
import SwiftUI
import WidgetKit

struct AlarmLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: AlarmAttributes<AlarmTalkMetadata>.self) { context in
            content(for: context)
                .padding(16)
                .activityBackgroundTint(Color(red: 0.18, green: 0.24, blue: 0.36))
                .activitySystemActionForegroundColor(Color(red: 0.91, green: 0.70, blue: 0.25))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label(alarmLabel(context), systemImage: "alarm.fill")
                        .font(.headline)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    modeLabel(context)
                        .font(.subheadline.weight(.semibold))
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text("AlarmTalk")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } compactLeading: {
                Image(systemName: "alarm.fill")
            } compactTrailing: {
                modeLabel(context)
            } minimal: {
                Image(systemName: "alarm.fill")
            }
            .keylineTint(Color(red: 0.91, green: 0.70, blue: 0.25))
        }
    }

    @ViewBuilder
    private func content(for context: ActivityViewContext<AlarmAttributes<AlarmTalkMetadata>>) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(alarmLabel(context), systemImage: "alarm.fill")
                .font(.headline)
                .foregroundStyle(Color(red: 0.91, green: 0.70, blue: 0.25))
            modeLabel(context)
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.84))
        }
    }

    @ViewBuilder
    private func modeLabel(_ context: ActivityViewContext<AlarmAttributes<AlarmTalkMetadata>>) -> some View {
        switch context.state.mode {
        case .alert:
            Text("알람 울림")
        case .countdown:
            Text("다시 울림")
        case .paused:
            Text("일시정지")
        @unknown default:
            Text("예약됨")
        }
    }

    private func alarmLabel(_ context: ActivityViewContext<AlarmAttributes<AlarmTalkMetadata>>) -> String {
        context.attributes.metadata?.label ?? "알람"
    }
}
