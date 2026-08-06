import ActivityKit
import AlarmKit
import AppIntents
import SwiftUI
import WidgetKit

// GROUP 3: AlarmTalk Live Activity.
//
// HONEST CONSTRAINT: AlarmKit 가 시스템 ALERT UI(전체화면 ring 화면)를 소유한다.
// 우리가 디자인할 수 있는 것은 (a) AlarmPresentation 의 title/버튼/tint 와
// (b) 이 ActivityKit Live Activity 의 잠금화면 + Dynamic Island 표면 뿐이다.
// 따라서 Android RingingActivity 같은 풀스크린 ring 화면을 흉내 내지 않고, LA 에
// Stop/Snooze 액션 버튼 · 모드 상태 라벨 · 모드별 부제 · 인용 보이스 문구를
// 담아 ring-moment 정보를 풍부하게 한다.
//
// 색상은 하드코딩 RGB 대신 `Shared/AlarmTalkBrand.swift` 의 브랜드 토큰을 쓴다.
// 같은 토큰을 AlarmKitViewModel.makeConfiguration 의 alert tint 도 참조하므로
// LA tint 와 시스템 alert tint 가 동기된다.
struct AlarmLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: AlarmAttributes<AlarmTalkMetadata>.self) { context in
            expandedContent(for: context)
                .padding(16)
                .activityBackgroundTint(AlarmTalkBrand.activityBackground)
                .activitySystemActionForegroundColor(AlarmTalkBrand.primaryDark)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label(alarmLabel(context), systemImage: "alarm.fill")
                        .font(.headline)
                        .foregroundStyle(AlarmTalkBrand.primaryDark)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    modeLabel(context)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(AlarmTalkBrand.activitySecondaryText)
                }
                DynamicIslandExpandedRegion(.center) {
                    timingText(context)
                        .font(.title3.weight(.bold).monospacedDigit())
                        .foregroundStyle(.white)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    actionButtons(context)
                }
            } compactLeading: {
                Image(systemName: "alarm.fill")
                    .foregroundStyle(AlarmTalkBrand.primaryDark)
            } compactTrailing: {
                // Dynamic Island 컴팩트 trailing: 현재 모드의 정적 상태 라벨.
                timingText(context)
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(AlarmTalkBrand.activitySecondaryText)
            } minimal: {
                Image(systemName: "alarm.fill")
                    .foregroundStyle(AlarmTalkBrand.primaryDark)
            }
            .keylineTint(AlarmTalkBrand.primaryDark)
        }
    }

    // MARK: - Lock-screen expanded content

    @ViewBuilder
    private func expandedContent(
        for context: ActivityViewContext<AlarmAttributes<AlarmTalkMetadata>>
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Label(alarmLabel(context), systemImage: "alarm.fill")
                    .font(.headline)
                    .foregroundStyle(AlarmTalkBrand.primaryDark)
                Spacer(minLength: 8)
                modeLabel(context)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(AlarmTalkBrand.activitySecondaryText)
            }

            // ⚠ **시각이 가장 크다.** 안드로이드 울림 화면(`RingingActivity.kt:266-290`)이
            // 104sp 시계를 첫 요소로 두는 것과 같은 이유 — 잠결에 보는 화면이라
            // "지금 울리는 중" 보다 "오전 7:30" 이 먼저 읽혀야 한다. 옛 레코드(시각 필드
            // 없음)는 종전대로 모드 라벨을 크게 그린다.
            if let clock = context.attributes.metadata?.clockLabel {
                Text(clock)
                    .font(.system(size: 40, weight: .bold).monospacedDigit())
                    .foregroundStyle(.white)

                HStack(spacing: 6) {
                    timingText(context)
                    Text("·")
                    subtitleText(context)
                }
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.84))
            } else {
                timingText(context)
                    .font(.system(size: 34, weight: .bold).monospacedDigit())
                    .foregroundStyle(.white)

                subtitleText(context)
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.84))
            }

            // 인용 보이스 문구 (있을 때만).
            if let voiceText = quotedVoiceText(context) {
                Text("\u{201C}\(voiceText)\u{201D}")
                    .font(.body)
                    .foregroundStyle(AlarmTalkBrand.activitySecondaryText)
                    .lineLimit(3)
            }

            actionButtons(context)
                .padding(.top, 2)
        }
    }

    // MARK: - Action buttons (Stop / Snooze)

    @ViewBuilder
    private func actionButtons(
        _ context: ActivityViewContext<AlarmAttributes<AlarmTalkMetadata>>
    ) -> some View {
        // 인텐트 구성에는 AlarmKit UUID 가 필요하다. metadata.alarmKitID 가 없으면
        // (구버전 레코드) 버튼을 숨겨 잘못된 인텐트를 막는다.
        if let alarmID = context.attributes.metadata?.alarmKitID {
            HStack(spacing: 10) {
                Button(intent: StopAlarmIntent(alarmID: alarmID)) {
                    Label("끄기", systemImage: "stop.fill")
                        .font(.subheadline.weight(.bold))
                        .frame(maxWidth: .infinity)
                }
                .tint(AlarmTalkBrand.primaryDark)

                // snoozeMinutes 0 -> 인텐트가 레코드의 snoozeMinutes 를 사용한다
                // (SnoozeAlarmIntent.perform 의 snoozeMinutesOverride == nil 분기).
                // 정확한 "N분 더 자기" 라벨은 시스템 alert 보조 버튼이 표기한다 — LA 는
                // ContentState 로 분을 받지 않으므로 정직하게 일반 라벨을 쓴다.
                Button(intent: SnoozeAlarmIntent(alarmID: alarmID, snoozeMinutes: 0)) {
                    Label("다시 울리기", systemImage: "moon.zzz.fill")
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity)
                }
                .tint(.white.opacity(0.16))
            }
            .buttonStyle(.borderedProminent)
        }
    }

    // MARK: - Mode status label (static)

    @ViewBuilder
    private func timingText(
        _ context: ActivityViewContext<AlarmAttributes<AlarmTalkMetadata>>
    ) -> some View {
        // COMPILE-SAFETY: AlarmKit `AlarmPresentationState.Mode` 의 .countdown 이
        // fireDate 를 담은 Countdown payload 를 운반한다는 보장이 (이 환경에 SDK 가
        // 없어) 검증되지 않았다. 따라서 payload 바인딩(`case .countdown(let ...)`)과
        // `Text(timerInterval:)` 라이브 타이머를 쓰지 않고, 직전 동작하던 코드처럼
        // payload-less 매칭으로 정적 라벨만 렌더한다. (우리가 제어하지 못하는
        // 미검증 payload 에 의존하는 라이브 시스템 카운트다운은 의도적으로 생략.)
        switch context.state.mode {
        case .countdown:
            Text("다시 울림 대기 중")
        case .paused:
            Text("일시정지됨")
        case .alert:
            Text("지금 울리는 중")
        @unknown default:
            Text("예약됨")
        }
    }

    // MARK: - Mode label (compact)

    @ViewBuilder
    private func modeLabel(
        _ context: ActivityViewContext<AlarmAttributes<AlarmTalkMetadata>>
    ) -> some View {
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

    // MARK: - Play-mode subtitle (Android ringingModeLabel parity)

    @ViewBuilder
    private func subtitleText(
        _ context: ActivityViewContext<AlarmAttributes<AlarmTalkMetadata>>
    ) -> some View {
        Text(subtitle(context))
    }

    /// Android `RingingActivity.ringingModeLabel` 의 parity.
    /// voiceText 가 있으면 "음성 알람", 아니면 playMode 별 문구.
    ///
    /// NOTE: `AlarmPlayMode` enum 은 앱 타겟 전용(`AlarmEnums.swift`)이라 위젯에서
    /// 참조할 수 없다. 따라서 metadata.playMode 의 raw 문자열을 직접 비교한다
    /// (raw 값은 `AlarmPlayMode` / Android `AlarmPlayModes` 와 동일하게 고정).
    private func subtitle(
        _ context: ActivityViewContext<AlarmAttributes<AlarmTalkMetadata>>
    ) -> String {
        if quotedVoiceText(context) != nil {
            return "음성 알람"
        }
        switch context.attributes.metadata?.playMode {
        case "voice_only":
            return "음성으로 깨워요"
        case "sound_then_voice", "alarm_voice":
            return "알람 후 음성으로 깨워요"
        default: // "alarm_only" / nil / unknown
            return "알람 소리로 깨워요"
        }
    }

    // MARK: - Helpers

    private func quotedVoiceText(
        _ context: ActivityViewContext<AlarmAttributes<AlarmTalkMetadata>>
    ) -> String? {
        guard let raw = context.attributes.metadata?.voiceText else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private func alarmLabel(
        _ context: ActivityViewContext<AlarmAttributes<AlarmTalkMetadata>>
    ) -> String {
        context.attributes.metadata?.label ?? "알람"
    }
}
