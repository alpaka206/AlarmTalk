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

    /// 다중 선택 삭제 — 길게 눌러 들어가고, 하나도 안 남으면 자동으로 빠져나온다.
    /// 안드로이드 `AlarmListScreen.kt:138-152`.
    @State private var selectedAlarmIDs: Set<String> = []

    /// ＋FAB 의 만들기 요청. 값이 바뀌면 `openCreateAlarm()` 을 탄다 —
    /// FAB 가 권한 확인과 「누구를 깨울까요?」 를 건너뛰지 않게 하는 통로다.
    var createRequest: UUID?
    let openEditor: (AlarmEditorTarget) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            pinnedHeader

            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    // 권한 안내는 **이미 알람이 있을 때만** 한 줄 배너로. 알람이 하나도 없는
                    // 새 사용자에게는 빈 상태 카드가 할 말이 따로 있고, 그 위에 경고를 겹치면
                    // 첫 화면이 경고문부터 시작한다(안드로이드 `AlarmListScreen`).
                    if !alarmKit.alarmAuthorized && !visibleAlarms.isEmpty {
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
                .padding(.horizontal, 20)
                .padding(.bottom, 24)
            }
        }
        .onChange(of: store.alarms.count) { _, _ in pruneSelection() }
        .onChange(of: createRequest) { _, new in
            guard new != nil else { return }
            Task { await openCreateAlarm() }
        }
        .preference(key: AlarmSelectionActiveKey.self, value: selectionMode)
        .sheet(isPresented: $wakeTargetSheetOpen) {
            WakeTargetSheet(
                recipients: familyRecipients,
                onSelectSelf: {
                    wakeTargetSheetOpen = false
                    openEditor(.create())
                },
                onSelectRecipient: { recipient in
                    wakeTargetSheetOpen = false
                    // ⚠ 인자를 버리지 말 것 — 버리면 편집기가 첫 번째 구성원으로 폴백한다.
                    openEditor(.createFamily(recipientUserID: recipient.userId))
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

    /// 목록 **밖에 고정**되는 헤더. 스크롤해도 '다음 알람까지' 가 남고, 무엇보다 목록을
    /// 내린 상태에서 선택 모드에 들어가도 [취소·삭제]에 닿을 수 있다.
    ///
    /// ⚠ **다시 `ScrollView` 안으로 넣지 말 것.** 넣으면 길게 눌러 선택 모드에 들어간
    /// 순간 삭제 바가 화면 위에 있어 스크롤을 되올려야 취소할 수 있다.
    ///
    /// 최소 높이를 두는 이유: 헤드라인과 선택 바의 높이가 달라, 고정하지 않으면 선택
    /// 모드에 드나들 때마다 목록 전체가 위아래로 튄다(안드로이드도 `heightIn(min = 48.dp)`).
    @ViewBuilder
    private var pinnedHeader: some View {
        Group {
            // 안드로이드 첫 탭과 같은 모양 — '알람' 라벨 대신 **상태 문구를 헤드라인으로**
            // 승격한다(제목 = 결론). 절대 시각은 바로 아래 카드에 이미 있다.
            // 선택 모드에선 **같은 자리를** [취소·삭제] 바가 대신한다. 상단 바를 새로
            // 다는 대신 헤드라인을 바꿔 끼운다 — 이 앱엔 상단 바가 하나도 없다.
            if selectionMode {
                AlarmSelectionBar(
                    count: selectedAlarmIDs.count,
                    onCancel: { selectedAlarmIDs = [] },
                    onDelete: {
                        let targets = visibleAlarms.filter { selectedAlarmIDs.contains($0.id) }
                        selectedAlarmIDs = []
                        Task { for alarm in targets { await deleteAlarm(alarm) } }
                    }
                )
            } else {
                // 만들기 액션은 **＋FAB 하나**다(MainTabsView). 헤드라인 옆에 버튼을 또 두면
                // 같은 일을 하는 진입점이 둘이 되고, 헤드라인('다음 알람까지 …')이 눌릴 자리를
                // 뺏겨 짧게 잘린다. 안드로이드도 FAB 하나뿐이다.
                NextAlarmHeadline(
                    nextAlarm: nextAlarmForHeadline,
                    hasAnyAlarm: !visibleAlarms.isEmpty,
                    alarmPermissionMissing: !alarmKit.alarmAuthorized
                )
            }
        }
        .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
        .padding(.horizontal, 20)
        .padding(.top, 24)
        .padding(.bottom, 16)
    }

    @ViewBuilder
    private var localAlarmSection: some View {
        if visibleAlarms.isEmpty {
            emptyAlarmCard
        } else {
            // 각 알람을 독립 카드로 그리고 16pt 간격으로 쌓는다(Android LazyColumn
            // spacedBy 16 + 카드형 AlarmRow 미러). 바깥을 한 장의 카드로 묶지 않는다.
            VStack(alignment: .leading, spacing: 16) {
                ForEach(sortedAlarms) { alarm in
                    AlarmRow(
                        alarm: alarm,
                        voiceName: voiceName(for: alarm),
                        selectionMode: selectionMode,
                        selected: selectedAlarmIDs.contains(alarm.id),
                        onEnterSelection: { selectedAlarmIDs = [alarm.id] },
                        onToggleSelected: {
                            if selectedAlarmIDs.contains(alarm.id) {
                                selectedAlarmIDs.remove(alarm.id)
                            } else {
                                selectedAlarmIDs.insert(alarm.id)
                            }
                        },
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
    private var selectionMode: Bool { !selectedAlarmIDs.isEmpty }

    /// 목록에서 사라진 알람(삭제·동기화)은 선택에서도 뺀다 — 안 그러면 '3개 선택' 인데
    /// 실제로는 2개만 지워진다. 안드로이드 `AlarmListScreen.kt:143-146`.
    private func pruneSelection() {
        guard selectionMode else { return }
        let present = Set(visibleAlarms.map(\.id))
        let pruned = selectedAlarmIDs.intersection(present)
        if pruned != selectedAlarmIDs { selectedAlarmIDs = pruned }
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
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    /// 알람 행 둘째 줄에 붙일 목소리 이름. 공유받은 목소리는 관계 라벨(엄마·할머니)이
    /// 있으면 그걸 우선한다 — 목록에서 "엄마 목소리" 로 읽히는 게 사람 이름보다 낫다.
    private func voiceName(for alarm: LocalAlarmRecord) -> String? {
        guard let id = alarm.voiceProfileId, !id.isEmpty else { return nil }
        // ⚠ **잠긴 알람에는 목소리 이름을 보여주지 않는다.** 무료 강등은 재생 방식만
        // 알람음으로 바꾸고 `voiceProfileId` 는 남기므로, 이 게이트가 없으면 행에
        // 목소리 이름이 그대로 보이는데 실제로는 알람음이 울린다 — 왜 목소리가 안
        // 나오는지 알 방법이 없다. 대신 행 아래 안내(`AlarmRow.rowNotice`)가 이유를 말한다.
        guard alarm.preLockPlayMode == nil else { return nil }

        func label(_ name: String, _ relationship: String?) -> String {
            let trimmed = relationship?.trimmingCharacters(in: .whitespaces) ?? ""
            return trimmed.isEmpty ? name : trimmed
        }
        if let profile = remoteSync.voiceProfiles.first(where: { $0.id == id }) {
            return label(profile.name, profile.relationshipLabel)
        }
        // ⚠ **공유받은 목소리 폴백.** `GET /voice-profile` 은 내 것과 시스템 것만 주므로,
        // 가족이 공유한 목소리로 만든 알람은 위에서 못 찾고 이름이 통째로 사라졌다.
        // 그 목록은 `familyVoices` 에 따로 온다.
        if let shared = socialFeatures.familyVoices.first(where: { $0.id == id }) {
            return label(shared.name, shared.relationshipLabel)
        }
        return nil
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
            // ⚠ **테두리를 빼지 말 것**(2026-08-17 지적). 이 카드만 테두리가 없어서,
            // 다크에서 배경과 표면의 대비가 1.0:1 인 구간에 놓이면 **카드가 통째로
            // 사라져 보인다.** 알람 행과 같은 선이다.
            .overlay(
                RoundedRectangle(cornerRadius: theme.shapes.large, style: .continuous)
                    .stroke(theme.palette.cardBorder, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel("첫 알람 만들기")
    }

    /// 헤드라인이 셀 '다음 알람' — 켜져 있는 것 중 가장 먼저 울릴 것.
    private var nextAlarmForHeadline: LocalAlarmRecord? {
        visibleAlarms.filter(\.enabled).min { $0.nextFireDate < $1.nextFireDate }
    }

    /// ⚠ **화면은 `store.alarms` 를 직접 보지 않는다.** 이 계정 것만 거른 목록을 쓴다
    /// (안드로이드 `AlarmDao` 의 소유자 조건과 같다) — 로그아웃 뒤 다른 계정으로 들어오면
    /// 앞 계정 알람이 그대로 보이던 자리다(2026-08-19).
    private var visibleAlarms: [LocalAlarmRecord] {
        store.alarms(visibleTo: auth.session?.user.id)
    }

    private var sortedAlarms: [LocalAlarmRecord] {
        visibleAlarms.sorted { lhs, rhs in
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
            if let synced = store.record(id: updated.id), shouldPushToServer(synced) {
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
            if let updated = store.record(id: alarm.id), shouldPushToServer(updated) {
                await remoteSync.push(record: updated, store: store, session: auth.session)
            }
            actionMessage = nil
        }
    }

    /// 이 행의 변경을 서버에 올려도 되는가.
    ///
    /// ⚠ **`remoteAlarmId != nil` 만 보면 안 된다.** 받은 알람도 그 값을 갖는다(보낸 사람이
    /// 만든 서버 행의 id). 그걸 push 하면 `PATCH /alarm/:id` 가 소유권 게이트
    /// (`alarm-mutation.ts` 의 `WHERE a.id = ? AND a.user_id IN (...)`)에 걸려 **404** 로
    /// 떨어지고, 수신자에게는 "알람 변경사항을 저장하지 못했어요" 만 뜬다 — 로컬 저장은
    /// 멀쩡히 됐는데 실패한 것처럼 보인다(2026-08-18 실기기에서 반복 확인).
    ///
    /// 받은 알람은 **받은 뒤로 수신자 것이고 서버에 올릴 사본이 없다**
    /// (docs/spec/family-alarm.md). 껐다 켜는 것도 로컬·AlarmKit 에서 끝난다.
    /// 일괄 push 는 이미 같은 기준으로 거른다(`RemoteAlarmPushSync` 의
    /// `originEnum == .localOwned`) — 여기만 빠져 있었다.
    private func shouldPushToServer(_ record: LocalAlarmRecord) -> Bool {
        record.originEnum == .localOwned && record.remoteAlarmId != nil
    }

    /// 알람 삭제 실행. 스와이프 삭제 버튼 또는 길게 누르기 메뉴에서 곧바로 호출된다
    /// (Android 즉시 삭제 미러 — 별도 확인 다이얼로그 없음, 스와이프 제스처가 안전장치).
    ///
    /// 의도적 누락: 서버에 소프트 삭제(휴지통)가 없어 양 플랫폼 모두 실행취소/스낵바를
    /// 제공하지 않는다. 서버 + AlarmKit + 음원 캐시가 즉시·비가역 삭제된다.
    ///
    /// ⚠ **내 알람은 서버를 기다리지 않는다**(2026-08-18 낙관적 삭제). 로컬을 먼저 지우고
    /// 서버 삭제는 뒤에서 돈다 — 예전에는 서버 왕복(+성공 시 전체 pull)을 다 기다린 뒤에야
    /// 행이 사라져서, 스와이프가 제자리로 돌아오고 아무 일도 안 일어난 것처럼 보였다.
    /// 실패해도 **되살아나지 않는다**: pull 은 `target_user_id` 가 있는 행만 가져오므로
    /// 서버에 고아 행이 남을 뿐 사용자에게는 보이지 않는다.
    ///
    /// ⚠ **받은 알람은 반대다 — 서버 기록이 먼저다.** 로컬 스토어에 툼스톤이 없어서,
    /// decline 이 기록되지 않은 채 지우면 **다음 pull 이 그대로 되살린다.**
    /// "조금 늦게 사라짐" 보다 "지웠는데 다시 생김" 이 훨씬 나쁘다. 안드로이드
    /// `MainViewModelAlarmActions.deleteAlarm` 이 같은 이유로 같은 순서를 쓴다.
    /// 툼스톤이 생기면 이 갈래도 위와 합칠 수 있다.
    @MainActor
    private func deleteAlarm(_ alarm: LocalAlarmRecord) async {
        if alarm.originEnum == .receivedRemote {
            guard await remoteSync.deleteRemote(record: alarm, session: auth.session) else {
                actionMessage = remoteSync.statusMessage ?? "알람 삭제에 실패했어요."
                return
            }
        }
        let deleted = await alarmKit.cancel(record: alarm, store: store)
        guard deleted else {
            actionMessage = alarmKit.statusMessage ?? "알람 삭제에 실패했어요."
            return
        }
        if alarm.originEnum != .receivedRemote {
            // 내 알람의 서버 삭제는 뒤에서. 화면은 이미 사라졌다.
            // ⚠ **실패를 알리지 않는다**(`announceFailure: false`). 사용자가 원한 결과(목록에서
            // 사라짐)는 이미 이뤄졌고, 서버에 고아 행이 남아도 pull 이 되살리지 못해 보이지
            // 않는다. 여기서 배너를 띄우면 **지워진 알람 옆에 "삭제에 실패했어요"** 가 뜬다.
            Task {
                await remoteSync.deleteRemote(
                    record: alarm,
                    session: auth.session,
                    announceFailure: false
                )
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
