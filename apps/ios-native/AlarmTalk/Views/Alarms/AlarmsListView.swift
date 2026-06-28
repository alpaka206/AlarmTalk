import SwiftUI

/// 알람 탭 본화면. 권한 카드 → 로컬 알람 리스트 순으로 쌓는다.
///
/// ContentView 의 `alarmsScreen` / `localAlarmSection` 합본.
/// 알람 추가 버튼/리스트 항목 액션은 부모(MainTabsView)가 넘긴 콜백을 호출한다.
struct AlarmsListView: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var store: LocalAlarmStore
    @EnvironmentObject private var alarmKit: AlarmKitViewModel
    @EnvironmentObject private var remoteSync: RemoteAlarmSyncViewModel
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
            // 인라인 액션 메시지(alarmKit 유래)를 우선 보여주고, 없을 때만 동기화 상태
            // (로그인 필요 / push·pull 부분 실패)를 노출한다. 둘을 동시에 쌓지 않는다.
            // Android syncNow / msg_sync_*_partial_failed parity.
            if let displayedMessage {
                Text(displayedMessage)
                    .font(.footnote)
                    .foregroundStyle(AlarmTalkTheme.textSecondary)
                    .padding(.horizontal, 4)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                    .onTapGesture { dismissDisplayedMessage() }
                    .accessibilityAddTraits(.isButton)
                    .accessibilityHint("탭하면 닫혀요")
            }
            localAlarmSection
        }
    }

    /// 인라인 액션 메시지(alarmKit 유래) 우선, 없으면 동기화 상태 메시지. 둘 중 하나만.
    private var displayedMessage: String? {
        actionMessage ?? remoteSync.statusMessage
    }

    /// 표시 중인 메시지를 닫는다. actionMessage 가 떠 있으면 그것을, 아니면 동기화
    /// 상태 메시지를 지운다(둘은 동시에 뜨지 않으므로 보이는 쪽만 비운다).
    private func dismissDisplayedMessage() {
        if actionMessage != nil {
            actionMessage = nil
        } else {
            remoteSync.statusMessage = nil
        }
    }

    @ViewBuilder
    private var localAlarmSection: some View {
        if store.alarms.isEmpty {
            emptyAlarmCard
        } else {
            // 각 알람을 독립 카드로 그리고 16pt 간격으로 쌓는다(Android LazyColumn
            // spacedBy 16 + 카드형 AlarmRow 미러). 바깥을 한 장의 카드로 묶지 않는다.
            VStack(alignment: .leading, spacing: 16) {
                ForEach(sortedAlarms) { alarm in
                    AlarmRow(
                        alarm: alarm,
                        onTap: { openEditor(.edit(alarm.id)) },
                        onToggleEnabled: { enabled in
                            Task { await setAlarm(alarm, enabled: enabled) }
                        },
                        onDelete: {
                            Task { await deleteAlarm(alarm) }
                        }
                    )
                }
            }
        }
    }

    /// 빈 상태 카드. Android `EmptyAlarmCard` 미러: 가운데 정렬, 큰 secondary 알람
    /// 아이콘, titleLarge 굵은 제목(부제 없음), 만들기 버튼을 한 장의 WakerPanelShape(18)
    /// surface 카드에 담는다.
    private var emptyAlarmCard: some View {
        VStack(spacing: 10) {
            Image(systemName: "alarm")
                .font(.system(size: 44))
                .foregroundStyle(theme.palette.secondary)
            Text("아직 알람이 없어요.")
                .font(theme.typography.titleLarge)
                .fontWeight(.bold)
                .foregroundStyle(theme.palette.onSurface)
            Button {
                Task { await openCreateAlarm() }
            } label: {
                Text("새 알람 만들기")
            }
            .buttonStyle(.borderedProminent)
            .tint(theme.palette.primary)
            .foregroundStyle(theme.palette.onPrimary)
        }
        .frame(maxWidth: .infinity)
        .padding(24)
        .background(theme.palette.surface)
        .clipShape(RoundedRectangle(cornerRadius: theme.shapes.medium, style: .continuous))
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

    /// 알람 삭제 실행. 스와이프 삭제 버튼 또는 길게 누르기 메뉴에서 곧바로 호출된다
    /// (Android 즉시 삭제 미러 — 별도 확인 다이얼로그 없음, 스와이프 제스처가 안전장치).
    ///
    /// 의도적 누락: 서버에 소프트 삭제(휴지통)가 없어 양 플랫폼 모두 실행취소/스낵바를
    /// 제공하지 않는다. 서버 + AlarmKit + 음원 캐시가 즉시·비가역 삭제된다.
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
