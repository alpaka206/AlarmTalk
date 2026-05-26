import AVFoundation
import SwiftUI
import UniformTypeIdentifiers

/// 알람 만들기/수정 시트 (Phase 3-C2).
///
/// Phase 3-C1 가 분리해 둔 264 줄 sheet 를, Android `AlarmEditorScreen.kt` +
/// `AlarmSettingsCard.kt` 수준으로 끌어올린 풀-폼. 본 파일은 *시트 UI* 만
/// 담당하고, 실제 시간 휠/요일 칩/진동 picker 등 컴포넌트는 별도 파일에서
/// 가져온다 (`TimeWheelPicker`, `RepeatWeekdayChips`, …).
///
/// 비즈니스 로직 (검증 → upsert → AlarmKit schedule) 은 본 파일이 그대로
/// 보유한다. 시트 외부에서 변하는 필드 (audio cache, sync state, alarmKitID
/// 등) 는 `AlarmEditDraft.toRecord(...)` 가 기존 record 의 값을 보존하며 다시
/// 합쳐 돌려준다.
struct AlarmEditorSheet: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var store: LocalAlarmStore
    @EnvironmentObject private var alarmKit: AlarmKitViewModel
    @EnvironmentObject private var remoteSync: RemoteAlarmSyncViewModel
    @EnvironmentObject private var voiceStudio: VoiceStudioViewModel
    @EnvironmentObject private var socialFeatures: SocialFeatureViewModel
    @EnvironmentObject private var subscriptions: SubscriptionManager

    @StateObject private var holidayStore = HolidayStore()
    @StateObject private var localRecorder = VoiceRecorder()
    @StateObject private var localPreviewPlayer = AudioPreviewPlayer()

    @Environment(\.voiceAlarmTheme) private var theme

    /// 부모(MainTabsView)가 넘기는 target — 새 알람 vs 기존 알람 수정 구분.
    let target: AlarmEditorTarget
    /// 시트 닫기.
    let onClose: () -> Void
    /// 사용자가 "음성 탭에서 만들기" 버튼을 누른 경우 부모가 탭 전환을 처리.
    let onJumpToVoices: () -> Void
    /// 저장 완료 후 알람 탭으로 전환.
    let onSchedulingDidFinish: () -> Void

    // MARK: - Form state

    @State private var draft: AlarmEditDraft = .newDefault()
    @State private var didLoadInitial = false
    @State private var validationAlert: ValidationAlertContent?
    @State private var isWorking = false
    @State private var sharedVoiceSetupTarget: FamilyVoiceProfile?
    @State private var selectedFamilyRecipientID: String?
    @State private var voiceSourceMode: VoiceSource = .ttsProfile
    @State private var localAudioMode: AlarmLocalAudioInputMode = .record
    @State private var localAudioMessage: String?
    @State private var localAudioFileImporterPresented = false
    @State private var selectedLocalAudioURL: URL?
    @State private var selectedLocalAudioName: String?
    @State private var selectedLocalAudioDurationMs: Int?
    @State private var localAudioCropStartMs = 0
    @State private var localAudioCropEndMs = Int(AlarmAudioLimits.maxDurationMillis)
    @State private var clearExistingLocalAudio = false

    private static let familyAlarmMinLeadMillis: Int64 = 30 * 60 * 1000

    private struct ValidationAlertContent: Identifiable {
        let id = UUID()
        let title: String
        let message: String
    }

    var body: some View {
        Form {
            Section {
                TimeWheelPicker(hour: $draft.hour, minute: $draft.minute)
                    .frame(maxWidth: .infinity)
                    .listRowInsets(EdgeInsets(top: 12, leading: 8, bottom: 12, trailing: 8))
                    .listRowBackground(Color.clear)
            }

            Section {
                TextField("알람 이름", text: $draft.label)
                    .textInputAutocapitalization(.never)
                    .disableAutocorrection(true)
            }

            Section("반복") {
                RepeatWeekdayChips(mask: $draft.repeatDaysMask)
                    .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16))
                HolidayOffToggle(
                    isOn: $draft.holidayOff,
                    enabled: draft.repeatDaysMask != 0
                )
            }

            if target.familyAlarmMode {
                Section("알람 받을 사람") {
                    FamilyAlarmTargetPicker(
                        recipients: familyRecipients,
                        selectedRecipientID: selectedFamilyRecipientID,
                        hour: draft.hour,
                        minute: draft.minute,
                        repeatDaysMask: draft.repeatDaysMask,
                        holidayOff: draft.holidayOff,
                        onSelect: selectFamilyRecipient
                    )
                }
            }

            Section("알람 방식") {
                VoicePlayModePicker(
                    mode: $draft.playMode,
                    voiceLocked: voicePlanLocked,
                    onLockedVoiceClick: showVoicePlanLockedAlert
                )
                    .onChange(of: draft.playMode) { _, newMode in
                        voiceStudio.preparedAlarm = nil
                        if newMode == .alarmOnly {
                            draft.voiceRepeat = true
                            draft.voiceVolumePercent = 100
                        } else {
                            selectDefaultVoiceProfileIfNeeded()
                        }
                    }
                    .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16))

                if draft.playMode != .alarmOnly {
                    Picker("음성 소스", selection: $voiceSourceMode) {
                        Text("목소리").tag(VoiceSource.ttsProfile)
                        Text("녹음/파일").tag(VoiceSource.localAudio)
                    }
                    .pickerStyle(.segmented)
                    .onChange(of: voiceSourceMode) { _, newValue in
                        voiceStudio.preparedAlarm = nil
                        localPreviewPlayer.stop()
                        if newValue == .ttsProfile {
                            localRecorder.stop()
                        }
                    }

                    if voiceSourceMode == .ttsProfile {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("목소리")
                                .font(theme.typography.titleSmall)
                            AlarmVoiceProfilePicker(
                                ownProfiles: voiceStudio.profiles,
                                familyVoices: voiceStudio.familyVoices,
                                selectedProfileID: voiceStudio.selectedProfileID,
                                onSelectOwn: { profile in
                                    voiceStudio.selectedProfileID = profile.id
                                    voiceStudio.preparedAlarm = nil
                                },
                                onSelectShared: { profile in
                                    if profile.requiresViewerInfo {
                                        sharedVoiceSetupTarget = profile
                                    } else {
                                        voiceStudio.selectedProfileID = profile.id
                                        voiceStudio.preparedAlarm = nil
                                    }
                                }
                            )
                            Text(preparedVoiceLabel)
                                .font(theme.typography.bodySmall)
                                .foregroundStyle(theme.palette.onSurfaceVariant)
                            Button {
                                onJumpToVoices()
                            } label: {
                                Label("음성 탭에서 만들기", systemImage: "waveform")
                            }
                            .buttonStyle(.bordered)
                        }

                        Toggle("랜덤 문구 사용", isOn: Binding(
                            get: { voiceStudio.randomPrompt },
                            set: { enabled in
                                voiceStudio.randomPrompt = enabled
                                voiceStudio.preparedAlarm = nil
                                if !enabled && !voiceStudio.translateText {
                                    voiceStudio.ttsLanguage = "ko"
                                }
                            }
                        ))
                            .tint(theme.palette.primary)
                        if voiceStudio.randomPrompt {
                            Picker("랜덤 컨텍스트", selection: $voiceStudio.randomContext) {
                                ForEach(RandomPromptContext.alarmEditorCases, id: \.rawValue) { context in
                                    Text(context.label).tag(context.rawValue)
                                }
                            }
                            .pickerStyle(.menu)
                            .onChange(of: voiceStudio.randomContext) { _, _ in
                                voiceStudio.preparedAlarm = nil
                            }
                            Picker("언어", selection: $voiceStudio.ttsLanguage) {
                                ForEach(ttsLanguages, id: \.code) { option in
                                    Text(option.label).tag(option.code)
                                }
                            }
                            .pickerStyle(.menu)
                            .onChange(of: voiceStudio.ttsLanguage) { _, _ in
                                voiceStudio.preparedAlarm = nil
                            }
                            Text("선택한 상황에 맞춰 깨움말을 자동으로 만들어요.")
                                .font(theme.typography.bodySmall)
                                .foregroundStyle(theme.palette.onSurfaceVariant)
                            if activePromptContext.usesWeather {
                                VStack(alignment: .leading, spacing: 8) {
                                    Text("날씨 지역")
                                        .font(theme.typography.titleSmall)
                                    WeatherLocationInputFields(
                                        country: $voiceStudio.weatherCountry,
                                        city: $voiceStudio.weatherCity,
                                        helperText: "날씨가 들어간 깨움말에 사용할 지역이에요."
                                    )
                                    if !voiceStudio.hasWeatherInfo || targetWeatherReady {
                                        Text(targetWeatherReady ? "상대가 저장한 날씨 지역을 사용해요." : "날씨가 들어간 문구를 쓰려면 지역을 입력해 주세요.")
                                            .font(theme.typography.bodySmall)
                                            .foregroundStyle(theme.palette.onSurfaceVariant)
                                    }
                                }
                                .padding(.top, 4)
                            }
                            if activePromptContext.usesFortune {
                                VStack(alignment: .leading, spacing: 8) {
                                    Text("운세 정보")
                                        .font(theme.typography.titleSmall)
                                    FortunePromptInputFields(
                                        gender: $voiceStudio.fortuneGender,
                                        birthDate: $voiceStudio.fortuneBirthDate,
                                        birthTime: $voiceStudio.fortuneBirthTime,
                                        helperText: "운세가 들어간 깨움말을 만들 때만 사용해요."
                                    )
                                    if !voiceStudio.hasFortuneInfo || targetFortuneReady {
                                        Text(targetFortuneReady ? "상대가 저장한 운세 정보를 사용해요." : "운세가 들어간 문구를 쓰려면 성별, 생년월일, 태어난 시간이 필요해요.")
                                            .font(theme.typography.bodySmall)
                                            .foregroundStyle(theme.palette.onSurfaceVariant)
                                    }
                                }
                                .padding(.top, 4)
                            }
                        } else {
                            ManualVoiceMessageEditor(
                                text: $voiceStudio.ttsText,
                                translationEnabled: $voiceStudio.translateText,
                                language: $voiceStudio.ttsLanguage,
                                onInvalidatePreparedAudio: { voiceStudio.preparedAlarm = nil }
                            )
                        }
                    } else {
                        LocalAlarmAudioEditor(
                            mode: $localAudioMode,
                            isRecording: localRecorder.isRecording,
                            elapsedMs: Int(localRecorder.elapsedSeconds * 1000),
                            hasRecording: localRecorder.latestRecordingURL != nil,
                            existingAudioLabel: existingLocalAudioLabel,
                            fileName: selectedLocalAudioName,
                            fileDurationMs: selectedLocalAudioDurationMs,
                            cropStartMs: $localAudioCropStartMs,
                            cropEndMs: $localAudioCropEndMs,
                            isPreviewing: localPreviewPlayer.isPlaying,
                            message: localAudioMessage,
                            onModeChange: handleLocalAudioModeChange,
                            onRecord: toggleLocalRecording,
                            onPickFile: { localAudioFileImporterPresented = true },
                            onPreview: previewLocalAlarmAudio,
                            onClear: clearLocalAlarmAudio
                        )
                    }

                    if draft.playMode == .voiceOnly {
                        VoiceRepeatEditor(isRepeating: $draft.voiceRepeat)
                    }
                    VoiceVolumeEditor(volumePercent: $draft.voiceVolumePercent)
                }
            }

            Section("스누즈") {
                Toggle("스누즈 허용", isOn: $draft.snoozeEnabled)
                    .tint(theme.palette.primary)

                if draft.snoozeEnabled {
                    Stepper(
                        value: $draft.snoozeMinutes,
                        in: 1...30
                    ) {
                        HStack {
                            Text("간격")
                            Spacer()
                            Text("\(draft.snoozeMinutes)분")
                                .foregroundStyle(theme.palette.primary)
                                .monospacedDigit()
                        }
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Text("최대 반복 횟수")
                            .font(theme.typography.titleSmall)
                        SnoozeRepeatLimitPicker(limit: $draft.snoozeRepeatLimit)
                    }
                    .padding(.vertical, 4)
                }
            }

            Section("사운드 & 진동") {
                AlarmVolumeSlider(volume: $draft.alarmVolumePercent)

                HStack {
                    Text("진동 패턴")
                        .font(theme.typography.titleSmall)
                    Spacer()
                    VibrationPatternPicker(selected: $draft.vibrationPattern)
                }
            }

            Section {
                Button {
                    Task { await saveFlow() }
                } label: {
                    Label(saveButtonTitle, systemImage: "calendar.badge.plus")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(theme.palette.primary)
                .disabled(isWorking)

                if draft.playMode != .alarmOnly && voiceSourceMode == .ttsProfile {
                    Button {
                        Task { await generateVoiceAndSave() }
                    } label: {
                        Label("음성 생성 후 저장", systemImage: "sparkles")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .disabled(voiceStudio.isBusy || isWorking)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(theme.palette.background)
        .navigationTitle(navigationTitle)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(action: onClose) {
                    Image(systemName: "xmark")
                }
                .accessibilityLabel(Text("닫기"))
            }
        }
        .alert(item: $validationAlert) { content in
            Alert(
                title: Text(content.title),
                message: Text(content.message),
                dismissButton: .default(Text("확인"))
            )
        }
        .onAppear {
            guard !didLoadInitial else { return }
            didLoadInitial = true
            loadInitialState()
            Task {
                await voiceStudio.refresh(session: auth.session)
                selectDefaultVoiceProfileIfNeeded()
                if target.familyAlarmMode {
                    await socialFeatures.refreshAll(session: auth.session)
                    selectDefaultFamilyRecipientIfNeeded()
                }
            }
        }
        .sheet(item: $sharedVoiceSetupTarget) { profile in
            SharedVoiceSelectionSetupSheet(
                profile: profile,
                isWorking: voiceStudio.isBusy,
                onCancel: { sharedVoiceSetupTarget = nil },
                onPreview: {
                    Task {
                        await voiceStudio.previewSharedVoice(profileId: profile.id, session: auth.session)
                    }
                },
                onConfirm: { relationship, listener in
                    let target = profile
                    Task {
                        await voiceStudio.updateSharedVoiceViewerInfo(
                            profileId: target.id,
                            relationshipLabel: relationship,
                            listenerTitle: listener,
                            session: auth.session
                        )
                        voiceStudio.selectedProfileID = target.id
                        voiceStudio.preparedAlarm = nil
                        sharedVoiceSetupTarget = nil
                    }
                }
            )
            .presentationDetents([.medium, .large])
        }
        .fileImporter(
            isPresented: $localAudioFileImporterPresented,
            allowedContentTypes: [.audio],
            allowsMultipleSelection: false
        ) { result in
            switch result {
            case .success(let urls):
                guard let source = urls.first else { return }
                Task { await importLocalAlarmAudio(source) }
            case .failure(let error):
                localAudioMessage = error.localizedDescription
            }
        }
        .onChange(of: voiceStudio.weatherCountry) { _, _ in voiceStudio.preparedAlarm = nil }
        .onChange(of: voiceStudio.weatherCity) { _, _ in voiceStudio.preparedAlarm = nil }
        .onChange(of: voiceStudio.fortuneGender) { _, _ in voiceStudio.preparedAlarm = nil }
        .onChange(of: voiceStudio.fortuneBirthDate) { _, _ in voiceStudio.preparedAlarm = nil }
        .onChange(of: voiceStudio.fortuneBirthTime) { _, _ in voiceStudio.preparedAlarm = nil }
        .onChange(of: localRecorder.elapsedSeconds) { _, seconds in
            if seconds >= TimeInterval(AlarmAudioLimits.maxDurationMillis / 1000),
               localRecorder.isRecording {
                localRecorder.stop()
                localAudioMessage = "최대 \(AlarmAudioLimits.maxDurationMillis / 1000)초까지 녹음했어요."
            }
        }
        .onDisappear {
            localRecorder.stop()
            localPreviewPlayer.stop()
        }
    }

    private var saveButtonTitle: String {
        target.editingAlarmID == nil ? "저장" : "수정 저장"
    }

    private var navigationTitle: String {
        if target.familyAlarmMode { return "상대 알람 맞추기" }
        return target.editingAlarmID == nil ? "알람 만들기" : "알람 수정"
    }

    private var activePromptContext: RandomPromptContext {
        RandomPromptContext.normalized(voiceStudio.randomContext)
    }

    private var targetWeatherReady: Bool {
        target.familyAlarmMode && selectedFamilyRecipient?.dynamicPromptSettingsState?.weatherReady == true
    }

    private var targetFortuneReady: Bool {
        target.familyAlarmMode && selectedFamilyRecipient?.dynamicPromptSettingsState?.fortuneReady == true
    }

    private var voicePlanLocked: Bool {
        !currentPlan.meetsOrExceeds(.personal)
    }

    private var familyAlarmLocked: Bool {
        socialFeatures.familyGroup?.group == nil && !currentPlan.meetsOrExceeds(.couple)
    }

    private var currentPlan: PlanTier {
        PlanTier.bestKnown(
            serverSubscription: socialFeatures.subscription,
            storeTier: subscriptions.currentTier,
            userPlan: auth.session?.user.plan
        )
    }

    private var defaultPlayModeForPlan: AlarmPlayMode {
        voicePlanLocked ? .alarmOnly : .soundThenVoice
    }

    private var preparedVoiceLabel: String {
        guard let prepared = voiceStudio.preparedAlarm else {
            return "아직 생성한 음성이 없어요. 음성 탭에서 음성을 생성해 주세요."
        }
        return "\(prepared.text) · \(prepared.language) · 로컬 캐시 완료"
    }

    private var editingAlarm: LocalAlarmRecord? {
        target.editingAlarmID.flatMap { id in
            store.alarms.first { $0.id == id }
        }
    }

    private var existingLocalAudioLabel: String? {
        guard selectedLocalAudioURL == nil,
              localRecorder.latestRecordingURL == nil,
              !clearExistingLocalAudio,
              let alarm = editingAlarm,
              alarm.voiceSourceEnum == .localAudio,
              alarm.audioCacheKey != nil else {
            return nil
        }
        return "저장된 녹음/파일 음성을 사용 중이에요."
    }

    private var familyRecipients: [FamilyGroupMember] {
        let currentUserID = auth.session?.user.id
        let currentEmail = auth.session?.user.email
        return (socialFeatures.familyGroup?.members ?? []).filter { member in
            member.userId != currentUserID &&
                member.email != currentEmail &&
                member.allowFamilyAlarms == true
        }
    }

    private var selectedFamilyRecipient: FamilyGroupMember? {
        if let selectedFamilyRecipientID,
           let selected = familyRecipients.first(where: { $0.userId == selectedFamilyRecipientID }) {
            return selected
        }
        return familyRecipients.first
    }

    // MARK: - Initial load

    private func loadInitialState() {
        if let editingID = target.editingAlarmID,
           let alarm = store.alarms.first(where: { $0.id == editingID }) {
            draft = AlarmEditDraft(from: alarm)
            voiceSourceMode = alarm.voiceSourceEnum == .localAudio ? .localAudio : .ttsProfile
            clearExistingLocalAudio = false
            if voicePlanLocked && draft.playMode != .alarmOnly {
                draft.playMode = .alarmOnly
            }
            loadVoicePromptState(from: alarm)
        } else {
            draft = .newDefault(defaultPlayMode: defaultPlayModeForPlan)
            voiceSourceMode = .ttsProfile
            clearExistingLocalAudio = false
            loadVoicePromptState(from: nil)
            selectDefaultFamilyRecipientIfNeeded()
        }
    }

    private func loadVoicePromptState(from alarm: LocalAlarmRecord?) {
        let saved = savedPromptPreferences()
        voiceStudio.selectedProfileID = alarm?.voiceProfileId
        voiceStudio.preparedAlarm = nil
        voiceStudio.ttsText = alarm?.voiceText ?? ""
        voiceStudio.ttsCategory = alarm?.voiceCategory ?? "morning"
        voiceStudio.ttsLanguage = alarm?.voiceLanguage ?? "ko"
        voiceStudio.randomPrompt = alarm?.voiceRandomPrompt ?? false
        voiceStudio.randomContext = RandomPromptContext.normalized(alarm?.voiceRandomContext).rawValue
        voiceStudio.translateText = !voiceStudio.randomPrompt && voiceStudio.ttsLanguage != "ko"
        voiceStudio.weatherCountry = alarm?.voiceWeatherCountry ?? saved.weatherCountry
        voiceStudio.weatherCity = alarm?.voiceWeatherCity ?? saved.weatherCity
        voiceStudio.fortuneGender = alarm?.voiceFortuneGender ?? saved.fortuneGender
        voiceStudio.fortuneBirthDate = alarm?.voiceFortuneBirthDate ?? saved.fortuneBirthDate
        voiceStudio.fortuneBirthTime = alarm?.voiceFortuneBirthTime ?? saved.fortuneBirthTime
    }

    private func savedPromptPreferences() -> DynamicPromptPreferences {
        let server = DynamicPromptPreferences.from(settings: auth.session?.user.dynamicPromptSettings)
        return server == DynamicPromptPreferences() ? .loadFromDefaults() : server
    }

    private func applyVoicePromptState(to record: inout LocalAlarmRecord) {
        let enabled = record.playModeEnum != .alarmOnly && voiceStudio.randomPrompt
        let context = RandomPromptContext.normalized(voiceStudio.randomContext)
        record.voiceRandomPrompt = enabled
        record.voiceRandomContext = enabled ? context.rawValue : nil
        record.voiceWeatherCountry = enabled && context.usesWeather ? nonEmpty(voiceStudio.weatherCountry) : nil
        record.voiceWeatherCity = enabled && context.usesWeather ? nonEmpty(voiceStudio.weatherCity) : nil
        record.voiceFortuneGender = enabled && context.usesFortune ? nonEmpty(voiceStudio.fortuneGender) : nil
        record.voiceFortuneBirthDate = enabled && context.usesFortune ? nonEmpty(voiceStudio.fortuneBirthDate) : nil
        record.voiceFortuneBirthTime = enabled && context.usesFortune ? nonEmpty(voiceStudio.fortuneBirthTime) : nil
    }

    private func showVoicePlanLockedAlert() {
        validationAlert = ValidationAlertContent(
            title: "이용권이 필요해요",
            message: "무료 이용권에서는 알람만 사용할 수 있어요."
        )
    }

    private func selectDefaultFamilyRecipientIfNeeded() {
        guard target.familyAlarmMode else { return }
        if let selectedFamilyRecipientID,
           familyRecipients.contains(where: { $0.userId == selectedFamilyRecipientID }) {
            return
        }
        if let first = familyRecipients.first {
            selectFamilyRecipient(first.userId)
        }
    }

    private func selectDefaultVoiceProfileIfNeeded() {
        guard draft.playMode != .alarmOnly else { return }
        let selected = voiceStudio.selectedProfileID
        let readyOwn = voiceStudio.profiles.filter { $0.isReadyForAlarmSelection }
        let readyShared = voiceStudio.familyVoices.filter { $0.isReadyForAlarmSelection }
        let selectedStillAvailable = selected.map { selectedID in
            readyOwn.contains(where: { $0.id == selectedID }) ||
                readyShared.contains(where: { $0.id == selectedID })
        } ?? false
        if selectedStillAvailable {
            return
        }
        if let first = readyOwn.first {
            voiceStudio.selectedProfileID = first.id
        } else if let first = readyShared.first, !first.requiresViewerInfo {
            voiceStudio.selectedProfileID = first.id
        }
    }

    private func selectFamilyRecipient(_ userID: String) {
        selectedFamilyRecipientID = userID
        voiceStudio.preparedAlarm = nil
        guard let recipient = familyRecipients.first(where: { $0.userId == userID }) else { return }
        let preferences = DynamicPromptPreferences.from(settings: recipient.dynamicPromptSettings)
        voiceStudio.weatherCountry = preferences.weatherCountry
        voiceStudio.weatherCity = preferences.weatherCity
        voiceStudio.fortuneGender = preferences.fortuneGender
        voiceStudio.fortuneBirthDate = preferences.fortuneBirthDate
        voiceStudio.fortuneBirthTime = preferences.fortuneBirthTime
    }

    // MARK: - Save flow

    private func saveFlow() async {
        guard !isWorking else { return }
        isWorking = true
        defer { isWorking = false }

        let errors = draft.validate()
        if let first = errors.first {
            validationAlert = ValidationAlertContent(
                title: "저장할 수 없어요",
                message: errorMessage(first)
            )
            return
        }

        if voicePlanLocked && draft.playMode != .alarmOnly {
            draft.playMode = .alarmOnly
            showVoicePlanLockedAlert()
            return
        }

        if target.familyAlarmMode && familyAlarmLocked {
            validationAlert = ValidationAlertContent(
                title: "이용권이 필요해요",
                message: "상대 알람은 커플/가족 이용권에서 사용할 수 있어요."
            )
            return
        }

        let familyRecipient = target.familyAlarmMode ? validateFamilyAlarmTarget() : nil
        if target.familyAlarmMode && familyRecipient == nil {
            return
        }

        if draft.playMode != .alarmOnly,
           voiceSourceMode == .ttsProfile,
           voiceStudio.preparedAlarm == nil {
            voiceStudio.statusMessage = "음성 알람은 먼저 목소리와 깨워줄 말을 생성해야 해요."
            return
        }

        let familyLocalVoiceSource: FamilyLocalVoiceUploadSource?
        if familyRecipient != nil,
           draft.playMode != .alarmOnly,
           voiceSourceMode == .localAudio {
            do {
                let prepared = try await preparedLocalAlarmAudioSource()
                familyLocalVoiceSource = FamilyLocalVoiceUploadSource(
                    url: prepared.url,
                    durationMs: prepared.durationMs,
                    displayName: localAudioUploadDisplayName(for: prepared.url)
                )
            } catch {
                localAudioMessage = error.localizedDescription
                return
            }
        } else {
            familyLocalVoiceSource = nil
        }

        let existing = editingAlarm
        let cachedLocalAudio: CachedLocalAlarmAudio?
        if familyRecipient == nil,
           draft.playMode != .alarmOnly,
           voiceSourceMode == .localAudio {
            do {
                cachedLocalAudio = try await cachedLocalAudioForSave(existing: existing)
            } catch {
                localAudioMessage = error.localizedDescription
                return
            }
        } else {
            cachedLocalAudio = nil
        }

        if let familyRecipient {
            await createFamilyTargetAlarm(
                recipient: familyRecipient,
                localVoiceSource: familyLocalVoiceSource
            )
            return
        }

        let now = Int64(Date().timeIntervalSince1970 * 1000)

        let fireAt: Int64 = (try? AlarmTimeCalculator.nextFireAtMillis(
            hour: draft.hour,
            minute: draft.minute,
            repeatDaysMask: draft.repeatDaysMask,
            holidayOff: draft.holidayOff,
            nowMillis: now,
            isHoliday: holidayStore.holidayPredicate()
        )) ?? LocalAlarmRecord.fallbackFireAtMillis(
            hour: draft.hour,
            minute: draft.minute,
            referenceMillis: now
        )

        // playMode 가 음성을 포함하면, voiceStudio 의 prepared 결과를 record 의
        // 음원/프로필 필드에 합쳐 둔다.
        var merged = draft.toRecord(existing: existing, fireAtMillis: fireAt, nowMillis: now)
        applyVoicePromptState(to: &merged)
        if let cachedLocalAudio, draft.playMode != .alarmOnly {
            merged.voiceSource = VoiceSource.localAudio.rawValue
            merged.localAudioUri = cachedLocalAudio.fileName
            merged.audioCacheKey = cachedLocalAudio.cacheKey
            merged.rawAudioUri = nil
            merged.voiceProfileId = nil
            merged.voiceText = nil
            merged.voiceCategory = nil
            merged.voiceLanguage = nil
            merged.voiceRandomPrompt = false
            merged.voiceRandomContext = nil
            merged.voiceWeatherCountry = nil
            merged.voiceWeatherCity = nil
            merged.voiceFortuneGender = nil
            merged.voiceFortuneBirthDate = nil
            merged.voiceFortuneBirthTime = nil
            merged.dynamicVoicePreparedForFireAtMillis = nil
            merged.ttsMessageId = nil
        } else if let prepared = voiceStudio.preparedAlarm, draft.playMode != .alarmOnly {
            merged.voiceSource = VoiceSource.serverTts.rawValue
            merged.localAudioUri = prepared.localAudioFileName
            merged.audioCacheKey = prepared.audioCacheKey
            merged.rawAudioUri = prepared.rawAudioURL ?? merged.rawAudioUri
            merged.voiceProfileId = prepared.voiceProfileID
            merged.voiceText = prepared.text
            merged.voiceCategory = voiceStudio.randomPrompt ? activePromptContext.ttsCategory : "custom"
            merged.voiceLanguage = prepared.language
            merged.dynamicVoicePreparedForFireAtMillis = voiceStudio.randomPrompt ? merged.fireAtMillis : nil
            merged.ttsMessageId = prepared.messageID
        }

        do {
            try LocalAlarmStore.validateDraft(merged)
            try store.requireUniqueTime(
                hour: merged.hour,
                minute: merged.minute,
                repeatDaysMask: merged.repeatDaysMask,
                excludingID: existing?.id
            )
        } catch {
            validationAlert = ValidationAlertContent(
                title: "저장할 수 없어요",
                message: error.localizedDescription
            )
            return
        }

        store.upsert(merged)
        let scheduled = await alarmKit.schedule(record: merged, store: store)
        guard scheduled else {
            if let existing {
                store.upsert(existing)
            } else {
                store.deleteByID(merged.id)
            }
            validationAlert = ValidationAlertContent(
                title: "예약할 수 없어요",
                message: alarmKit.statusMessage ?? "AlarmKit 예약에 실패했어요."
            )
            return
        }
        if let existing {
            await alarmKit.cancelScheduledAlarm(record: existing)
        }
        onSchedulingDidFinish()
    }

    private func generateVoiceAndSave() async {
        let prepared = await voiceStudio.generateTTS(
            session: auth.session,
            alarmHour: draft.hour,
            alarmMinute: draft.minute,
            targetUserId: target.familyAlarmMode ? selectedFamilyRecipient?.userId : nil,
            targetDynamicPromptState: target.familyAlarmMode ? selectedFamilyRecipient?.dynamicPromptSettingsState : nil
        )
        if prepared != nil {
            await saveFlow()
        }
    }

    private func validateFamilyAlarmTarget() -> FamilyGroupMember? {
        guard let recipient = selectedFamilyRecipient else {
            validationAlert = ValidationAlertContent(
                title: "받을 사람이 없어요",
                message: "상대가 내 알람 맞추기를 허용하면 여기에 표시돼요."
            )
            return nil
        }

        let nowMillis = Int64(Date().timeIntervalSince1970 * 1000)
        let fireAtMillis = (try? AlarmTimeCalculator.nextFireAtMillis(
            hour: draft.hour,
            minute: draft.minute,
            repeatDaysMask: draft.repeatDaysMask,
            holidayOff: draft.holidayOff,
            nowMillis: nowMillis
        )) ?? LocalAlarmRecord.fallbackFireAtMillis(
            hour: draft.hour,
            minute: draft.minute,
            referenceMillis: nowMillis
        )
        if fireAtMillis - nowMillis < Self.familyAlarmMinLeadMillis {
            validationAlert = ValidationAlertContent(
                title: "조금 더 뒤로 설정해 주세요",
                message: "상대 알람은 지금부터 30분 뒤부터 설정할 수 있어요."
            )
            return nil
        }
        if FamilyAlarmScheduleRules.isTimeUnavailable(
            member: recipient,
            hour: draft.hour,
            minute: draft.minute,
            repeatDaysMask: draft.repeatDaysMask,
            nowMillis: nowMillis
        ) {
            validationAlert = ValidationAlertContent(
                title: "받을 수 없는 시간이에요",
                message: "상대가 이 시간에는 알람을 받지 않도록 해뒀어요."
            )
            return nil
        }
        return recipient
    }

    private func createFamilyTargetAlarm(
        recipient: FamilyGroupMember,
        localVoiceSource: FamilyLocalVoiceUploadSource?
    ) async {
        guard let token = auth.session?.token else {
            validationAlert = ValidationAlertContent(title: "로그인이 필요해요", message: "상대 알람은 로그인 후 사용할 수 있어요.")
            return
        }
        do {
            if let localVoiceSource {
                let upload = try await VoiceAlarmAPI.shared.uploadVoiceAudio(
                    audioFileURL: localVoiceSource.url,
                    durationMs: localVoiceSource.durationMs,
                    originalName: localVoiceSource.displayName,
                    token: token
                )
                let request = FamilyVoiceAlarmRequest(
                    recipientUserId: recipient.userId,
                    wakeAt: String(format: "%02d:%02d", draft.hour, draft.minute),
                    voiceUploadId: upload.id,
                    label: nonEmpty(draft.label) ?? "가족이 보낸 음성",
                    dubTargetLanguage: nil,
                    repeatDays: RemoteAlarmMapper.repeatDays(fromMask: draft.repeatDaysMask)
                )
                _ = try await VoiceAlarmAPI.shared.createFamilyVoiceAlarm(request, token: token)
            } else {
                let prepared = voiceStudio.preparedAlarm
                let request = RemoteAlarmWriteRequest(
                    time: String(format: "%02d:%02d", draft.hour, draft.minute),
                    repeatDays: RemoteAlarmMapper.repeatDays(fromMask: draft.repeatDaysMask),
                    snoozeMinutes: draft.snoozeMinutes,
                    mode: prepared == nil ? "sound-only" : "tts",
                    vibrationPattern: draft.vibrationPattern.rawValue,
                    wakeMode: draft.playMode.remoteWakeMode,
                    isActive: true,
                    messageId: prepared?.messageID,
                    voiceProfileId: prepared?.voiceProfileID,
                    rawAudioUrl: nil,
                    rawAudioDurationMs: nil,
                    targetUserId: recipient.userId
                )
                _ = try await VoiceAlarmAPI.shared.createAlarm(request, token: token)
            }
            await remoteSync.refresh(session: auth.session, force: true)
            await socialFeatures.refreshAll(session: auth.session, force: true)
            validationAlert = nil
            onSchedulingDidFinish()
        } catch {
            validationAlert = ValidationAlertContent(
                title: "상대 알람 설정에 실패했어요",
                message: error.localizedDescription
            )
        }
    }

    private func handleLocalAudioModeChange(_ mode: AlarmLocalAudioInputMode) {
        localPreviewPlayer.stop()
        if mode == .file {
            localRecorder.clearLatest()
        } else {
            selectedLocalAudioURL = nil
            selectedLocalAudioName = nil
            selectedLocalAudioDurationMs = nil
            localAudioCropStartMs = 0
            localAudioCropEndMs = Int(AlarmAudioLimits.maxDurationMillis)
        }
        localAudioMode = mode
        clearExistingLocalAudio = true
        localAudioMessage = nil
    }

    private func toggleLocalRecording() {
        localPreviewPlayer.stop()
        if localRecorder.isRecording {
            localRecorder.stop()
            localAudioMessage = "녹음을 저장했어요."
            clearExistingLocalAudio = false
            return
        }
        selectedLocalAudioURL = nil
        selectedLocalAudioName = nil
        selectedLocalAudioDurationMs = nil
        localRecorder.clearLatest()
        clearExistingLocalAudio = false
        localAudioCropStartMs = 0
        localAudioCropEndMs = Int(AlarmAudioLimits.maxDurationMillis)
        Task {
            do {
                try await localRecorder.start()
                localAudioMessage = "녹음 중..."
            } catch {
                localAudioMessage = error.localizedDescription
            }
        }
    }

    private func importLocalAlarmAudio(_ source: URL) async {
        do {
            let importedURL = try copyImportedAudio(source)
            let durationMs = try await readAudioDurationMs(importedURL)
            selectedLocalAudioURL = importedURL
            selectedLocalAudioName = source.lastPathComponent
            selectedLocalAudioDurationMs = durationMs
            clearExistingLocalAudio = false
            localAudioCropStartMs = 0
            localAudioCropEndMs = min(durationMs, Int(AlarmAudioLimits.maxDurationMillis))
            localAudioMessage = durationMs < 1_000
                ? "1초 이상 들리는 파일을 선택해 주세요."
                : "파일을 선택했어요."
        } catch {
            localAudioMessage = error.localizedDescription
        }
    }

    private func previewLocalAlarmAudio() {
        if localPreviewPlayer.isPlaying {
            localPreviewPlayer.stop()
            return
        }
        Task {
            do {
                if selectedLocalAudioURL == nil,
                   localRecorder.latestRecordingURL == nil,
                   let url = existingLocalAudioURL() {
                    try localPreviewPlayer.play(url: url)
                } else {
                    let prepared = try await preparedLocalAlarmAudioSource()
                    try localPreviewPlayer.play(url: prepared.url)
                }
            } catch {
                localAudioMessage = error.localizedDescription
            }
        }
    }

    private func clearLocalAlarmAudio() {
        localPreviewPlayer.stop()
        localRecorder.clearLatest()
        selectedLocalAudioURL = nil
        selectedLocalAudioName = nil
        selectedLocalAudioDurationMs = nil
        clearExistingLocalAudio = true
        localAudioCropStartMs = 0
        localAudioCropEndMs = Int(AlarmAudioLimits.maxDurationMillis)
        localAudioMessage = "음성 오디오를 지웠어요."
    }

    private func cachedLocalAudioForSave(existing: LocalAlarmRecord?) async throws -> CachedLocalAlarmAudio {
        let hasNewSource = selectedLocalAudioURL != nil || localRecorder.latestRecordingURL != nil
        if hasNewSource {
            let prepared = try await preparedLocalAlarmAudioSource()
            let data = try Data(contentsOf: prepared.url)
            let cacheKey = AudioCacheStore.computeCacheKey(data)
            let mimeType = AudioCacheStore.mimeType(forFormat: prepared.url.pathExtension.isEmpty ? "m4a" : prepared.url.pathExtension)
            let cachedURL = try AudioCacheStore.shared.cacheBytes(
                data,
                cacheKey: cacheKey,
                mimeType: mimeType,
                source: "raw_audio",
                durationOverrideMs: Int64(prepared.durationMs),
                enforceMaxDuration: true
            )
            return CachedLocalAlarmAudio(fileName: cachedURL.lastPathComponent, cacheKey: cacheKey)
        }

        guard !clearExistingLocalAudio,
              let existing,
              existing.voiceSourceEnum == .localAudio,
              let cacheKey = existing.audioCacheKey,
              AudioCacheStore.shared.cachedURL(for: cacheKey) != nil else {
            throw LocalAlarmAudioError.missingSource
        }
        return CachedLocalAlarmAudio(fileName: existing.localAudioUri ?? "", cacheKey: cacheKey)
    }

    private func existingLocalAudioURL() -> URL? {
        guard !clearExistingLocalAudio,
              let alarm = editingAlarm,
              alarm.voiceSourceEnum == .localAudio,
              let cacheKey = alarm.audioCacheKey else {
            return nil
        }
        return AudioCacheStore.shared.cachedURL(for: cacheKey)
    }

    private func preparedLocalAlarmAudioSource() async throws -> (url: URL, durationMs: Int) {
        switch localAudioMode {
        case .record:
            guard let url = localRecorder.latestRecordingURL else {
                throw LocalAlarmAudioError.missingSource
            }
            let durationMs = localRecorder.latestDurationMs ?? Int(localRecorder.elapsedSeconds * 1000)
            guard durationMs >= 1_000 else { throw LocalAlarmAudioError.tooShort }
            guard durationMs <= Int(AlarmAudioLimits.maxDurationMillis + AlarmAudioLimits.durationToleranceMillis) else {
                throw LocalAlarmAudioError.tooLong
            }
            return (url, min(durationMs, Int(AlarmAudioLimits.maxDurationMillis)))
        case .file:
            guard let source = selectedLocalAudioURL,
                  let sourceDuration = selectedLocalAudioDurationMs else {
                throw LocalAlarmAudioError.missingSource
            }
            let endMs = min(localAudioCropEndMs, sourceDuration)
            let durationMs = max(0, endMs - localAudioCropStartMs)
            guard durationMs >= 1_000 else { throw LocalAlarmAudioError.tooShort }
            guard durationMs <= Int(AlarmAudioLimits.maxDurationMillis + AlarmAudioLimits.durationToleranceMillis) else {
                throw LocalAlarmAudioError.tooLong
            }
            if localAudioCropStartMs == 0 && endMs == sourceDuration {
                return (source, durationMs)
            }
            let cropped = try await AudioCropper.crop(source: source, startMs: localAudioCropStartMs, endMs: endMs)
            return (cropped, durationMs)
        }
    }

    private func copyImportedAudio(_ source: URL) throws -> URL {
        let scoped = source.startAccessingSecurityScopedResource()
        defer {
            if scoped {
                source.stopAccessingSecurityScopedResource()
            }
        }
        let directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("AlarmAudioImports", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let ext = source.pathExtension.isEmpty ? "m4a" : source.pathExtension
        let destination = directory.appendingPathComponent("alarm-import-\(UUID().uuidString).\(ext)")
        try FileManager.default.copyItem(at: source, to: destination)
        return destination
    }

    private func readAudioDurationMs(_ url: URL) async throws -> Int {
        let asset = AVURLAsset(url: url, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
        let duration = try await asset.load(.duration)
        let seconds = CMTimeGetSeconds(duration)
        guard seconds.isFinite, seconds > 0 else {
            throw LocalAlarmAudioError.invalidDuration
        }
        return Int((seconds * 1000).rounded())
    }

    private func nonEmpty(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private func localAudioUploadDisplayName(for url: URL) -> String {
        switch localAudioMode {
        case .record:
            return "alarm-recording.m4a"
        case .file:
            if let name = selectedLocalAudioName?.trimmingCharacters(in: .whitespacesAndNewlines),
               !name.isEmpty {
                return name
            }
            return url.lastPathComponent.isEmpty ? "alarm-audio.m4a" : url.lastPathComponent
        }
    }

    // MARK: - Error formatting

    private func errorMessage(_ error: AlarmEditDraft.ValidationError) -> String {
        switch error {
        case .invalidHour:
            return "시간(0–23) 값이 올바르지 않아요."
        case .invalidMinute:
            return "분(0–59) 값이 올바르지 않아요."
        case .invalidRepeatDaysMask:
            return "반복 요일 값이 올바르지 않아요."
        case .invalidSnoozeMinutes:
            return "스누즈 간격은 1–30분 사이여야 해요."
        case .invalidAlarmVolume:
            return "알람 볼륨은 0–100% 사이여야 해요."
        case .invalidVoiceVolume:
            return "목소리 크기는 0–100% 사이여야 해요."
        }
    }
}

private struct CachedLocalAlarmAudio {
    let fileName: String
    let cacheKey: String
}

private struct FamilyLocalVoiceUploadSource {
    let url: URL
    let durationMs: Int
    let displayName: String
}

private enum LocalAlarmAudioError: LocalizedError {
    case missingSource
    case tooShort
    case tooLong
    case invalidDuration

    var errorDescription: String? {
        switch self {
        case .missingSource:
            return "녹음하거나 파일을 선택해 주세요."
        case .tooShort:
            return "1초 이상 들리는 음성이 필요해요."
        case .tooLong:
            return "알람 음성은 최대 \(AlarmAudioLimits.maxDurationMillis / 1000)초까지 사용할 수 있어요."
        case .invalidDuration:
            return "오디오 길이를 확인하지 못했어요."
        }
    }
}

private enum AlarmLocalAudioInputMode: String, CaseIterable, Hashable, Identifiable {
    case record
    case file

    var id: String { rawValue }

    var label: String {
        switch self {
        case .record: return "녹음"
        case .file: return "파일"
        }
    }
}

private struct LocalAlarmAudioEditor: View {
    @Binding var mode: AlarmLocalAudioInputMode
    let isRecording: Bool
    let elapsedMs: Int
    let hasRecording: Bool
    let existingAudioLabel: String?
    let fileName: String?
    let fileDurationMs: Int?
    @Binding var cropStartMs: Int
    @Binding var cropEndMs: Int
    let isPreviewing: Bool
    let message: String?
    let onModeChange: (AlarmLocalAudioInputMode) -> Void
    let onRecord: () -> Void
    let onPickFile: () -> Void
    let onPreview: () -> Void
    let onClear: () -> Void

    @Environment(\.voiceAlarmTheme) private var theme

    private var sourceReady: Bool {
        switch mode {
        case .record:
            return hasRecording || existingAudioLabel != nil
        case .file:
            return fileDurationMs != nil || existingAudioLabel != nil
        }
    }

    private var durationLabel: String {
        switch mode {
        case .record:
            return timeLabel(elapsedMs)
        case .file:
            guard let fileDurationMs else { return "0:00" }
            return timeLabel(max(0, min(cropEndMs, fileDurationMs) - cropStartMs))
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Picker("녹음/파일", selection: Binding(
                get: { mode },
                set: { onModeChange($0) }
            )) {
                ForEach(AlarmLocalAudioInputMode.allCases) { option in
                    Text(option.label).tag(option)
                }
            }
            .pickerStyle(.segmented)

            if mode == .record {
                recordingCard
            } else {
                fileCard
            }

            if sourceReady {
                HStack(spacing: 8) {
                    Button(action: onPreview) {
                        Label(isPreviewing ? "정지" : "미리듣기", systemImage: isPreviewing ? "stop.fill" : "play.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .disabled(isRecording)

                    Button(role: .destructive, action: onClear) {
                        Label("지우기", systemImage: "trash")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .disabled(isRecording)
                }
            }

            if let message {
                Text(message)
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(isRecording ? theme.palette.primary : theme.palette.onSurfaceVariant)
            }
        }
    }

    private var recordingCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(isRecording ? "녹음 중..." : (hasRecording ? "녹음을 저장했어요." : "녹음 또는 파일 업로드"))
                        .font(theme.typography.labelLarge)
                    Text("\(durationLabel) / \(timeLabel(Int(AlarmAudioLimits.maxDurationMillis)))")
                        .font(theme.typography.bodySmall)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                        .monospacedDigit()
                }
                Spacer()
                Button(action: onRecord) {
                    Image(systemName: isRecording ? "stop.fill" : "mic.fill")
                        .font(.headline)
                        .frame(width: 42, height: 42)
                }
                .buttonStyle(.borderedProminent)
                .tint(isRecording ? theme.palette.error : theme.palette.primary)
            }
            if let existingAudioLabel, !hasRecording {
                Text(existingAudioLabel)
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
            }
        }
        .padding(12)
        .background(theme.palette.surfaceVariant.opacity(0.36))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private var fileCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(fileName ?? "파일 업로드")
                        .font(theme.typography.labelLarge)
                        .lineLimit(1)
                    Text(fileDurationMs.map { "전체 \(timeLabel($0)) · 사용할 구간 \(durationLabel)" } ?? "최대 \(AlarmAudioLimits.maxDurationMillis / 1000)초")
                        .font(theme.typography.bodySmall)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                }
                Spacer()
                Button(action: onPickFile) {
                    Label("선택", systemImage: "folder")
                }
                .buttonStyle(.bordered)
            }

            if let fileDurationMs, fileDurationMs > Int(AlarmAudioLimits.maxDurationMillis) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("자를 구간 \(timeLabel(cropStartMs)) - \(timeLabel(min(cropEndMs, fileDurationMs)))")
                        .font(.caption.weight(.semibold))
                    Slider(
                        value: Binding(
                            get: { Double(cropStartMs) / 1000.0 },
                            set: { seconds in
                                let maxStart = max(0, fileDurationMs - Int(AlarmAudioLimits.maxDurationMillis))
                                cropStartMs = min(maxStart, max(0, Int(seconds * 1000)))
                                cropEndMs = min(fileDurationMs, cropStartMs + Int(AlarmAudioLimits.maxDurationMillis))
                            }
                        ),
                        in: 0...(Double(max(0, fileDurationMs - Int(AlarmAudioLimits.maxDurationMillis))) / 1000.0),
                        step: 1
                    )
                }
            }

            if let existingAudioLabel, fileDurationMs == nil {
                Text(existingAudioLabel)
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
            }
        }
        .padding(12)
        .background(theme.palette.surfaceVariant.opacity(0.36))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func timeLabel(_ millis: Int) -> String {
        let seconds = max(0, millis / 1000)
        return String(format: "%d:%02d", seconds / 60, seconds % 60)
    }
}

private struct FamilyAlarmTargetPicker: View {
    let recipients: [FamilyGroupMember]
    let selectedRecipientID: String?
    let hour: Int
    let minute: Int
    let repeatDaysMask: Int
    let holidayOff: Bool
    let onSelect: (String) -> Void

    @Environment(\.voiceAlarmTheme) private var theme

    private var selectedRecipient: FamilyGroupMember? {
        if let selectedRecipientID,
           let selected = recipients.first(where: { $0.userId == selectedRecipientID }) {
            return selected
        }
        return recipients.first
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if recipients.isEmpty {
                Text("상대가 내 알람 맞추기를 허용하면 여기에 표시돼요.")
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
            } else {
                ForEach(recipients) { recipient in
                    recipientRow(recipient, selected: recipient.userId == selectedRecipient?.userId)
                }
                if let selectedRecipient {
                    let leadTooSoon = FamilyAlarmScheduleRules.isLeadTooSoon(
                        hour: hour,
                        minute: minute,
                        repeatDaysMask: repeatDaysMask,
                        holidayOff: holidayOff
                    )
                    let quietUnavailable = FamilyAlarmScheduleRules.isTimeUnavailable(
                        member: selectedRecipient,
                        hour: hour,
                        minute: minute,
                        repeatDaysMask: repeatDaysMask
                    )
                    targetStatus(
                        blocked: leadTooSoon || quietUnavailable,
                        text: FamilyAlarmScheduleRules.targetStatusText(
                            leadTooSoon: leadTooSoon,
                            quietUnavailable: quietUnavailable
                        )
                    )
                    Text("받지 않는 시간: \(FamilyAlarmScheduleRules.quietScheduleLabel(selectedRecipient))")
                        .font(theme.typography.bodySmall)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                }
            }
        }
    }

    private func recipientRow(_ recipient: FamilyGroupMember, selected: Bool) -> some View {
        Button {
            onSelect(recipient.userId)
        } label: {
            HStack(spacing: 10) {
                Image(systemName: selected ? "checkmark.circle.fill" : "person.circle")
                    .font(.title3)
                    .foregroundStyle(selected ? theme.palette.primary : theme.palette.onSurfaceVariant)
                VStack(alignment: .leading, spacing: 2) {
                    Text(FamilyAlarmScheduleRules.memberLabel(recipient))
                        .font(theme.typography.labelLarge)
                        .foregroundStyle(theme.palette.onSurface)
                    if let email = recipient.email, !email.isEmpty {
                        Text(email)
                            .font(theme.typography.bodySmall)
                            .foregroundStyle(theme.palette.onSurfaceVariant)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(12)
            .background(selected ? theme.palette.primaryContainer.opacity(0.35) : theme.palette.surfaceVariant.opacity(0.34))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(selected ? theme.palette.primary.opacity(0.42) : theme.palette.outlineVariant.opacity(0.62), lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private func targetStatus(blocked: Bool, text: String) -> some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .foregroundStyle(blocked ? VoiceAlarmTheme.error : VoiceAlarmTheme.primaryDark)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(
                blocked ? VoiceAlarmTheme.error.opacity(0.12) : VoiceAlarmTheme.primary.opacity(0.12),
                in: Capsule()
            )
    }
}

private enum FamilyAlarmScheduleRules {
    private static let familyAlarmMinLeadMillis: Int64 = 30 * 60 * 1000

    static func memberLabel(_ member: FamilyGroupMember) -> String {
        if let name = member.name?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty {
            return name
        }
        if let email = member.email?.trimmingCharacters(in: .whitespacesAndNewlines), !email.isEmpty {
            return email
        }
        return "멤버"
    }

    static func quietScheduleLabel(_ member: FamilyGroupMember) -> String {
        quietWindows(member).map { window in
            "\(quietDaysLabel(window.days)) \(window.start)-\(window.end)"
        }.joined(separator: " · ")
    }

    static func targetStatusText(leadTooSoon: Bool, quietUnavailable: Bool) -> String {
        if leadTooSoon { return "지금부터 30분 뒤 알람부터 설정할 수 있어요." }
        if quietUnavailable { return "상대가 이 시간에는 알람을 받지 않도록 해뒀어요." }
        return "설정 가능"
    }

    static func isLeadTooSoon(
        hour: Int,
        minute: Int,
        repeatDaysMask: Int,
        holidayOff: Bool,
        nowMillis: Int64 = Int64(Date().timeIntervalSince1970 * 1000)
    ) -> Bool {
        let fireAtMillis = (try? AlarmTimeCalculator.nextFireAtMillis(
            hour: hour,
            minute: minute,
            repeatDaysMask: repeatDaysMask,
            holidayOff: holidayOff,
            nowMillis: nowMillis
        )) ?? LocalAlarmRecord.fallbackFireAtMillis(
            hour: hour,
            minute: minute,
            referenceMillis: nowMillis
        )
        return fireAtMillis - nowMillis < familyAlarmMinLeadMillis
    }

    static func isTimeUnavailable(
        member: FamilyGroupMember,
        hour: Int,
        minute: Int,
        repeatDaysMask: Int,
        nowMillis: Int64 = Int64(Date().timeIntervalSince1970 * 1000)
    ) -> Bool {
        let dayIndices = targetDayIndices(hour: hour, minute: minute, repeatDaysMask: repeatDaysMask, nowMillis: nowMillis)
        return quietWindows(member).contains { window in
            dayIndices.contains { dayIndex in blocks(window: window, dayIndex: dayIndex, hour: hour, minute: minute) }
        }
    }

    private static func quietWindows(_ member: FamilyGroupMember) -> [FamilyAlarmQuietWindow] {
        let fallback = FamilyAlarmQuietWindow(
            days: safeQuietDays(member.familyAlarmQuietDays),
            start: safeQuietTime(member.familyAlarmQuietStart, fallback: "09:00"),
            end: safeQuietTime(member.familyAlarmQuietEnd, fallback: "18:30")
        )
        let windows = (member.familyAlarmQuietWindows ?? []).compactMap { window -> FamilyAlarmQuietWindow? in
            let start = safeQuietTime(window.start, fallback: "")
            let end = safeQuietTime(window.end, fallback: "")
            guard !start.isEmpty, !end.isEmpty else { return nil }
            return FamilyAlarmQuietWindow(days: safeQuietDays(window.days), start: start, end: end)
        }
        return windows.isEmpty ? [fallback] : windows
    }

    private static func targetDayIndices(hour: Int, minute: Int, repeatDaysMask: Int, nowMillis: Int64) -> [Int] {
        if repeatDaysMask != 0 {
            return (0...6).filter { repeatDaysMask & (1 << $0) != 0 }
        }
        let fireAt = (try? AlarmTimeCalculator.nextFireAtMillis(
            hour: hour,
            minute: minute,
            repeatDaysMask: 0,
            nowMillis: nowMillis
        )) ?? LocalAlarmRecord.fallbackFireAtMillis(hour: hour, minute: minute, referenceMillis: nowMillis)
        let date = Date(timeIntervalSince1970: TimeInterval(fireAt) / 1000.0)
        return [(Calendar.current.component(.weekday, from: date) - 1) % 7]
    }

    private static func blocks(window: FamilyAlarmQuietWindow, dayIndex: Int, hour: Int, minute: Int) -> Bool {
        guard safeQuietDays(window.days).contains(dayIndex),
              let start = parseQuietTime(window.start),
              let end = parseQuietTime(window.end) else {
            return false
        }
        let target = hour * 60 + minute
        if start <= end {
            return target >= start && target < end
        }
        return target >= start || target < end
    }

    private static func parseQuietTime(_ value: String) -> Int? {
        let parts = value.split(separator: ":")
        guard parts.count >= 2,
              let hour = Int(parts[0]),
              let minute = Int(parts[1]),
              (0...23).contains(hour),
              (0...59).contains(minute) else {
            return nil
        }
        return hour * 60 + minute
    }

    private static func safeQuietDays(_ days: [Int]?) -> [Int] {
        let normalized = Array(Set(days?.filter { (0...6).contains($0) } ?? [])).sorted()
        return normalized.isEmpty ? [1, 2, 3, 4, 5] : normalized
    }

    private static func safeQuietTime(_ value: String?, fallback: String) -> String {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? fallback : trimmed
    }

    private static func quietDaysLabel(_ days: [Int]) -> String {
        let sorted = Array(Set(days)).sorted()
        switch sorted {
        case []:
            return "없음"
        case [1, 2, 3, 4, 5]:
            return "평일"
        case [0, 6]:
            return "주말"
        case [0, 1, 2, 3, 4, 5, 6]:
            return "매일"
        default:
            let labels = ["일", "월", "화", "수", "목", "금", "토"]
            return sorted.map { labels[max(0, min(6, $0))] }.joined(separator: ",")
        }
    }
}

private struct EditorLanguageOption: Identifiable {
    let code: String
    let label: String
    var id: String { code }
}

private let ttsLanguages: [EditorLanguageOption] = [
    .init(code: "ko", label: "한국어"),
    .init(code: "en", label: "영어"),
    .init(code: "ja", label: "일본어")
]

private let ttsTranslationLanguages: [EditorLanguageOption] = [
    .init(code: "ko", label: "한국어"),
    .init(code: "en", label: "영어"),
    .init(code: "ja", label: "일본어"),
    .init(code: "fr", label: "프랑스어"),
    .init(code: "it", label: "이탈리아어")
]

private struct ManualVoiceMessageEditor: View {
    @Binding var text: String
    @Binding var translationEnabled: Bool
    @Binding var language: String
    let onInvalidatePreparedAudio: () -> Void

    @Environment(\.voiceAlarmTheme) private var theme

    private var limitedText: Binding<String> {
        Binding(
            get: { text },
            set: { newValue in
                text = String(newValue.prefix(200))
                onInvalidatePreparedAudio()
            }
        )
    }

    private var translationToggle: Binding<Bool> {
        Binding(
            get: { translationEnabled },
            set: { enabled in
                translationEnabled = enabled
                if enabled && language == "ko" {
                    language = "en"
                } else if !enabled {
                    language = "ko"
                }
                onInvalidatePreparedAudio()
            }
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack {
                Text("직접 입력")
                    .font(theme.typography.titleSmall)
                Spacer()
                Text("\(text.count)/200")
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
                    .monospacedDigit()
            }

            ZStack(alignment: .topLeading) {
                if text.isEmpty {
                    Text("알람에서 들려줄 음성 메시지를 입력해 주세요")
                        .font(theme.typography.bodyMedium)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 8)
                }
                TextEditor(text: limitedText)
                    .frame(minHeight: 86)
                    .scrollContentBackground(.hidden)
                    .background(Color.clear)
            }
            .padding(8)
            .background(theme.palette.surfaceVariant.opacity(0.36))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(theme.palette.outlineVariant.opacity(0.62), lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

            VStack(alignment: .leading, spacing: 8) {
                Toggle("번역", isOn: translationToggle)
                    .tint(theme.palette.primary)
                if translationEnabled {
                    Picker("번역 언어", selection: Binding(
                        get: { language },
                        set: { newValue in
                            language = newValue
                            onInvalidatePreparedAudio()
                        }
                    )) {
                        ForEach(ttsTranslationLanguages) { option in
                            Text(option.label).tag(option.code)
                        }
                    }
                    .pickerStyle(.menu)
                } else {
                    Text("사용 안 함")
                        .font(theme.typography.bodySmall)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                }
            }
            .padding(12)
            .background(theme.palette.surfaceVariant.opacity(0.34))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
    }
}

private struct VoiceRepeatEditor: View {
    @Binding var repeatVoice: Bool
    @Environment(\.voiceAlarmTheme) private var theme

    init(isRepeating repeatVoice: Binding<Bool>) {
        self._repeatVoice = repeatVoice
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("반복 재생")
                .font(theme.typography.titleSmall)
            HStack(spacing: 8) {
                repeatButton("한 번만", selected: !repeatVoice) {
                    repeatVoice = false
                }
                repeatButton("반복", selected: repeatVoice) {
                    repeatVoice = true
                }
            }
        }
    }

    private func repeatButton(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(theme.typography.labelLarge)
                .fontWeight(.semibold)
                .foregroundStyle(selected ? theme.palette.onPrimaryContainer : theme.palette.onSurface)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 11)
                .background(selected ? theme.palette.primaryContainer : theme.palette.surfaceVariant.opacity(0.44))
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

private struct VoiceVolumeEditor: View {
    @Binding var volumePercent: Int
    @Environment(\.voiceAlarmTheme) private var theme

    private var volumeBinding: Binding<Double> {
        Binding(
            get: { Double(max(30, min(100, volumePercent))) },
            set: { volumePercent = max(30, min(100, Int($0.rounded()))) }
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("목소리 크기")
                    .font(theme.typography.titleSmall)
                Spacer()
                Text("\(max(30, min(100, volumePercent)))%")
                    .font(theme.typography.labelLarge)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
                    .monospacedDigit()
            }
            Slider(value: volumeBinding, in: 30...100, step: 10)
                .tint(theme.palette.primary)
        }
    }
}

private extension VoiceProfile {
    var isReadyForAlarmSelection: Bool {
        (status == nil || status == "ready") && isDraft != true
    }
}

private extension FamilyVoiceProfile {
    var isReadyForAlarmSelection: Bool {
        (status == nil || status == "ready") && isShared != false
    }
}

private struct AlarmVoiceProfilePicker: View {
    let ownProfiles: [VoiceProfile]
    let familyVoices: [FamilyVoiceProfile]
    let selectedProfileID: String?
    let onSelectOwn: (VoiceProfile) -> Void
    let onSelectShared: (FamilyVoiceProfile) -> Void

    @Environment(\.voiceAlarmTheme) private var theme

    var body: some View {
        let readyOwnProfiles = ownProfiles.filter(\.isReadyForAlarmSelection)
        let readyFamilyVoices = familyVoices.filter(\.isReadyForAlarmSelection)
        VStack(alignment: .leading, spacing: 8) {
            if readyOwnProfiles.isEmpty && readyFamilyVoices.isEmpty {
                Text("사용할 수 있는 목소리가 없어요. 먼저 목소리를 만들어 주세요.")
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                    .background(theme.palette.surfaceVariant.opacity(0.44))
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            } else {
                ForEach(readyOwnProfiles) { profile in
                    voiceRow(
                        name: profile.name,
                        detail: profile.isShared == true ? "내 목소리 · 공유 중" : "내 목소리",
                        selected: profile.id == selectedProfileID,
                        badge: nil,
                        action: { onSelectOwn(profile) }
                    )
                }
                ForEach(readyFamilyVoices) { profile in
                    voiceRow(
                        name: profile.name,
                        detail: profile.sharedFromLabel,
                        selected: profile.id == selectedProfileID,
                        badge: nil,
                        action: { onSelectShared(profile) }
                    )
                }
            }
        }
    }

    private func voiceRow(
        name: String,
        detail: String,
        selected: Bool,
        badge: String?,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: selected ? "checkmark.circle.fill" : "mic.circle")
                    .font(.title3)
                    .foregroundStyle(selected ? theme.palette.primary : theme.palette.onSurfaceVariant)
                VStack(alignment: .leading, spacing: 2) {
                    Text(name)
                        .font(theme.typography.labelLarge)
                        .foregroundStyle(theme.palette.onSurface)
                    Text(detail)
                        .font(theme.typography.bodySmall)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                }
                Spacer(minLength: 0)
                if let badge {
                    Text(badge)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(theme.palette.primary)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(theme.palette.primaryContainer.opacity(0.55))
                        .clipShape(Capsule())
                }
            }
            .padding(12)
            .background(selected ? theme.palette.primaryContainer.opacity(0.35) : theme.palette.surfaceVariant.opacity(0.34))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(selected ? theme.palette.primary.opacity(0.42) : theme.palette.outlineVariant.opacity(0.62), lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

private struct SharedVoiceSelectionSetupSheet: View {
    let profile: FamilyVoiceProfile
    let isWorking: Bool
    let onCancel: () -> Void
    let onPreview: () -> Void
    let onConfirm: (String, String) -> Void

    @State private var relationshipSelection = VoiceRelationshipSelection()
    @State private var listenerTitle: String = ""
    @State private var submitted = false

    private var trimmedRelationship: String {
        relationshipSelection.resolved
    }

    private var trimmedListener: String {
        listenerTitle.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("공유받은 목소리 설정")
                        .font(.title3.weight(.bold))
                    Text("알람에서 이 목소리가 나를 어떻게 부를지 정해요.")
                        .font(.subheadline)
                        .foregroundStyle(VoiceAlarmTheme.textSecondary)
                }
                Spacer()
                Button(action: onCancel) {
                    Image(systemName: "xmark")
                        .foregroundStyle(VoiceAlarmTheme.textSecondary)
                }
                .buttonStyle(.plain)
            }

            HStack(spacing: 12) {
                Image(systemName: "mic.circle.fill")
                    .font(.system(size: 40))
                    .foregroundStyle(VoiceAlarmTheme.secondary)
                VStack(alignment: .leading, spacing: 3) {
                    Text(profile.name)
                        .font(.headline)
                    Text(profile.sharedFromLabel)
                        .font(.caption)
                        .foregroundStyle(VoiceAlarmTheme.textSecondary)
                }
                Spacer(minLength: 0)
            }
            .padding(14)
            .background(VoiceAlarmTheme.surfaceVariant.opacity(0.55))
            .overlay(
                RoundedRectangle(cornerRadius: 16).stroke(VoiceAlarmTheme.outline, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 16))

            VoiceRelationshipInputField(
                selection: $relationshipSelection,
                submitted: submitted
            )
            field(
                title: "이 목소리가 나를 부를 이름",
                placeholder: "예: 지호야, 여보",
                text: $listenerTitle,
                showError: submitted && trimmedListener.isEmpty
            )
            VoiceListenerPreviewCard(
                listenerTitle: listenerTitle,
                relationshipLabel: trimmedRelationship
            )

            Button(action: onPreview) {
                Label("미리듣기", systemImage: "play.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .disabled(isWorking)

            Button("저장하고 선택") {
                submitted = true
                if !trimmedRelationship.isEmpty && !trimmedListener.isEmpty {
                    onConfirm(trimmedRelationship, trimmedListener)
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(VoiceAlarmTheme.primary)
            .frame(maxWidth: .infinity)
            .disabled(isWorking)

            Spacer(minLength: 0)
        }
        .padding(20)
        .onAppear {
            relationshipSelection = parseVoiceRelationshipLabel(profile.relationshipLabel)
            listenerTitle = profile.listenerTitle ?? ""
        }
    }

    private func field(
        title: String,
        placeholder: String,
        text: Binding<String>,
        showError: Bool
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(VoiceAlarmTheme.textSecondary)
            TextField(placeholder, text: text)
                .textFieldStyle(.roundedBorder)
                .onChange(of: text.wrappedValue) { _, newValue in
                    if newValue.count > 30 {
                        text.wrappedValue = String(newValue.prefix(30))
                    }
                }
            if showError {
                Text("꼭 입력해 주세요.")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(VoiceAlarmTheme.error)
            }
        }
    }
}

#if DEBUG
#Preview("AlarmEditorSheet — create (light)") {
    NavigationStack {
        AlarmEditorSheet(
            target: .create(),
            onClose: {},
            onJumpToVoices: {},
            onSchedulingDidFinish: {}
        )
    }
    .voiceAlarmPreviewEnvironment()
}

#Preview("AlarmEditorSheet — create (dark)") {
    NavigationStack {
        AlarmEditorSheet(
            target: .create(),
            onClose: {},
            onJumpToVoices: {},
            onSchedulingDidFinish: {}
        )
    }
    .preferredColorScheme(.dark)
    .voiceAlarmPreviewEnvironment()
}

#Preview("AlarmEditorSheet — edit existing") {
    NavigationStack {
        AlarmEditorSheet(
            target: .edit("preview-existing"),
            onClose: {},
            onJumpToVoices: {},
            onSchedulingDidFinish: {}
        )
    }
    .voiceAlarmPreviewEnvironment()
}
#endif
