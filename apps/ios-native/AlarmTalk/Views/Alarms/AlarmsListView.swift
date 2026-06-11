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
    @StateObject private var holidayStore = HolidayStore()
    @State private var actionMessage: String?

    let openEditor: (AlarmEditorTarget) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .center) {
                ScreenHeader(title: "알람")
                Spacer()
                Button {
                    Task { await openCreateAlarm() }
                } label: {
                    Label("알람 만들기", systemImage: "plus")
                }
                .buttonStyle(.borderedProminent)
                .tint(AlarmTalkTheme.primary)
                .foregroundStyle(AlarmTalkTheme.text)
            }

            if !alarmKit.alarmAuthorized {
                AlarmPermissionSection()
            }
            if let actionMessage {
                Text(actionMessage)
                    .font(.footnote)
                    .foregroundStyle(AlarmTalkTheme.textSecondary)
                    .padding(.horizontal, 4)
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
                    Task { await openCreateAlarm() }
                } label: {
                    Text("새 알람 만들기")
                }
                .buttonStyle(.borderedProminent)
                .tint(AlarmTalkTheme.primary)
                .foregroundStyle(AlarmTalkTheme.text)
            } else {
                ForEach(sortedAlarms) { alarm in
                    AlarmRow(
                        alarm: alarm,
                        onTap: { openEditor(.edit(alarm.id)) },
                        onToggleEnabled: { enabled in
                            Task { await setAlarm(alarm, enabled: enabled) }
                        },
                        onCopy: {
                            Task { await copyAlarm(alarm) }
                        },
                        onDelete: {
                            Task { await deleteAlarm(alarm) }
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
    private func openCreateAlarm() async {
        alarmKit.refreshAuthorizationState()
        guard alarmKit.alarmAuthorized else {
            await alarmKit.requestAuthorization()
            alarmKit.refreshAuthorizationState()
            guard alarmKit.alarmAuthorized else { return }
            openEditor(.create())
            return
        }
        openEditor(.create())
    }

    @MainActor
    private func setAlarm(_ alarm: LocalAlarmRecord, enabled: Bool) async {
        if enabled {
            store.setEnabled(id: alarm.id, enabled: true)
            guard let updated = store.record(id: alarm.id) else { return }
            let scheduled = await alarmKit.schedule(record: updated, store: store)
            if !scheduled {
                store.markFailed(id: updated.id)
                actionMessage = alarmKit.statusMessage ?? "알람 상태 변경에 실패했어요."
                return
            }
            if store.record(id: updated.id)?.remoteAlarmId != nil,
               let synced = store.record(id: updated.id) {
                await remoteSync.push(record: synced, store: store, session: auth.session)
            }
            actionMessage = nil
        } else {
            let canceled = await alarmKit.cancelScheduledAlarm(record: alarm)
            guard canceled else {
                store.markFailed(id: alarm.id)
                actionMessage = alarmKit.statusMessage ?? "알람 상태 변경에 실패했어요."
                return
            }
            store.setEnabled(id: alarm.id, enabled: false)
            if store.record(id: alarm.id)?.remoteAlarmId != nil,
               let updated = store.record(id: alarm.id) {
                await remoteSync.push(record: updated, store: store, session: auth.session)
            }
            actionMessage = nil
        }
    }

    @MainActor
    private func deleteAlarm(_ alarm: LocalAlarmRecord) async {
        await remoteSync.deleteRemote(record: alarm, session: auth.session)
        let deleted = await alarmKit.cancel(record: alarm, store: store)
        if deleted {
            actionMessage = "알람을 삭제했어요."
        } else {
            actionMessage = alarmKit.statusMessage ?? "알람 삭제에 실패했어요."
        }
    }

    @MainActor
    private func copyAlarm(_ alarm: LocalAlarmRecord) async {
        do {
            let copied = try store.copyAlarm(
                id: alarm.id,
                isHoliday: holidayStore.holidayPredicate()
            )
            let scheduled = await alarmKit.schedule(record: copied, store: store)
            if scheduled {
                actionMessage = "알람을 10분 뒤로 복사했어요. \(copied.timeString)"
            } else {
                // cancel(record:store:) = store.delete + 마지막 참조였던
                // audioCacheKey 의 캐시 음원까지 정리 (공유 키는 보존).
                _ = await alarmKit.cancel(record: copied, store: store)
                actionMessage = alarmKit.statusMessage ?? "알람 복사에 실패했어요."
            }
        } catch {
            actionMessage = userFacingErrorMessage(
                error,
                fallback: "알람 복사에 실패했어요."
            )
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
