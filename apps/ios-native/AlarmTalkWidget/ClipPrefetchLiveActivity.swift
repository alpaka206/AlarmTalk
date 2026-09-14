import ActivityKit
import SwiftUI
import WidgetKit

/// 목소리를 받는 동안 잠금화면·다이나믹 아일랜드에 뜨는 진행률.
/// 안드로이드의 진행률 알림과 같은 뜻이다 — iOS 에는 갱신되는 진행률 알림이 없다.
struct ClipPrefetchLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ClipPrefetchActivityAttributes.self) { context in
            VStack(alignment: .leading, spacing: 8) {
                Text(context.attributes.title)
                    .font(.headline)
                Text(context.state.detail)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                ProgressView(value: Double(context.state.percent), total: 100)
            }
            .padding()
            .activityBackgroundTint(Color.black.opacity(0.35))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Text(context.attributes.title).font(.caption)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    // 숫자 폭이 흔들리지 않게 — 퍼센트가 오르내릴 때 시선이 튄다.
                    Text("\(context.state.percent)%").font(.caption).monospacedDigit()
                }
                DynamicIslandExpandedRegion(.bottom) {
                    ProgressView(value: Double(context.state.percent), total: 100)
                }
            } compactLeading: {
                Image(systemName: "arrow.down.circle")
            } compactTrailing: {
                Text("\(context.state.percent)%").monospacedDigit()
            } minimal: {
                Image(systemName: "arrow.down.circle")
            }
        }
    }
}
