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
                                TextField("국가 또는 지역", text: $voiceStudio.weatherCountry)
                                    .textInputAutocapitalization(.never)
                                    .disableAutocorrection(true)
                                TextField("도시", text: $voiceStudio.weatherCity)
                                    .textInputAutocapitalization(.never)
                                    .disableAutocorrection(true)
                                if !voiceStudio.hasWeatherInfo {
                                    Text("날씨가 들어간 문구를 쓰려면 지역을 입력해 주세요.")
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
                                Picker("성별", selection: $voiceStudio.fortuneGender) {
                                    Text("선택").tag("")
                                    Text("남성").tag("남성")
                                    Text("여성").tag("여성")
                                }
                                .pickerStyle(.segmented)
                                TextField("생년월일 (YYYY-MM-DD)", text: $voiceStudio.fortuneBirthDate)
                                    .keyboardType(.numbersAndPunctuation)
                                TextField("태어난 시간 (HH:mm)", text: $voiceStudio.fortuneBirthTime)
                                    .keyboardType(.numbersAndPunctuation)
                                if !voiceStudio.hasFortuneInfo {
                                    Text("운세가 들어간 문구를 쓰려면 성별, 생년월일, 태어난 시간이 필요해요.")
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
        .scrollContentBackground(.hidden)
        .background(theme.palette.background)
        .navigationTitle(target.editingAlarmID == nil ? "알람 만들기" : "알람 수정")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("닫기") { onClose() }
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
            Task { await voiceStudio.refresh(session: auth.session) }
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

    private var activePromptContext: RandomPromptContext {
        RandomPromptContext.normalized(voiceStudio.randomContext)
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

        if draft.playMode != .alarmOnly && voiceStudio.preparedAlarm == nil {
            voiceStudio.statusMessage = "음성 알람은 먼저 목소리와 깨워줄 말을 생성해야 해요."
            onJumpToVoices()
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
            alarmMinute: draft.minute
        )
        if prepared != nil {
            await saveFlow()
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
                        badge: profile.requiresViewerInfo ? "설정 필요" : nil,
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

    @State private var relationship: String = ""
    @State private var listenerTitle: String = ""
    @State private var submitted = false

    private var trimmedRelationship: String {
        relationship.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var trimmedListener: String {
        listenerTitle.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("목소리 설정")
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

            field(
                title: "나와의 관계",
                placeholder: "예: 손주, 자식, 형제",
                text: $relationship,
                showError: submitted && trimmedRelationship.isEmpty
            )
            field(
                title: "이 목소리가 나를 부를 이름",
                placeholder: "예: 지호야, 여보",
                text: $listenerTitle,
                showError: submitted && trimmedListener.isEmpty
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
            relationship = profile.relationshipLabel ?? ""
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
