import SwiftUI

/// 알람 탭 본화면. 권한 카드 → 로컬 알람 리스트 → 서버 동기화 카드 순으로 쌓는다.
///
/// ContentView 의 `alarmsScreen` / `localAlarmSection` / `serverSection` 합본.
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
                    Label("추가", systemImage: "plus")
                }
                .buttonStyle(.borderedProminent)
                .tint(VoiceAlarmTheme.primary)
                .foregroundStyle(VoiceAlarmTheme.text)
            }

            AlarmPermissionSection()
            localAlarmSection
            serverSection
        }
    }

    private var localAlarmSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            if store.alarms.isEmpty {
                EmptyStatePlaceholder(
                    title: "아직 예약한 알람이 없어요.",
                    subtitle: "새 알람을 만들면 iOS 로컬 저장소와 AlarmKit에 예약됩니다.",
                    icon: "alarm"
                )
                Button {
                    openEditor(.create())
                } label: {
                    Label("알람 만들기", systemImage: "plus")
                }
                .buttonStyle(.borderedProminent)
                .tint(VoiceAlarmTheme.primary)
                .foregroundStyle(VoiceAlarmTheme.text)
            } else {
                ForEach(store.alarms.sorted { $0.nextFireDate < $1.nextFireDate }) { alarm in
                    AlarmRow(
                        alarm: alarm,
                        onTap: { openEditor(.edit(alarm.id)) },
                        onEdit: { openEditor(.edit(alarm.id)) },
                        onPushRemote: {
                            Task { await remoteSync.push(record: alarm, store: store, session: auth.session) }
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

    private var serverSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("서버 동기화")
                    .font(.headline)
                Spacer()
                Button("새로고침") {
                    Task { await remoteSync.refresh(session: auth.session) }
                }
                .disabled(remoteSync.isBusy)
            }

            if let message = remoteSync.statusMessage {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
            }

            Text("서버 알람 \(remoteSync.remoteAlarms.count)개, 사용 가능 목소리 \(remoteSync.voiceProfiles.count)개")
                .font(.subheadline)
                .foregroundStyle(VoiceAlarmTheme.textSecondary)

            ForEach(remoteSync.remoteAlarms.prefix(5)) { alarm in
                Text("\(alarm.time ?? "--:--") \(alarm.wakeMode ?? "sound_then_voice")")
                    .font(.caption)
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
            }
        }
        .sectionSurface()
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
