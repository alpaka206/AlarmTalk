import SwiftUI

/// 알람 리스트의 한 줄.
///
/// ContentView 의 `alarmRow(_:)` 헬퍼를 옮긴 것. 본문은 알람 편집 진입,
/// 토글과 삭제 액션은 부모(AlarmsListView)에 위임해 본 컴포넌트는 순수 표시 +
/// 콜백 호출만 책임진다.
struct AlarmRow: View {
    let alarm: LocalAlarmRecord
    let onTap: () -> Void
    let onToggleEnabled: (Bool) -> Void
    let onDelete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center, spacing: 12) {
                Button(action: onTap) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(alarm.timeString)
                            .font(.title2.weight(.regular))
                            .foregroundStyle(alarm.enabled ? VoiceAlarmTheme.text : VoiceAlarmTheme.textSecondary)
                        Text(alarm.label)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(alarm.enabled ? VoiceAlarmTheme.text : VoiceAlarmTheme.textSecondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.plain)

                Toggle(
                    "",
                    isOn: Binding(
                        get: { alarm.enabled },
                        set: { onToggleEnabled($0) }
                    )
                )
                .labelsHidden()
                .accessibilityLabel(Text(alarm.enabled ? "알람 끄기" : "알람 켜기"))

                Menu {
                    Button("삭제", role: .destructive, action: onDelete)
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .font(.title3)
                        .foregroundStyle(VoiceAlarmTheme.textSecondary)
                }
            }

            if let warningText {
                HStack(alignment: .center, spacing: 8) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.caption.weight(.semibold))
                    Text(warningText)
                        .font(.caption.weight(.semibold))
                }
                .foregroundStyle(VoiceAlarmTheme.error)
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(VoiceAlarmTheme.error.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
            }
        }
        .padding(12)
        .background(VoiceAlarmTheme.surfaceVariant)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private var warningText: String? {
        if alarm.runtimeStateEnum == .failed {
            return "알람을 다시 예약하지 못했어요. 시간을 확인하고 다시 저장해 주세요."
        }
        if alarm.syncStateEnum == .syncFailed {
            return "서버에 저장하지 못했어요. 이 기기의 알람은 그대로 울려요."
        }
        return nil
    }
}

#if DEBUG
private extension LocalAlarmRecord {
    /// Preview 전용 더미 인스턴스. snake_case 필드까지 모두 채워 화면 표시를 확인.
    static var previewSample: LocalAlarmRecord {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        return LocalAlarmRecord(
            id: "preview-1",
            label: "아침 알람",
            hour: 7,
            minute: 30,
            fireAtMillis: now + 8 * 60 * 60 * 1000,
            repeatDaysMask: 0,
            holidayOff: false,
            snoozeEnabled: true,
            snoozeMinutes: 5,
            snoozeRepeatLimit: SnoozeRepeatLimit.three.rawValue,
            snoozeCount: 0,
            vibrationPattern: VibrationPattern.default.rawValue,
            playMode: AlarmPlayMode.alarmOnly.rawValue,
            defaultAlarmSoundId: DefaultAlarmSounds.bundledDefault,
            localAudioUri: nil,
            audioCacheKey: nil,
            rawAudioUri: nil,
            voiceSource: VoiceSource.ttsProfile.rawValue,
            voiceProfileId: nil,
            voiceText: nil,
            voiceCategory: nil,
            voiceLanguage: nil,
            voiceRandomPrompt: false,
            voiceRepeat: true,
            ttsMessageId: nil,
            remoteAlarmId: nil,
            lastSyncedAtMillis: nil,
            syncState: AlarmSyncState.localOnly.rawValue,
            origin: AlarmOrigin.localOwned.rawValue,
            alarmVolumePercent: 80,
            alarmSoundUri: nil,
            alarmSoundLabel: nil,
            enabled: true,
            state: AlarmRuntimeState.armed.rawValue,
            createdAtMillis: now,
            updatedAtMillis: now,
            alarmKitID: nil
        )
    }
}

#Preview("AlarmRow (light)") {
    AlarmRow(
        alarm: .previewSample,
        onTap: {}, onToggleEnabled: { _ in }, onDelete: {}
    )
    .padding()
}

#Preview("AlarmRow (dark)") {
    AlarmRow(
        alarm: .previewSample,
        onTap: {}, onToggleEnabled: { _ in }, onDelete: {}
    )
    .padding()
    .preferredColorScheme(.dark)
}
#endif
