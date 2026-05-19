import SwiftUI

/// 알람 리스트의 한 줄.
///
/// ContentView 의 `alarmRow(_:)` 헬퍼를 옮긴 것. 본문은 알람 편집 진입,
/// 우측 메뉴는 서버 push/cancel 등을 노출한다. 모든 부수효과는 부모(AlarmsListView)에
/// 위임해 본 컴포넌트는 순수 표시 + 콜백 호출만 책임진다.
struct AlarmRow: View {
    let alarm: LocalAlarmRecord
    let onTap: () -> Void
    let onEdit: () -> Void
    let onPushRemote: () -> Void
    let onDelete: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Button(action: onTap) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(alarm.timeString) \(alarm.label)")
                        .font(.headline)
                        .foregroundStyle(VoiceAlarmTheme.text)
                    Text(HelperFormatters.alarmDetail(alarm))
                        .font(.caption)
                        .foregroundStyle(VoiceAlarmTheme.textSecondary)
                        .lineLimit(2)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)

            Menu {
                Button("수정", action: onEdit)
                Button("서버에 저장", action: onPushRemote)
                Button("취소", role: .destructive, action: onDelete)
            } label: {
                Image(systemName: "ellipsis.circle")
                    .font(.title3)
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
            }
        }
        .padding(12)
        .background(VoiceAlarmTheme.surfaceVariant)
        .clipShape(RoundedRectangle(cornerRadius: 8))
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
        onTap: {}, onEdit: {}, onPushRemote: {}, onDelete: {}
    )
    .padding()
}

#Preview("AlarmRow (dark)") {
    AlarmRow(
        alarm: .previewSample,
        onTap: {}, onEdit: {}, onPushRemote: {}, onDelete: {}
    )
    .padding()
    .preferredColorScheme(.dark)
}
#endif
