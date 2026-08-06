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
    @EnvironmentObject private var socialFeatures: SocialFeatureViewModel
    @State private var actionMessage: String?
    /// "누구를 깨울까요?" 시트 노출 여부. 구성원이 있을 때만 뜬다.
    @State private var wakeTargetSheetOpen = false

    let openEditor: (AlarmEditorTarget) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            // 안드로이드 첫 탭과 같은 모양 — '알람' 라벨 대신 **상태 문구를 헤드라인으로**
            // 승격한다(제목 = 결론). 절대 시각은 바로 아래 카드에 이미 있다.
            // 만들기 액션은 **＋FAB 하나**다(MainTabsView). 헤드라인 옆에 버튼을 또 두면
            // 같은 일을 하는 진입점이 둘이 되고, 헤드라인('다음 알람까지 …')이 눌릴 자리를
            // 뺏겨 짧게 잘린다. 안드로이드도 FAB 하나뿐이다(`AlarmTalkApp.kt:862`).
            NextAlarmHeadline(
                nextAlarm: nextAlarmForHeadline,
                hasAnyAlarm: !store.alarms.isEmpty,
                alarmPermissionMissing: !alarmKit.alarmAuthorized
            )

            // 권한 안내는 **이미 알람이 있을 때만** 한 줄 배너로. 알람이 하나도 없는
            // 새 사용자에게는 빈 상태 카드가 할 말이 따로 있고, 그 위에 경고를 겹치면
            // 첫 화면이 경고문부터 시작한다(안드로이드 `AlarmListScreen.kt:268-287`).
            if !alarmKit.alarmAuthorized && !store.alarms.isEmpty {
                alarmPermissionBanner
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
        .sheet(isPresented: $wakeTargetSheetOpen) {
            WakeTargetSheet(
                recipients: familyRecipients,
                onSelectSelf: {
                    wakeTargetSheetOpen = false
                    openEditor(.create())
                },
                onSelectRecipient: { _ in
                    wakeTargetSheetOpen = false
                    openEditor(.createFamily())
                }
            )
            .presentationDetents([.height(260), .medium])
        }
    }

    /// 상대 알람을 보낼 수 있는 구성원(본인 제외 + 허용한 사람만).
    private var familyRecipients: [FamilyGroupMember] {
        let currentUserID = auth.session?.user.id
        let currentEmail = auth.session?.user.email
        return (socialFeatures.familyGroup?.members ?? []).filter { member in
            member.userId != currentUserID &&
                member.email != currentEmail &&
                member.allowFamilyAlarms == true
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
                        voiceName: voiceName(for: alarm),
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
    /// 권한 한 줄 배너 — 탭하면 모달을 거치지 않고 곧바로 권한 요청으로 간다.
    /// 안드로이드 `ControlsAndPermissions.kt:188-217` 의 슬림 배너.
    ///
    /// 문구는 **iOS 의 사실**을 말한다: AlarmKit 권한이 없으면 예약 자체가 안 되므로
    /// 정말로 울리지 않는다. (안드로이드는 권한 셋 중 무엇이 빠져도 울리기는 해서
    /// "울리지 않아요" 라고 쓰지 않는다 — 그쪽 문구를 그대로 베끼지 말 것.)
    private var alarmPermissionBanner: some View {
        Button {
            Task { await alarmKit.requestAuthorization() }
        } label: {
            HStack(alignment: .center, spacing: 8) {
                Image(systemName: "exclamationmark.circle")
                    .font(.system(size: 20))
                    .foregroundStyle(theme.palette.error)
                Text("알람 권한이 없어 알람이 예약되지 않아요.")
                    .font(theme.typography.bodyMedium)
                    .foregroundStyle(theme.palette.onSurface)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity)
            .background(
                theme.palette.surface,
                in: RoundedRectangle(cornerRadius: theme.shapes.extraSmall, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: theme.shapes.extraSmall, style: .continuous)
                    .stroke(theme.palette.outlineVariant, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    /// 알람 행 둘째 줄에 붙일 목소리 이름. 공유받은 목소리는 관계 라벨(엄마·할머니)이
    /// 있으면 그걸 우선한다 — 목록에서 "엄마 목소리" 로 읽히는 게 사람 이름보다 낫다.
    private func voiceName(for alarm: LocalAlarmRecord) -> String? {
        guard let id = alarm.voiceProfileId, !id.isEmpty else { return nil }
        guard let profile = remoteSync.voiceProfiles.first(where: { $0.id == id }) else { return nil }
        let relationship = profile.relationshipLabel?.trimmingCharacters(in: .whitespaces) ?? ""
        return relationship.isEmpty ? profile.name : relationship
    }

    /// 빈 상태 카드 — 안드로이드 `ui/home/HomeCards.kt:29-92`.
    ///
    /// 좌우 2단(제목+보조문 / ＋버튼)이고 **카드 전체가 눌린다**.
    /// ⚠ "아직 알람이 없어요." 같은 **상황 라벨은 두지 않는다**(HomeCards.kt:54-55 가 못
    /// 박은 규칙). 빈 화면인 걸 이미 보고 있는 사람에게 비었다고 말하는 대신, 다음에 할
    /// 일과 그걸 하면 뭐가 좋은지를 말한다.
    private var emptyAlarmCard: some View {
        Button {
            Task { await openCreateAlarm() }
        } label: {
            HStack(alignment: .center, spacing: 16) {
                VStack(alignment: .leading, spacing: 12) {
                    Text("첫 알람 만들기")
                        .font(.pretendard(.bold, size: 24))
                        .foregroundStyle(theme.palette.onSurface)
                    Text("듣고 싶은 목소리가 깨워줘요.")
                        .font(theme.typography.bodyMedium)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                Image(systemName: "plus")
                    .font(.system(size: 22, weight: .medium))
                    .foregroundStyle(theme.palette.onPrimary)
                    .frame(width: 40, height: 40)
                    .background(theme.palette.primary, in: Capsule())
            }
            .padding(20)
            .frame(maxWidth: .infinity)
            .background(
                theme.palette.surface,
                in: RoundedRectangle(cornerRadius: theme.shapes.large, style: .continuous)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel("첫 알람 만들기")
    }

    /// 헤드라인이 셀 '다음 알람' — 켜져 있는 것 중 가장 먼저 울릴 것.
    private var nextAlarmForHeadline: LocalAlarmRecord? {
        store.alarms.filter(\.enabled).min { $0.nextFireDate < $1.nextFireDate }
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
            // 굳은 거부에서는 프롬프트가 뜨지 않는다 — 그냥 return 하면 버튼이 무반응이다.
            if alarmKit.permissionRecoveryNeeded {
                actionMessage = AlarmKitViewModel.alarmRecoveryMessage
                openAppSettings()
                return
            }
            await alarmKit.requestAuthorization()
            alarmKit.refreshAuthorizationState()
            guard alarmKit.alarmAuthorized else {
                actionMessage = "알람 권한을 허용해야 알람을 만들 수 있어요. \(AlarmKitViewModel.alarmDeniedConsequence)"
                return
            }
            presentCreateEntry()
            return
        }
        presentCreateEntry()
    }

    /// 편집기로 바로 갈지, "누구를 깨울까요?" 를 먼저 물을지 정한다.
    /// **선택지가 하나면 묻지 않는다** — 탭을 한 번 더 받을 뿐 아무것도 결정하지 않는다.
    @MainActor
    private func presentCreateEntry() {
        if familyRecipients.isEmpty {
            openEditor(.create())
        } else {
            wakeTargetSheetOpen = true
        }
    }

    @MainActor
    private func setAlarm(_ alarm: LocalAlarmRecord, enabled: Bool) async {
        if enabled {
            // 권한이 먼저다. 켠 다음에 확인하면 schedule 실패 뒤에도 `enabled=true` 가
            // 남아 **켜진 척하는 행**이 된다 — `markFailed` 는 state 만 바꾸고 enabled 는
            // 건드리지 않는다. iOS 는 그 알람이 정말 울리지 않으므로 최악의 실패다.
            alarmKit.refreshAuthorizationState()
            if !alarmKit.alarmAuthorized {
                await alarmKit.requestAuthorization()
                alarmKit.refreshAuthorizationState()
                guard alarmKit.alarmAuthorized else {
                    actionMessage = alarmKit.permissionRecoveryNeeded
                        ? AlarmKitViewModel.alarmRecoveryMessage
                        : "알람 권한을 허용해야 알람을 켤 수 있어요. \(AlarmKitViewModel.alarmDeniedConsequence)"
                    return
                }
            }
            store.setEnabled(id: alarm.id, enabled: true)
            guard let updated = store.record(id: alarm.id) else { return }
            let scheduled = await alarmKit.schedule(record: updated, store: store)
            if !scheduled {
                // 사용자가 **방금 켜려다** 실패한 것이므로 켜기 전 상태로 되돌린다.
                // (이미 켜져 있던 알람의 권한이 나중에 회수된 경우와는 다르다 — 그쪽은
                // 자동으로 끄지 않는다. 권한을 되돌려도 꺼진 채라 더 위험하다.)
                store.setEnabled(id: updated.id, enabled: false)
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
