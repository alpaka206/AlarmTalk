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
                VoicePlayModePicker(mode: $draft.playMode)
                    .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16))

                if draft.playMode != .alarmOnly {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("선택한 음성")
                            .font(theme.typography.titleSmall)
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
        }
    }

    private var saveButtonTitle: String {
        target.editingAlarmID == nil ? "저장" : "수정 저장"
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
        } else {
            draft = .newDefault()
        }
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

        if draft.playMode != .alarmOnly && voiceStudio.preparedAlarm == nil {
            voiceStudio.statusMessage = "음성 알람은 먼저 목소리와 깨워줄 말을 생성해야 해요."
            onJumpToVoices()
            return
        }

        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let existing = target.editingAlarmID.flatMap { id in
            store.alarms.first { $0.id == id }
        }

        // 기존 record 가 있으면 우선 cancel — alarmKit ID 가 stale 해지지 않게.
        if let existing {
            await alarmKit.cancel(record: existing, store: store)
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
        if let prepared = voiceStudio.preparedAlarm, draft.playMode != .alarmOnly {
            merged.voiceSource = VoiceSource.serverTts.rawValue
            merged.localAudioUri = prepared.localAudioFileName
            merged.rawAudioUri = prepared.rawAudioURL ?? merged.rawAudioUri
            merged.voiceProfileId = prepared.voiceProfileID
            merged.voiceText = prepared.text
            merged.voiceLanguage = prepared.language
            merged.ttsMessageId = prepared.messageID
        }

        store.upsert(merged)
        await alarmKit.schedule(record: merged, store: store)
        onSchedulingDidFinish()
    }

    private func generateVoiceAndSave() async {
        let prepared = await voiceStudio.generateTTS(session: auth.session)
        if prepared != nil {
            await saveFlow()
        }
    }

    private func scheduleOneMinuteTest() async {
        await alarmKit.scheduleOneMinuteTest(store: store)
        onSchedulingDidFinish()
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
