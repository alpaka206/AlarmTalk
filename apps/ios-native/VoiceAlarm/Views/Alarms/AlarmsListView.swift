import SwiftUI

/// 알람 탭 본화면. 권한 카드 → 로컬 알람 리스트 순으로 쌓는다.
///
/// ContentView 의 `alarmsScreen` / `localAlarmSection` 합본.
/// 알람 추가 버튼/리스트 항목 액션은 부모(MainTabsView)가 넘긴 콜백을 호출한다.
struct AlarmsListView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var store: LocalAlarmStore
    @EnvironmentObject private var alarmKit: AlarmKitViewModel
    @EnvironmentObject private var remoteSync: RemoteAlarmSyncViewModel

    let openEditor: (AlarmEditorTarget) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .center) {
                ScreenHeader(title: "알람")
                Spacer()
                Button {
                    openEditor(.create())
                } label: {
                    Label("알람 만들기", systemImage: "plus")
                }
                .buttonStyle(.borderedProminent)
                .tint(VoiceAlarmTheme.primary)
                .foregroundStyle(VoiceAlarmTheme.text)
            }

            if !alarmKit.alarmAuthorized {
                AlarmPermissionSection()
            }
            localAlarmSection
        }
    }

    private var localAlarmSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            if store.alarms.isEmpty {
                EmptyStatePlaceholder(
                    title: "아직 알람이 없어요.",
                    subtitle: "",
                    icon: "alarm"
                )
                Button {
                    openEditor(.create())
                } label: {
                    Text("새 알람 만들기")
                }
                .buttonStyle(.borderedProminent)
                .tint(VoiceAlarmTheme.primary)
                .foregroundStyle(VoiceAlarmTheme.text)
            } else {
                ForEach(sortedAlarms) { alarm in
                    AlarmRow(
                        alarm: alarm,
                        onTap: { openEditor(.edit(alarm.id)) },
                        onToggleEnabled: { enabled in
                            Task { await setAlarm(alarm, enabled: enabled) }
                        },
                        onDelete: {
                            Task {
                                await remoteSync.deleteRemote(record: alarm, session: auth.session)
                                await alarmKit.cancel(record: alarm, store: store)
                            }
                        }
                    )
                }
            }
        }
        .sectionSurface()
    }

    private var sortedAlarms: [LocalAlarmRecord] {
        store.alarms.sorted { lhs, rhs in
            if lhs.hour != rhs.hour { return lhs.hour < rhs.hour }
            if lhs.minute != rhs.minute { return lhs.minute < rhs.minute }
            return lhs.createdAtMillis < rhs.createdAtMillis
        }
    }

    @MainActor
    private func setAlarm(_ alarm: LocalAlarmRecord, enabled: Bool) async {
        if enabled {
            store.setEnabled(id: alarm.id, enabled: true)
            guard let updated = store.record(id: alarm.id) else { return }
            let scheduled = await alarmKit.schedule(record: updated, store: store)
            if !scheduled {
                store.markFailed(id: updated.id)
                return
            }
            if store.record(id: updated.id)?.remoteAlarmId != nil,
               let synced = store.record(id: updated.id) {
                await remoteSync.push(record: synced, store: store, session: auth.session)
            }
        } else {
            let canceled = await alarmKit.cancelScheduledAlarm(record: alarm)
            guard canceled else {
                store.markFailed(id: alarm.id)
                return
            }
            store.setEnabled(id: alarm.id, enabled: false)
            if store.record(id: alarm.id)?.remoteAlarmId != nil,
               let updated = store.record(id: alarm.id) {
                await remoteSync.push(record: updated, store: store, session: auth.session)
            }
        }
    }
}

#if DEBUG
#Preview("AlarmsListView (light)") {
    NavigationStack {
        ScrollView {
            AlarmsListView(openEditor: { _ in })
                .padding()
        }
    }
    .voiceAlarmPreviewEnvironment()
}

#Preview("AlarmsListView (dark)") {
    NavigationStack {
        ScrollView {
            AlarmsListView(openEditor: { _ in })
                .padding()
        }
    }
    .preferredColorScheme(.dark)
    .voiceAlarmPreviewEnvironment()
}
#endif
