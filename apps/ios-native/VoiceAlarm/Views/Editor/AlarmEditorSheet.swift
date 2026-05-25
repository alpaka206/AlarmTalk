import SwiftUI

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

    @StateObject private var holidayStore = HolidayStore()

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
                    .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16))

                if draft.playMode != .alarmOnly {
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

                    Toggle("랜덤 깨움말 생성", isOn: $voiceStudio.randomPrompt)
                        .tint(theme.palette.primary)
                    if voiceStudio.randomPrompt {
                        Picker("랜덤 컨텍스트", selection: $voiceStudio.randomContext) {
                            ForEach(RandomPromptContext.alarmEditorCases, id: \.rawValue) { context in
                                Text(context.label).tag(context.rawValue)
                            }
                        }
                        .pickerStyle(.menu)
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
                    }
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

                if draft.playMode != .alarmOnly {
                    Button {
                        Task { await generateVoiceAndSave() }
                    } label: {
                        Label("음성 생성 후 저장", systemImage: "sparkles")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .disabled(voiceStudio.isBusy || isWorking)
                }

                if !target.familyAlarmMode {
                    Button {
                        Task { await scheduleOneMinuteTest() }
                    } label: {
                        Label("1분 테스트", systemImage: "timer")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .disabled(isWorking)
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
        !PlanTier.from(auth.session?.user.plan).meetsOrExceeds(.personal)
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
            if voicePlanLocked && draft.playMode != .alarmOnly {
                draft.playMode = .alarmOnly
            }
            loadVoicePromptState(from: alarm)
        } else {
            draft = .newDefault(defaultPlayMode: defaultPlayModeForPlan)
            loadVoicePromptState(from: nil)
            selectDefaultFamilyRecipientIfNeeded()
        }
    }

    private func loadVoicePromptState(from alarm: LocalAlarmRecord?) {
        let saved = savedPromptPreferences()
        voiceStudio.randomPrompt = alarm?.voiceRandomPrompt ?? false
        voiceStudio.randomContext = RandomPromptContext.normalized(alarm?.voiceRandomContext).rawValue
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

        let familyRecipient = target.familyAlarmMode ? validateFamilyAlarmTarget() : nil
        if target.familyAlarmMode && familyRecipient == nil {
            return
        }

        if draft.playMode != .alarmOnly && voiceStudio.preparedAlarm == nil {
            voiceStudio.statusMessage = "음성 알람은 먼저 목소리와 깨워줄 말을 생성해야 해요."
            return
        }

        if let familyRecipient {
            await createFamilyTargetAlarm(recipient: familyRecipient)
            return
        }

        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let existing = target.editingAlarmID.flatMap { id in
            store.alarms.first { $0.id == id }
        }

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
        if let prepared = voiceStudio.preparedAlarm, draft.playMode != .alarmOnly {
            merged.voiceSource = VoiceSource.serverTts.rawValue
            merged.localAudioUri = prepared.localAudioFileName
            merged.audioCacheKey = prepared.audioCacheKey
            merged.rawAudioUri = prepared.rawAudioURL ?? merged.rawAudioUri
            merged.voiceProfileId = prepared.voiceProfileID
            merged.voiceText = prepared.text
            merged.voiceLanguage = prepared.language
            merged.ttsMessageId = prepared.messageID
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

    private func createFamilyTargetAlarm(recipient: FamilyGroupMember) async {
        guard let token = auth.session?.token else {
            validationAlert = ValidationAlertContent(title: "로그인이 필요해요", message: "상대 알람은 로그인 후 사용할 수 있어요.")
            return
        }
        do {
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

    private func scheduleOneMinuteTest() async {
        await alarmKit.scheduleOneMinuteTest(store: store)
        onSchedulingDidFinish()
    }

    private func nonEmpty(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    // MARK: - Error formatting

    private func errorMessage(_ error: AlarmEditDraft.ValidationError) -> String {
        switch error {
        case .emptyLabel:
            return "알람 이름을 입력해 주세요."
        case .invalidHour:
            return "시간(0–23) 값이 올바르지 않아요."
        case .invalidMinute:
            return "분(0–59) 값이 올바르지 않아요."
        case .invalidSnoozeMinutes:
            return "스누즈 간격은 1–30분 사이여야 해요."
        }
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

private struct AlarmVoiceProfilePicker: View {
    let ownProfiles: [VoiceProfile]
    let familyVoices: [FamilyVoiceProfile]
    let selectedProfileID: String?
    let onSelectOwn: (VoiceProfile) -> Void
    let onSelectShared: (FamilyVoiceProfile) -> Void

    @Environment(\.voiceAlarmTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if ownProfiles.isEmpty && familyVoices.isEmpty {
                Text("사용할 수 있는 목소리가 없어요. 먼저 목소리를 만들어 주세요.")
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                    .background(theme.palette.surfaceVariant.opacity(0.44))
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            } else {
                ForEach(ownProfiles) { profile in
                    voiceRow(
                        name: profile.name,
                        detail: profile.isShared == true ? "내 목소리 · 공유 중" : "내 목소리",
                        selected: profile.id == selectedProfileID,
                        badge: nil,
                        action: { onSelectOwn(profile) }
                    )
                }
                ForEach(familyVoices) { profile in
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
