import Foundation
import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var store: LocalAlarmStore
    @EnvironmentObject private var alarmKit: AlarmKitViewModel
    @EnvironmentObject private var remoteSync: RemoteAlarmSyncViewModel
    @EnvironmentObject private var voiceStudio: VoiceStudioViewModel
    @EnvironmentObject private var socialFeatures: SocialFeatureViewModel

    @State private var selectedTab: NativeTab = .home
    @State private var editorPresented = false
    @State private var settingsPresented = false
    @State private var auxiliaryScreen: AuxiliaryScreen?
    @State private var editingAlarmID: UUID?
    @State private var nicknameDraft = ""

    @State private var label = "아침 알람"
    @State private var wakeDate = Date().addingTimeInterval(5 * 60)
    @State private var repeatWeekdays: Set<Int> = []
    @State private var snoozeMinutes = 5
    @State private var playMode: AlarmPlayMode = .alarmOnly

    private let weekdays: [(value: Int, label: String)] = [
        (2, "월"), (3, "화"), (4, "수"), (5, "목"), (6, "금"), (7, "토"), (1, "일"),
    ]

    private var nextAlarm: LocalAlarmRecord? {
        store.alarms
            .filter(\.enabled)
            .sorted { $0.nextFireDate < $1.nextFireDate }
            .first
    }

    var body: some View {
        if auth.isAuthenticated {
            mainApp
        } else {
            AuthGateView()
        }
    }

    private var mainApp: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        currentTabContent
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 20)
                    .padding(.bottom, 24)
                }
                .background(VoiceAlarmTheme.background)

                bottomBar
            }
            .background(VoiceAlarmTheme.background)
            .navigationTitle(selectedTab.navigationTitle)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        nicknameDraft = auth.session?.user.name ?? ""
                        settingsPresented = true
                    } label: {
                        Image(systemName: "person.crop.circle")
                    }
                    .accessibilityLabel("프로필")
                }
            }
            .sheet(isPresented: $editorPresented) {
                NavigationStack {
                    editorSheet
                }
            }
            .sheet(isPresented: $settingsPresented) {
                NavigationStack {
                    settingsSheet
                }
            }
            .sheet(item: $auxiliaryScreen) { screen in
                NavigationStack {
                    auxiliarySheet(screen)
                }
            }
            .task(id: auth.session?.token) {
                await refreshAll()
            }
        }
    }

    @ViewBuilder
    private var currentTabContent: some View {
        switch selectedTab {
        case .home:
            homeScreen
        case .voices:
            voicesScreen
        case .alarms:
            alarmsScreen
        case .messages:
            messagesScreen
        }
    }

    private var homeScreen: some View {
        VStack(alignment: .leading, spacing: 16) {
            homeHeader
            nextAlarmHeroCard
            quickStartGrid
            characterMiniCard
        }
    }

    private var voicesScreen: some View {
        VStack(alignment: .leading, spacing: 16) {
            screenHeader(title: "음성")
            voiceSection
        }
    }

    private var alarmsScreen: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .center) {
                screenHeader(title: "알람")
                Spacer()
                Button {
                    openEditor()
                } label: {
                    Label("추가", systemImage: "plus")
                }
                .buttonStyle(.borderedProminent)
                .tint(VoiceAlarmTheme.primary)
                .foregroundStyle(VoiceAlarmTheme.text)
            }

            alarmPermissionSection
            localAlarmSection
            serverSection
        }
    }

    private var messagesScreen: some View {
        VStack(alignment: .leading, spacing: 16) {
            screenHeader(title: "메시지")
            voiceMessagePanel
            ttsMessageArchivePanel
        }
    }

    private var voiceMessagePanel: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("가족 메시지")
                    .font(.headline)
                Spacer()
                Button("새로고침") {
                    Task { await socialFeatures.refreshAll(session: auth.session) }
                }
                .disabled(socialFeatures.isBusy)
            }

            if let message = socialFeatures.statusMessage {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
            }

            if socialFeatures.selectableMembers.isEmpty {
                emptyState(
                    title: "아직 연결된 가족 그룹이 없어요.",
                    subtitle: "초대 코드를 등록하거나 가족 이용권 공유 코드를 만든 뒤 메시지를 보낼 수 있어요.",
                    icon: "person.2"
                )
                codeRegisterRow
            } else {
                Picker("받는 사람", selection: $socialFeatures.selectedReceiverID) {
                    Text("선택 안 함").tag(String?.none)
                    ForEach(socialFeatures.selectableMembers) { member in
                        Text(member.name ?? member.email ?? member.userId).tag(Optional(member.userId))
                    }
                }

                TextField("메시지", text: $socialFeatures.noteText, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(2...5)

                Button {
                    Task { await socialFeatures.sendNote(session: auth.session) }
                } label: {
                    Label("메시지 보내기", systemImage: "paperplane")
                }
                .buttonStyle(.borderedProminent)
                .tint(VoiceAlarmTheme.primary)
                .foregroundStyle(VoiceAlarmTheme.text)
                .disabled(socialFeatures.isBusy)
            }

            if socialFeatures.receivedNotes.isEmpty {
                Text("받은 메시지가 없어요.")
                    .font(.footnote)
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
            } else {
                ForEach(socialFeatures.receivedNotes.prefix(8)) { note in
                    receivedNoteRow(note)
                }
            }
        }
        .sectionSurface()
    }

    private var ttsMessageArchivePanel: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("음성 메시지 보관함")
                    .font(.headline)
                Spacer()
                Button("새로고침") {
                    Task { await voiceStudio.refresh(session: auth.session) }
                }
                .disabled(voiceStudio.isBusy)
            }

            if voiceStudio.messages.isEmpty {
                emptyState(
                    title: "아직 생성한 음성 메시지가 없어요.",
                    subtitle: "음성 탭에서 깨워줄 말을 생성하면 여기에서 다시 확인할 수 있어요.",
                    icon: "message"
                )
            } else {
                ForEach(voiceStudio.messages.prefix(8)) { message in
                    messageRow(message)
                }
            }

            Button {
                selectedTab = .voices
            } label: {
                Label("음성 만들기", systemImage: "waveform")
            }
            .buttonStyle(.bordered)
        }
        .sectionSurface()
    }

    private var codeRegisterRow: some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField("초대 코드", text: $socialFeatures.inviteCode)
                .textFieldStyle(.roundedBorder)
                .textInputAutocapitalization(.characters)
            HStack {
                Button {
                    Task { await socialFeatures.registerCode(session: auth.session) }
                } label: {
                    Label("코드 등록", systemImage: "qrcode")
                }
                .buttonStyle(.borderedProminent)
                .tint(VoiceAlarmTheme.primary)
                .foregroundStyle(VoiceAlarmTheme.text)

                Button {
                    Task { await socialFeatures.ensureFamilyShareCode(session: auth.session) }
                } label: {
                    Label("공유 코드", systemImage: "person.badge.plus")
                }
                .buttonStyle(.bordered)
            }
        }
    }

    private var bottomBar: some View {
        HStack(spacing: 6) {
            ForEach(NativeTab.allCases) { tab in
                Button {
                    selectedTab = tab
                } label: {
                    VStack(spacing: 3) {
                        ZStack(alignment: .topTrailing) {
                            Image(systemName: tab.systemImage)
                                .font(.system(size: 22, weight: .semibold))
                            if badgeCount(for: tab) > 0 {
                                Text(badgeCount(for: tab) > 99 ? "99+" : "\(badgeCount(for: tab))")
                                    .font(.system(size: 9, weight: .bold))
                                    .foregroundStyle(.white)
                                    .padding(.horizontal, 4)
                                    .padding(.vertical, 2)
                                    .background(VoiceAlarmTheme.error, in: Capsule())
                                    .offset(x: 12, y: -8)
                            }
                        }
                        Text(tab.title)
                            .font(.caption2.weight(selectedTab == tab ? .semibold : .medium))
                    }
                    .frame(maxWidth: .infinity, minHeight: 58)
                    .foregroundStyle(selectedTab == tab ? VoiceAlarmTheme.text : VoiceAlarmTheme.textSecondary)
                    .background(
                        selectedTab == tab ? VoiceAlarmTheme.surfaceVariant : Color.clear,
                        in: RoundedRectangle(cornerRadius: 14)
                    )
                }
                .buttonStyle(.plain)
                .disabled(selectedTab == tab)
            }
        }
        .padding(.horizontal, 6)
        .padding(.top, 6)
        .padding(.bottom, 10)
        .background(VoiceAlarmTheme.surface)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(VoiceAlarmTheme.surfaceVariant)
                .frame(height: 1)
        }
    }

    private var homeHeader: some View {
        let greeting = homeGreeting()
        return VStack(alignment: .leading, spacing: 2) {
            Text(greeting.top)
                .font(.title.weight(.bold))
                .foregroundStyle(VoiceAlarmTheme.text)
            Text(greeting.bottom)
                .font(.title.weight(.bold))
                .foregroundStyle(VoiceAlarmTheme.text)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var nextAlarmHeroCard: some View {
        Button {
            if let nextAlarm {
                openEditor(nextAlarm)
            } else {
                openEditor()
            }
        } label: {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(nextAlarm == nil ? "아직 알람이 없어요." : "다음 알람")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(VoiceAlarmTheme.textSecondary)
                    Text(nextAlarm?.timeString ?? "알람 예약")
                        .font(nextAlarm == nil ? .largeTitle.weight(.bold) : .system(size: 56, weight: .bold, design: .rounded))
                        .foregroundStyle(VoiceAlarmTheme.text)
                        .lineLimit(1)
                        .minimumScaleFactor(0.72)
                }

                waveform(active: nextAlarm != nil)

                HStack(alignment: .center) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(nextAlarm?.label ?? "좋아하는 목소리로 알람 예약")
                            .font(.headline)
                            .foregroundStyle(VoiceAlarmTheme.text)
                            .lineLimit(1)
                        Text(nextAlarm == nil ? "바로 시작해봐요." : "수정하기")
                            .font(.subheadline)
                            .foregroundStyle(VoiceAlarmTheme.textSecondary)
                    }
                    Spacer()
                    Image(systemName: "arrow.right")
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(VoiceAlarmTheme.primaryDark)
                }
            }
            .sectionSurface()
        }
        .buttonStyle(.plain)
    }

    private var quickStartGrid: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("바로 가기")
                .font(.headline)
                .foregroundStyle(VoiceAlarmTheme.text)
            HStack(spacing: 12) {
                quickActionCard(
                    title: "알람 음성",
                    icon: "mic",
                    background: Color(red: 0.86, green: 0.91, blue: 0.96)
                ) {
                    selectedTab = .voices
                }
                quickActionCard(
                    title: "새 알람",
                    icon: "alarm",
                    background: Color(red: 0.98, green: 0.89, blue: 0.58)
                ) {
                    openEditor()
                }
            }
            quickActionCard(
                title: "함께",
                icon: "person.2",
                background: Color(red: 0.92, green: 0.88, blue: 0.96)
            ) {
                auxiliaryScreen = .people
            }
        }
    }

    private var characterMiniCard: some View {
        Button {
            auxiliaryScreen = .growth
        } label: {
            HStack(spacing: 14) {
                let character = socialFeatures.character?.character
                let progress = socialFeatures.character?.progress.progressRatio ?? 0
                let streak = socialFeatures.character?.streak.current ?? 0
                ZStack {
                    Circle()
                        .fill(Color(red: 0.88, green: 0.94, blue: 0.82))
                    Text(characterStageLabel(character?.stage))
                        .font(.caption.weight(.bold))
                        .foregroundStyle(VoiceAlarmTheme.text)
                }
                .frame(width: 52, height: 52)

                VStack(alignment: .leading, spacing: 7) {
                    HStack {
                        Text("LV.\(character?.level ?? 1)")
                            .font(.headline)
                            .foregroundStyle(VoiceAlarmTheme.text)
                        Spacer()
                        Text("연속 \(streak)일")
                            .font(.caption)
                            .foregroundStyle(VoiceAlarmTheme.textSecondary)
                    }
                    ProgressView(value: progress)
                        .tint(VoiceAlarmTheme.accent)
                }
                Image(systemName: "arrow.right")
                    .foregroundStyle(VoiceAlarmTheme.accent)
            }
            .sectionSurface()
        }
        .buttonStyle(.plain)
    }

    private var alarmPermissionSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("알람 권한")
                    .font(.headline)
                Spacer()
                permissionPill(alarmKit.authorizationLabel)
            }
            if let message = alarmKit.statusMessage {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
            }
            Button {
                Task { await alarmKit.requestAuthorization() }
            } label: {
                Label("AlarmKit 권한 허용", systemImage: "alarm.fill")
            }
            .buttonStyle(.borderedProminent)
            .tint(VoiceAlarmTheme.primary)
            .foregroundStyle(VoiceAlarmTheme.text)
        }
        .sectionSurface()
    }

    private var voiceSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("목소리")
                    .font(.headline)
                Spacer()
                Button("새로고침") {
                    Task { await voiceStudio.refresh(session: auth.session) }
                }
                .disabled(voiceStudio.isBusy)
            }

            if let message = voiceStudio.statusMessage {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
            }

            if voiceStudio.profiles.isEmpty {
                emptyState(
                    title: "아직 사용할 수 있는 목소리가 없어요.",
                    subtitle: "60초 이상 녹음한 뒤 학습을 등록해 주세요.",
                    icon: "mic.slash"
                )
            } else {
                Picker("사용할 목소리", selection: $voiceStudio.selectedProfileID) {
                    Text("선택 안 함").tag(String?.none)
                    ForEach(voiceStudio.profiles) { profile in
                        Text("\(profile.name) \(profile.status ?? "")").tag(Optional(profile.id))
                    }
                }
            }

            recordingPanel
            ttsPanel

            ForEach(voiceStudio.profiles.prefix(5)) { profile in
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(profile.name)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(VoiceAlarmTheme.text)
                        Text(profile.status ?? "unknown")
                            .font(.caption)
                            .foregroundStyle(VoiceAlarmTheme.textSecondary)
                    }
                    Spacer()
                    Button(role: .destructive) {
                        Task { await voiceStudio.deleteProfile(profile, session: auth.session) }
                    } label: {
                        Image(systemName: "trash")
                    }
                    .disabled(voiceStudio.isBusy)
                }
                .padding(12)
                .background(VoiceAlarmTheme.surfaceVariant)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
        }
        .sectionSurface()
    }

    private var recordingPanel: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("목소리 학습")
                .font(.subheadline.weight(.semibold))
            TextField("목소리 이름", text: $voiceStudio.cloneName)
                .textFieldStyle(.roundedBorder)
            Text("녹음 \(voiceStudio.recorder.isRecording ? Int(voiceStudio.recorder.elapsedSeconds) : Int((voiceStudio.recorder.latestDurationMs ?? 0) / 1000))초")
                .font(.caption)
                .foregroundStyle(VoiceAlarmTheme.textSecondary)
            HStack {
                Button {
                    if voiceStudio.recorder.isRecording {
                        voiceStudio.stopRecording()
                    } else {
                        Task { await voiceStudio.startRecording() }
                    }
                } label: {
                    Label(voiceStudio.recorder.isRecording ? "정지" : "녹음", systemImage: voiceStudio.recorder.isRecording ? "stop.fill" : "mic.fill")
                }
                .buttonStyle(.bordered)

                Button {
                    voiceStudio.playRecording()
                } label: {
                    Label("녹음 듣기", systemImage: "play.fill")
                }
                .buttonStyle(.bordered)
                .disabled(voiceStudio.recorder.latestRecordingURL == nil)

                Button {
                    Task { await voiceStudio.uploadRecordingForClone(session: auth.session) }
                } label: {
                    Label("학습 등록", systemImage: "icloud.and.arrow.up")
                }
                .buttonStyle(.borderedProminent)
                .tint(VoiceAlarmTheme.primary)
                .foregroundStyle(VoiceAlarmTheme.text)
                .disabled(!voiceStudio.canUploadRecording || voiceStudio.isBusy)
            }
            Text("서버 음성 학습은 60초 이상 120초 이하 파일만 받습니다.")
                .font(.caption)
                .foregroundStyle(VoiceAlarmTheme.textSecondary)
        }
        .padding(12)
        .background(VoiceAlarmTheme.surfaceVariant)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private var ttsPanel: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("깨워줄 말")
                .font(.subheadline.weight(.semibold))
            TextField("예: 좋은 아침이에요. 일어나세요.", text: $voiceStudio.ttsText, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(2...4)

            HStack {
                Picker("언어", selection: $voiceStudio.ttsLanguage) {
                    Text("한국어").tag("ko")
                    Text("English").tag("en")
                    Text("日本語").tag("ja")
                }
                Picker("테마", selection: $voiceStudio.ttsCategory) {
                    Text("아침").tag("morning")
                    Text("응원").tag("cheer")
                    Text("커스텀").tag("custom")
                }
            }

            Toggle("입력 문장을 선택 언어로 번역", isOn: $voiceStudio.translateText)
            Toggle("랜덤 문장 생성", isOn: $voiceStudio.randomPrompt)

            HStack {
                Button {
                    Task { _ = await voiceStudio.generateTTS(session: auth.session) }
                } label: {
                    Label("음성 생성", systemImage: "sparkles")
                }
                .buttonStyle(.borderedProminent)
                .tint(VoiceAlarmTheme.primary)
                .foregroundStyle(VoiceAlarmTheme.text)
                .disabled(voiceStudio.isBusy)

                Button {
                    voiceStudio.playPreparedAudio()
                } label: {
                    Label("미리듣기", systemImage: voiceStudio.previewPlayer.isPlaying ? "pause.fill" : "play.fill")
                }
                .buttonStyle(.bordered)
                .disabled(voiceStudio.preparedAlarm == nil)
            }
        }
        .padding(12)
        .background(VoiceAlarmTheme.surfaceVariant)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private var localAlarmSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            if store.alarms.isEmpty {
                emptyState(
                    title: "아직 예약한 알람이 없어요.",
                    subtitle: "새 알람을 만들면 iOS 로컬 저장소와 AlarmKit에 예약됩니다.",
                    icon: "alarm"
                )
                Button {
                    openEditor()
                } label: {
                    Label("알람 만들기", systemImage: "plus")
                }
                .buttonStyle(.borderedProminent)
                .tint(VoiceAlarmTheme.primary)
                .foregroundStyle(VoiceAlarmTheme.text)
            } else {
                ForEach(store.alarms.sorted { $0.nextFireDate < $1.nextFireDate }) { alarm in
                    alarmRow(alarm)
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

    private func auxiliarySheet(_ screen: AuxiliaryScreen) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                screenHeader(title: screen.title)
                switch screen {
                case .people:
                    peoplePanel
                case .growth:
                    growthPanel
                case .billing:
                    billingPanel
                }
            }
            .padding(20)
        }
        .background(VoiceAlarmTheme.background)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("닫기") {
                    auxiliaryScreen = nil
                }
            }
        }
    }

    private var peoplePanel: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let group = socialFeatures.familyGroup?.group {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("가족 그룹")
                            .font(.headline)
                        Text("멤버 \(socialFeatures.familyGroup?.members.count ?? 0)/\(group.maxMembers)")
                            .font(.footnote)
                            .foregroundStyle(VoiceAlarmTheme.textSecondary)
                    }
                    Spacer()
                    permissionPill(socialFeatures.familyGroup?.role ?? "member")
                }

                ForEach(socialFeatures.familyGroup?.members ?? []) { member in
                    HStack {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(member.name ?? member.email ?? member.userId)
                                .font(.subheadline.weight(.semibold))
                            Text(member.allowFamilyAlarms == true ? "상대방 알람 허용" : "상대방 알람 꺼짐")
                                .font(.caption)
                                .foregroundStyle(VoiceAlarmTheme.textSecondary)
                        }
                        Spacer()
                        Text(member.role)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(VoiceAlarmTheme.textSecondary)
                    }
                    .padding(12)
                    .background(VoiceAlarmTheme.surfaceVariant)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
            } else {
                emptyState(
                    title: "가족 그룹이 없어요.",
                    subtitle: "공유 코드를 등록하거나 가족 이용권 공유 코드를 만든 뒤 함께 쓰는 알람을 사용할 수 있어요.",
                    icon: "person.2"
                )
            }

            codeRegisterRow

            if socialFeatures.vouchers.isEmpty {
                Text("발급된 공유 코드가 없어요.")
                    .font(.footnote)
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
            } else {
                ForEach(socialFeatures.vouchers.prefix(4)) { voucher in
                    voucherRow(voucher)
                }
            }
        }
        .sectionSurface()
    }

    private var growthPanel: some View {
        VStack(alignment: .leading, spacing: 12) {
            let character = socialFeatures.character?.character
            let progress = socialFeatures.character?.progress
            let streak = socialFeatures.character?.streak
            HStack(spacing: 14) {
                ZStack {
                    Circle()
                        .fill(Color(red: 0.88, green: 0.94, blue: 0.82))
                    Text(characterStageLabel(character?.stage))
                        .font(.headline.weight(.bold))
                        .foregroundStyle(VoiceAlarmTheme.text)
                }
                .frame(width: 58, height: 58)

                VStack(alignment: .leading, spacing: 6) {
                    Text(character?.name ?? "Naro")
                        .font(.headline)
                    Text("LV.\(character?.level ?? 1) · 애정 \(character?.affection ?? 0)")
                        .font(.subheadline)
                        .foregroundStyle(VoiceAlarmTheme.textSecondary)
                    ProgressView(value: progress?.progressRatio ?? 0)
                        .tint(VoiceAlarmTheme.accent)
                }
            }

            HStack(spacing: 10) {
                metricTile(title: "연속", value: "\(streak?.current ?? 0)일")
                metricTile(title: "최장", value: "\(streak?.longest ?? 0)일")
                metricTile(title: "오늘 XP", value: "\(character?.dailyXp ?? 0)")
            }

            if let stats = socialFeatures.character?.stats {
                HStack(spacing: 10) {
                    metricTile(title: "성실", value: "\(stats.diligence)")
                    metricTile(title: "건강", value: "\(stats.health)")
                    metricTile(title: "꾸준함", value: "\(stats.consistency)")
                }
            }

            Button {
                Task { await socialFeatures.grantWakeupXP(session: auth.session) }
            } label: {
                Label("기상 성공 반영", systemImage: "checkmark.circle")
            }
            .buttonStyle(.bordered)
            .disabled(socialFeatures.isBusy)
        }
        .sectionSurface()
    }

    private var billingPanel: some View {
        VStack(alignment: .leading, spacing: 12) {
            let subscription = socialFeatures.subscription?.subscription
            let plan = socialFeatures.subscription?.plan
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(plan?.name ?? "Free")
                        .font(.headline)
                    Text(subscription?.status ?? "free")
                        .font(.footnote)
                        .foregroundStyle(VoiceAlarmTheme.textSecondary)
                }
                Spacer()
                if let expiresAt = subscription?.expiresAt {
                    permissionPill("만료 \(expiresAt)")
                }
            }

            planCard(title: "Plus", price: "개인 음성 알람", planKey: "plus_monthly")
            planCard(title: "Family", price: "가족 공유 알람", planKey: "family_monthly")

            if subscription != nil {
                Button(role: .destructive) {
                    Task { await socialFeatures.cancelSubscription(session: auth.session) }
                } label: {
                    Label("구독 해지 예약", systemImage: "xmark.circle")
                }
                .buttonStyle(.bordered)
                .disabled(socialFeatures.isBusy)
            }

            if !socialFeatures.vouchers.isEmpty {
                Text("공유 코드")
                    .font(.subheadline.weight(.semibold))
                ForEach(socialFeatures.vouchers.prefix(5)) { voucher in
                    voucherRow(voucher)
                }
            }
        }
        .sectionSurface()
    }

    private var editorSheet: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text(editingAlarmID == nil ? "알람 만들기" : "알람 수정")
                    .font(.title2.weight(.bold))

                TextField("알람 이름", text: $label)
                    .textFieldStyle(.roundedBorder)

                DatePicker("시간", selection: $wakeDate, displayedComponents: .hourAndMinute)

                VStack(alignment: .leading, spacing: 8) {
                    Text("반복")
                        .font(.subheadline.weight(.semibold))
                    HStack {
                        ForEach(weekdays, id: \.value) { item in
                            Button(item.label) {
                                if repeatWeekdays.contains(item.value) {
                                    repeatWeekdays.remove(item.value)
                                } else {
                                    repeatWeekdays.insert(item.value)
                                }
                            }
                            .buttonStyle(.bordered)
                            .tint(repeatWeekdays.contains(item.value) ? VoiceAlarmTheme.primary : VoiceAlarmTheme.textSecondary)
                        }
                    }
                }

                Picker("재생 방식", selection: $playMode) {
                    ForEach(AlarmPlayMode.allCases) { mode in
                        Text(mode.label).tag(mode)
                    }
                }
                .pickerStyle(.segmented)

                if playMode != .alarmOnly {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("선택한 음성")
                            .font(.subheadline.weight(.semibold))
                        Text(preparedVoiceLabel)
                            .font(.footnote)
                            .foregroundStyle(VoiceAlarmTheme.textSecondary)
                        Button {
                            selectedTab = .voices
                            editorPresented = false
                        } label: {
                            Label("음성 탭에서 만들기", systemImage: "waveform")
                        }
                        .buttonStyle(.bordered)
                    }
                    .padding(12)
                    .background(VoiceAlarmTheme.surfaceVariant)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }

                Stepper("다시 알림 \(snoozeMinutes)분", value: $snoozeMinutes, in: 1...30)

                VStack(spacing: 10) {
                    Button {
                        Task { await scheduleFromEditor() }
                    } label: {
                        Label("저장", systemImage: "calendar.badge.plus")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(VoiceAlarmTheme.primary)
                    .foregroundStyle(VoiceAlarmTheme.text)

                    if playMode != .alarmOnly {
                        Button {
                            Task { await generateVoiceAndSchedule() }
                        } label: {
                            Label("음성 생성 후 저장", systemImage: "sparkles")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                        .disabled(voiceStudio.isBusy)
                    }

                    Button {
                        Task { await scheduleOneMinuteTest() }
                    } label: {
                        Label("1분 테스트", systemImage: "timer")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                }
            }
            .padding(20)
        }
        .background(VoiceAlarmTheme.background)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("닫기") {
                    editorPresented = false
                }
            }
        }
    }

    private var settingsSheet: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                HStack {
                    Button {
                        settingsPresented = false
                    } label: {
                        Image(systemName: "chevron.left")
                    }
                    .buttonStyle(.plain)
                    Text("설정")
                        .font(.title2.weight(.bold))
                }

                VStack(alignment: .leading, spacing: 0) {
                    settingsRow(label: "화면 모드", value: "시스템")
                }
                .settingsCard(title: "화면")

                VStack(alignment: .leading, spacing: 0) {
                    settingsActionRow(label: "초대 코드 등록", icon: "qrcode") {
                        openAuxiliaryFromSettings(.people)
                    }
                    Divider()
                    settingsActionRow(label: "캐릭터", icon: "chart.line.uptrend.xyaxis") {
                        openAuxiliaryFromSettings(.growth)
                    }
                    Divider()
                    settingsActionRow(label: "이용권", icon: "creditcard") {
                        openAuxiliaryFromSettings(.billing)
                    }
                }
                .settingsCard(title: "프로필")

                alarmPermissionSection

                if let user = auth.session?.user {
                    VStack(alignment: .leading, spacing: 0) {
                        settingsActionRow(
                            label: user.allowFamilyAlarms == true ? "상대방 알람 허용" : "상대방 알람 꺼짐",
                            icon: user.allowFamilyAlarms == true ? "bell.badge" : "bell.slash"
                        ) {
                            Task {
                                await auth.updateProfile(allowFamilyAlarms: !(user.allowFamilyAlarms ?? false))
                                await socialFeatures.refreshAll(session: auth.session)
                            }
                        }
                        Divider()
                        settingsRow(label: "설정 불가 시간", value: quietScheduleLabel(user.familyAlarmQuietWindows))
                    }
                    .settingsCard(title: "공유 알람")

                    VStack(alignment: .leading, spacing: 0) {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("닉네임")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(VoiceAlarmTheme.textSecondary)
                            HStack {
                                TextField("닉네임", text: $nicknameDraft)
                                    .textFieldStyle(.roundedBorder)
                                Button("저장") {
                                    Task { await auth.updateProfile(name: nicknameDraft) }
                                }
                                .buttonStyle(.bordered)
                                .disabled(nicknameDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || auth.isBusy)
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 14)
                        Divider()
                        settingsRow(label: "계정", value: user.email)
                        Divider()
                        Button {
                            auth.signOut()
                            settingsPresented = false
                        } label: {
                            HStack {
                                Text("로그아웃")
                                    .fontWeight(.medium)
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
                            }
                            .padding(.horizontal, 16)
                            .padding(.vertical, 14)
                        }
                        .buttonStyle(.plain)
                    }
                    .settingsCard(title: "계정")

                    VStack(alignment: .leading, spacing: 0) {
                        Button(role: .destructive) {
                            Task {
                                await auth.deleteAccount()
                                settingsPresented = false
                            }
                        } label: {
                            HStack {
                                Text("회원 탈퇴")
                                    .fontWeight(.medium)
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
                            }
                            .padding(.horizontal, 16)
                            .padding(.vertical, 14)
                        }
                        .buttonStyle(.plain)
                    }
                    .settingsCard(title: nil)
                }
            }
            .padding(20)
        }
        .background(VoiceAlarmTheme.background)
        .onAppear {
            nicknameDraft = auth.session?.user.name ?? ""
        }
    }

    private func screenHeader(title: String, subtitle: String? = nil) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.largeTitle.weight(.bold))
                .foregroundStyle(VoiceAlarmTheme.text)
            if let subtitle, !subtitle.isEmpty {
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func quickActionCard(
        title: String,
        icon: String,
        background: Color,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                ZStack {
                    Circle()
                        .fill(background)
                    Image(systemName: icon)
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(VoiceAlarmTheme.text)
                }
                .frame(width: 42, height: 42)

                Text(title)
                    .font(.headline)
                    .foregroundStyle(VoiceAlarmTheme.text)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Spacer()
            }
            .padding(14)
            .frame(maxWidth: .infinity)
            .background(VoiceAlarmTheme.surface)
            .clipShape(RoundedRectangle(cornerRadius: 18))
            .overlay(
                RoundedRectangle(cornerRadius: 18)
                    .stroke(VoiceAlarmTheme.surfaceVariant, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    private func waveform(active: Bool) -> some View {
        let levels: [CGFloat] = [
            0.18, 0.24, 0.16, 0.34, 0.28, 0.52, 0.38, 0.70,
            0.42, 0.60, 0.32, 0.56, 0.24, 0.66, 0.46, 0.78,
            0.40, 0.62, 0.34, 0.58, 0.28, 0.54, 0.36, 0.64,
            0.44, 0.72, 0.30, 0.48, 0.22, 0.42, 0.18, 0.36,
        ]
        return HStack(alignment: .center, spacing: 4) {
            ForEach(Array(levels.enumerated()), id: \.offset) { _, level in
                RoundedRectangle(cornerRadius: 999)
                    .fill(VoiceAlarmTheme.primary.opacity(active ? 0.82 : 0.36))
                    .frame(width: 2, height: 8 + level * 34)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .center)
    }

    private func alarmRow(_ alarm: LocalAlarmRecord) -> some View {
        HStack(alignment: .center, spacing: 12) {
            Button {
                openEditor(alarm)
            } label: {
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(alarm.timeString) \(alarm.label)")
                        .font(.headline)
                        .foregroundStyle(VoiceAlarmTheme.text)
                    Text(alarmDetail(alarm))
                        .font(.caption)
                        .foregroundStyle(VoiceAlarmTheme.textSecondary)
                        .lineLimit(2)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)

            Menu {
                Button("수정") {
                    openEditor(alarm)
                }
                Button("서버에 저장") {
                    Task { await remoteSync.push(record: alarm, store: store, session: auth.session) }
                }
                Button("취소", role: .destructive) {
                    Task {
                        await remoteSync.deleteRemote(record: alarm, session: auth.session)
                        await alarmKit.cancel(record: alarm, store: store)
                    }
                }
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

    private func messageRow(_ message: TtsMessage) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(message.text)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(VoiceAlarmTheme.text)
                .lineLimit(2)
            Text([message.voiceName, message.category, message.createdAt].compactMap { $0 }.joined(separator: " · "))
                .font(.caption)
                .foregroundStyle(VoiceAlarmTheme.textSecondary)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(VoiceAlarmTheme.surfaceVariant)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func receivedNoteRow(_ note: ReceivedNote) -> some View {
        Button {
            Task { await socialFeatures.markRead(note, session: auth.session) }
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text(note.senderName ?? note.senderEmail ?? "보낸 사람")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(VoiceAlarmTheme.text)
                    Spacer()
                    if note.readAt == nil {
                        Text("새 메시지")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 3)
                            .background(VoiceAlarmTheme.error, in: Capsule())
                    }
                }
                Text(note.text)
                    .font(.footnote)
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
                    .lineLimit(3)
                if let createdAt = note.createdAt {
                    Text(createdAt)
                        .font(.caption2)
                        .foregroundStyle(VoiceAlarmTheme.textSecondary)
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(VoiceAlarmTheme.surfaceVariant)
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
    }

    private func voucherRow(_ voucher: VoucherItem) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(voucher.code)
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(VoiceAlarmTheme.text)
                Text("\(voucher.planName) · \(voucher.status) · \(voucher.useCount ?? 0)/\(voucher.maxUses ?? 1)")
                    .font(.caption)
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
            }
            Spacer()
            Image(systemName: "qrcode")
                .foregroundStyle(VoiceAlarmTheme.primaryDark)
        }
        .padding(12)
        .background(VoiceAlarmTheme.surfaceVariant)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func metricTile(title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption)
                .foregroundStyle(VoiceAlarmTheme.textSecondary)
            Text(value)
                .font(.headline)
                .foregroundStyle(VoiceAlarmTheme.text)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(VoiceAlarmTheme.surfaceVariant)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func planCard(title: String, price: String, planKey: String) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.headline)
                    .foregroundStyle(VoiceAlarmTheme.text)
                Text(price)
                    .font(.footnote)
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
            }
            Spacer()
            Button("선택") {
                Task { await socialFeatures.checkout(planKey: planKey, session: auth.session) }
            }
            .buttonStyle(.borderedProminent)
            .tint(VoiceAlarmTheme.primary)
            .foregroundStyle(VoiceAlarmTheme.text)
            .disabled(socialFeatures.isBusy)
        }
        .padding(12)
        .background(VoiceAlarmTheme.surfaceVariant)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func emptyState(title: String, subtitle: String, icon: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: icon)
                .font(.title2)
                .foregroundStyle(VoiceAlarmTheme.primaryDark)
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(VoiceAlarmTheme.text)
            Text(subtitle)
                .font(.footnote)
                .foregroundStyle(VoiceAlarmTheme.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(VoiceAlarmTheme.surfaceVariant)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func permissionPill(_ text: String) -> some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .foregroundStyle(VoiceAlarmTheme.text)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(VoiceAlarmTheme.surfaceVariant, in: Capsule())
    }

    private func settingsRow(label: String, value: String?) -> some View {
        HStack {
            Text(label)
                .fontWeight(.medium)
                .foregroundStyle(VoiceAlarmTheme.text)
            Spacer()
            if let value {
                Text(value)
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
                    .lineLimit(1)
            }
            Image(systemName: "chevron.right")
                .foregroundStyle(VoiceAlarmTheme.textSecondary)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
    }

    private func settingsActionRow(label: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                Image(systemName: icon)
                    .frame(width: 24)
                    .foregroundStyle(VoiceAlarmTheme.primaryDark)
                Text(label)
                    .fontWeight(.medium)
                    .foregroundStyle(VoiceAlarmTheme.text)
                Spacer()
                Image(systemName: "chevron.right")
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
        }
        .buttonStyle(.plain)
    }

    private func homeGreeting() -> (top: String, bottom: String) {
        let hour = Calendar.current.component(.hour, from: Date())
        switch hour {
        case ..<6:
            return ("좋아하는 목소리로", "깨워드릴게요")
        case ..<12:
            return ("오늘 아침,", "어떤 목소리로 깨어났나요?")
        case ..<17:
            return ("내일의 목소리 알람을", "준비해요")
        case ..<21:
            return ("서로의 목소리로", "아침을 예약해요")
        default:
            return ("좋아하는 목소리로", "깨워드릴게요")
        }
    }

    private func characterStageLabel(_ stage: String?) -> String {
        switch stage {
        case "sprout": return "SP"
        case "flower": return "FL"
        case "tree": return "TR"
        default: return "SE"
        }
    }

    private func quietScheduleLabel(_ windows: [FamilyAlarmQuietWindow]?) -> String {
        guard let first = windows?.first else {
            return "평일 09:00-18:30"
        }
        let days = first.days.map { day in
            switch day {
            case 0, 1: return "일"
            case 2: return "월"
            case 3: return "화"
            case 4: return "수"
            case 5: return "목"
            case 6: return "금"
            default: return "토"
            }
        }.joined()
        return "\(days) \(first.start)-\(first.end)"
    }

    private func openEditor(_ alarm: LocalAlarmRecord? = nil) {
        if let alarm {
            editingAlarmID = alarm.id
            label = alarm.label
            repeatWeekdays = Set(alarm.repeatWeekdays)
            snoozeMinutes = alarm.snoozeMinutes
            playMode = alarm.playMode

            var components = Calendar.current.dateComponents([.year, .month, .day], from: Date())
            components.hour = alarm.hour
            components.minute = alarm.minute
            components.second = 0
            wakeDate = Calendar.current.date(from: components) ?? Date()
        } else {
            editingAlarmID = nil
            label = "아침 알람"
            wakeDate = Date().addingTimeInterval(5 * 60)
            repeatWeekdays = []
            snoozeMinutes = 5
            playMode = .alarmOnly
        }
        editorPresented = true
    }

    private func refreshAll() async {
        await remoteSync.refresh(session: auth.session)
        await voiceStudio.refresh(session: auth.session)
        await socialFeatures.refreshAll(session: auth.session)
        alarmKit.refreshAuthorizationState()
    }

    private func openAuxiliaryFromSettings(_ screen: AuxiliaryScreen) {
        settingsPresented = false
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
            auxiliaryScreen = screen
        }
    }

    private func scheduleFromEditor() async {
        if playMode != .alarmOnly && voiceStudio.preparedAlarm == nil {
            voiceStudio.statusMessage = "음성 알람은 먼저 목소리와 깨워줄 말을 생성해야 해요."
            selectedTab = .voices
            editorPresented = false
            return
        }

        let components = Calendar.current.dateComponents([.hour, .minute], from: wakeDate)
        let prepared = playMode == .alarmOnly ? nil : voiceStudio.preparedAlarm
        let existing = editingAlarmID.flatMap { id in store.alarms.first { $0.id == id } }

        if let existing {
            await alarmKit.cancel(record: existing, store: store)
        }

        let record = LocalAlarmRecord(
            id: existing?.id ?? UUID(),
            remoteID: existing?.remoteID,
            label: label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "알람" : label,
            hour: components.hour ?? 7,
            minute: components.minute ?? 0,
            repeatWeekdays: repeatWeekdays.sorted(),
            alarmKitID: nil,
            enabled: true,
            snoozeMinutes: snoozeMinutes,
            playMode: playMode,
            voiceProfileID: prepared?.voiceProfileID ?? existing?.voiceProfileID,
            messageID: prepared?.messageID ?? existing?.messageID,
            rawAudioURL: prepared?.rawAudioURL ?? existing?.rawAudioURL,
            localAudioFilePath: prepared?.localAudioFileName ?? existing?.localAudioFilePath,
            voiceText: prepared?.text ?? existing?.voiceText,
            voiceLanguage: prepared?.language ?? existing?.voiceLanguage,
            updatedAt: Date()
        )
        store.upsert(record)
        await alarmKit.schedule(record: record, store: store)
        editorPresented = false
        selectedTab = .alarms
    }

    private func generateVoiceAndSchedule() async {
        let prepared = await voiceStudio.generateTTS(session: auth.session)
        if prepared != nil {
            await scheduleFromEditor()
        }
    }

    private func scheduleOneMinuteTest() async {
        await alarmKit.scheduleOneMinuteTest(store: store)
        editorPresented = false
        selectedTab = .alarms
    }

    private func alarmDetail(_ alarm: LocalAlarmRecord) -> String {
        let repeatLabel = alarm.repeatWeekdays.isEmpty ? "한 번" : alarm.repeatWeekdays.sorted().map(weekdayLabel).joined(separator: " ")
        let remoteLabel = alarm.remoteID == nil ? "서버 미저장" : "서버 저장됨"
        let audioLabel = alarm.localAudioFilePath == nil ? "로컬 음성 없음" : "로컬 음성 캐시"
        return "\(repeatLabel) · \(alarm.playMode.label) · 다시 알림 \(alarm.snoozeMinutes)분 · \(audioLabel) · \(remoteLabel)"
    }

    private func weekdayLabel(_ value: Int) -> String {
        weekdays.first { $0.value == value }?.label ?? ""
    }

    private func badgeCount(for tab: NativeTab) -> Int {
        switch tab {
        case .home, .voices:
            return 0
        case .alarms:
            return store.alarms.filter { !$0.enabled }.count
        case .messages:
            return socialFeatures.unreadNoteCount
        }
    }

    private var preparedVoiceLabel: String {
        guard let prepared = voiceStudio.preparedAlarm else {
            return "아직 생성한 음성이 없어요. 음성 탭에서 음성을 생성해 주세요."
        }
        return "\(prepared.text) · \(prepared.language) · 로컬 캐시 완료"
    }
}

private enum NativeTab: String, CaseIterable, Identifiable {
    case home
    case voices
    case alarms
    case messages

    var id: String { rawValue }

    var title: String {
        switch self {
        case .home: return "홈"
        case .voices: return "음성"
        case .alarms: return "알람"
        case .messages: return "메시지"
        }
    }

    var navigationTitle: String {
        switch self {
        case .home: return "Naro"
        default: return title
        }
    }

    var systemImage: String {
        switch self {
        case .home: return "house"
        case .voices: return "mic"
        case .alarms: return "alarm"
        case .messages: return "message"
        }
    }
}

private enum AuxiliaryScreen: String, Identifiable {
    case people
    case growth
    case billing

    var id: String { rawValue }

    var title: String {
        switch self {
        case .people: return "코드 등록"
        case .growth: return "캐릭터"
        case .billing: return "이용권"
        }
    }
}

private extension View {
    func sectionSurface() -> some View {
        self
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(VoiceAlarmTheme.surface)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(VoiceAlarmTheme.surfaceVariant, lineWidth: 1)
            )
    }

    func settingsCard(title: String?) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if let title {
                Text(title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
                    .padding(.leading, 4)
            }
            self
                .background(VoiceAlarmTheme.surface)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(VoiceAlarmTheme.surfaceVariant, lineWidth: 1)
                )
        }
    }
}
