import AVFoundation
import SwiftUI
import UIKit
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
    @EnvironmentObject var auth: AuthViewModel
    @EnvironmentObject var store: LocalAlarmStore
    @EnvironmentObject var alarmKit: AlarmKitViewModel
    @EnvironmentObject var remoteSync: RemoteAlarmSyncViewModel
    @EnvironmentObject var voiceStudio: VoiceStudioViewModel
    @EnvironmentObject var socialFeatures: SocialFeatureViewModel
    @EnvironmentObject var subscriptions: SubscriptionManager

    @StateObject var holidayStore = HolidayStore()
    @StateObject var localRecorder = VoiceRecorder()
    /// 에디터의 단일 미리듣기 플레이어(change 4). 기존의 두 플레이어
    /// (voiceStudio.previewPlayer 사용분 + localPreviewPlayer)와 previewingStockMessageID
    /// 를 이 하나 + previewTarget 으로 통합한다. voiceStudio.previewPlayer 는 에디터
    /// 밖(VoiceProfileManagementPanel 등) VM 소유 미리듣기 전용으로 그대로 남는다.
    @StateObject var editorPreviewPlayer = AudioPreviewPlayer()

    @Environment(\.voiceAlarmTheme) var theme

    /// 부모(MainTabsView)가 넘기는 target — 새 알람 vs 기존 알람 수정 구분.
    let target: AlarmEditorTarget
    /// 시트 닫기.
    let onClose: () -> Void
    /// 사용자가 "음성 탭에서 만들기" 버튼을 누른 경우 부모가 탭 전환을 처리.
    let onJumpToVoices: () -> Void
    /// 저장 완료 후 알람 탭으로 전환.
    let onSchedulingDidFinish: () -> Void

    // MARK: - Form state

    @State var draft: AlarmEditDraft = .newDefault()
    @State var didLoadInitial = false
    @State var validationAlert: ValidationAlertContent?
    @State var duplicateAlarmConfirm: DuplicateAlarmConfirmContent?
    @State var isWorking = false
    @State var sharedVoiceSetupTarget: FamilyVoiceProfile?
    @State var selectedFamilyRecipientID: String?
    @State var voiceSourceMode: VoiceSource = .ttsProfile
    @State var localAudioMode: AlarmLocalAudioInputMode = .record
    @State var localAudioMessage: String?
    @State var localAudioFileImporterPresented = false
    @State var selectedLocalAudioURL: URL?
    @State var selectedLocalAudioName: String?
    @State var selectedLocalAudioDurationMs: Int?
    @State var localAudioCropStartMs = 0
    @State var localAudioCropEndMs = Int(AlarmAudioLimits.maxDurationMillis)
    @State var clearExistingLocalAudio = false
    @State var usageGuidePresented = false
    /// 선택/미리듣기 중인 스톡 클립의 messageId. StockClipPicker 의 선택 표시에 사용.
    @State var stockSelectedMessageID: String?
    /// 현재 활성 미리듣기 대상(단일 진실 공급원, change 4). 스톡 클립 미리듣기 id 는
    /// `.stockClip(id)` 의 연관 값이 들고 있어 previewingStockMessageID 를 대체한다.
    @State var previewTarget: AudioPreviewTarget?

    /// StockClipPicker 에 넘길 "실제 선택된" 스톡 클립 id. 여러 onChange 훅이
    /// `voiceStudio.preparedAlarm = nil` 만 호출하고 stockSelectedMessageID 를 비우지
    /// 않으면 준비된 음원 없이 체크표시만 남는다. 선택 표시를 prepared 음원에 종속시켜
    /// (stock_ prefix 로 스톡 여부 확인) preparedAlarm 이 무효화되면 체크가 자동으로
    /// 사라지게 한다. 매 call site 에서 stockSelectedMessageID 를 비우는 것을 잊는
    /// 실수를 원천 차단한다.
    @State var suppressProfileChangeInvalidation = false
    @State var ttsProfileChangedDuringEdit = false
    var selectedStockMessageID: String? {
        guard let prepared = voiceStudio.preparedAlarm,
              prepared.audioCacheKey.hasPrefix("stock_") else {
            return nil
        }
        return prepared.messageID
    }

    /// 현재 미리듣기/준비 중인 스톡 클립의 messageId(이전 previewingStockMessageID 대체).
    /// previewTarget 이 `.stockClip(id)` 일 때만 값이 있다.
    var previewingStockClipID: String? {
        if case let .stockClip(id) = previewTarget { return id }
        return nil
    }

    static let familyAlarmMinLeadMillis: Int64 = 30 * 60 * 1000

    struct ValidationAlertContent: Identifiable {
        let id = UUID()
        let title: String
        let message: String
    }

    /// 같은 시각 알람 교체 확인 모달의 내용. merged/existing 은 동의 시 저장을 마무리하는 데 쓴다.
    struct DuplicateAlarmConfirmContent: Identifiable {
        let id = UUID()
        let timeLabel: String
        let existingLabel: String?
        let merged: LocalAlarmRecord
        let existing: LocalAlarmRecord?
        let conflicts: [LocalAlarmRecord]
    }

    var body: some View {
        Form {
            Section {
                TimeWheelPicker(hour: $draft.hour, minute: $draft.minute)
                    .frame(maxWidth: .infinity)
                    .listRowInsets(EdgeInsets(top: 12, leading: 8, bottom: 12, trailing: 8))
                    .listRowBackground(Color.clear)
            }

            Section("반복") {
                Text(repeatSummary)
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 0, trailing: 16))
                    .accessibilityLabel(Text("반복 \(repeatSummary)"))
                RepeatWeekdayChips(mask: $draft.repeatDaysMask)
                    .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16))
                // Android `ScheduleDetailsCard` 와 동일: 반복 요일이 하나라도 선택됐을 때만
                // 공휴일off 토글을 노출한다(미선택 시 dimmed 가 아니라 통째로 숨김).
                if draft.repeatDaysMask != 0 {
                    HolidayOffToggle(
                        isOn: $draft.holidayOff,
                        enabled: true
                    )

                    if draft.holidayOff {
                        VStack(alignment: .leading, spacing: 6) {
                            // Android 와 동일: 보조 색(onSurfaceVariant), '설정에서 변경' 어포던스 없음.
                            Text("공휴일 달력: \(HolidayCountryFlag.emoji(for: holidayStore.selectedCountryCode)) \(HolidayStore.localizedCountryName(holidayStore.selectedCountryCode))")
                                .font(theme.typography.bodySmall)
                                .foregroundStyle(theme.palette.onSurfaceVariant)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            HolidayUpcomingList(
                                countryCode: holidayStore.selectedCountryCode,
                                holidayStore: holidayStore
                            )
                        }
                        .padding(.top, 2)
                    }
                }

                // 알람 이름 필드는 반복 선택 바로 아래에 둔다 (Android ScheduleDetailsCard:
                // RepeatSelector 다음에 라벨 입력). 플로팅 라벨(editor_label_alarm_name) +
                // placeholder(editor_placeholder_alarm_name) 를 모두 노출한다.
                VStack(alignment: .leading, spacing: 6) {
                    Text("알람 이름")
                        .font(theme.typography.titleSmall)
                    TextField("예: 출근 준비", text: $draft.label)
                        .textInputAutocapitalization(.never)
                        .disableAutocorrection(true)
                        .submitLabel(.done)
                }
                .padding(.top, 2)
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

            alarmModeSection

            Section("스누즈") {
                Toggle("스누즈 허용", isOn: $draft.snoozeEnabled)
                    .tint(theme.palette.primary)

                if draft.snoozeEnabled {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("간격")
                            .font(theme.typography.titleSmall)
                        // Android `AlarmSnoozeSettings.kt` SnoozeIntervals(5/10/15/30) +
                        // 직접 설정. 백엔드 계약(snooze_minutes 1–30)에 맞춰 직접 입력은 30 으로 캡한다.
                        SnoozeIntervalPicker(minutes: $draft.snoozeMinutes)
                    }
                    .padding(.vertical, 4)

                    VStack(alignment: .leading, spacing: 8) {
                        Text("최대 반복 횟수")
                            .font(theme.typography.titleSmall)
                        SnoozeRepeatLimitPicker(limit: $draft.snoozeRepeatLimit)
                    }
                    .padding(.vertical, 4)
                }
            }

            Section("사운드 & 진동") {
                if draft.showsAlarmSoundControls {
                    // 알람음 on/off (Android `AlarmSettingsCard.kt:160-167` alarmVolumePercent>0 Switch;
                    // 켜면 100, 끄면 0). iOS 는 AlarmKit 이 OS 알람 톤을 소유해 커스텀 링톤
                    // 선택 API 가 없으므로, 사운드 종류는 '기본 알람음' 라벨로만 노출한다.
                    Toggle("알람음", isOn: alarmSoundEnabledBinding)
                        .tint(theme.palette.primary)
                    if draft.alarmVolumePercent > 0 {
                        HStack {
                            Text("알람음 종류")
                                .font(theme.typography.titleSmall)
                            Spacer()
                            Text(alarmSoundDisplayLabel)
                                .font(theme.typography.bodyMedium)
                                .foregroundStyle(theme.palette.onSurfaceVariant)
                        }
                        AlarmVolumeSlider(volume: alarmVolumeDecileBinding)
                    }
                }

                // 진동 on/off (Android `AlarmSettingsCard.kt:143-147` vibrationPattern != NONE Switch;
                // 켜면 default, 끄면 none). '없음' 은 패턴 목록에서 빼고 이 토글이 대신한다.
                Toggle("진동", isOn: vibrationEnabledBinding)
                    .tint(theme.palette.primary)
                if draft.vibrationPattern != .none {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text("진동 패턴")
                                .font(theme.typography.titleSmall)
                            Spacer()
                            VibrationPatternPicker(selected: $draft.vibrationPattern)
                        }
                        // 캡션은 picker 컨트롤 밖, 행 아래 전체 너비로 배치해 HStack 안에서
                        // 어색하게 줄바꿈되는 문제를 없앤다.
                        Text(VibrationPatternPicker.usageCaption)
                            .font(theme.typography.bodySmall)
                            .foregroundStyle(theme.palette.onSurfaceVariant)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }

            Section {
                // 사전 게이트: 정말로 만족 불가능한 상태면 사유를 보여주고 버튼을 막는다.
                if let reason = editorSaveBlockedReason {
                    Text(reason)
                        .font(theme.typography.bodySmall)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else if let status = voiceStudio.statusMessage, voiceStudio.preparedAlarm == nil, !voiceStudio.isBusy {
                    // 생성 실패 등의 결과 메시지(mapVoiceError)는 statusMessage 가 나른다.
                    // prepared 음원이 없고 생성 중도 아닐 때만 노출해, 캐시 미스 생성 실패가
                    // 명확히 보이게 한다(RISK A).
                    Text(status)
                        .font(theme.typography.bodySmall)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                Button {
                    Task { await saveFlow() }
                } label: {
                    if voiceStudio.isBusy {
                        HStack(spacing: 8) {
                            ProgressView()
                            Text("음성 만드는 중…")
                        }
                        .frame(maxWidth: .infinity)
                    } else {
                        Label(saveButtonTitle, systemImage: "calendar.badge.plus")
                            .frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(theme.palette.primary)
                .disabled(isWorking || voiceStudio.isBusy || editorSaveBlockedReason != nil)
            }
        }
        .scrollContentBackground(.hidden)
        .scrollDismissesKeyboard(.interactively)
        .background(theme.palette.background)
        .navigationTitle(navigationTitle)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button {
                    usageGuidePresented = true
                } label: {
                    Image(systemName: "questionmark.circle")
                }
                .accessibilityLabel(Text("사용 가이드"))
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button(action: onClose) {
                    Image(systemName: "xmark")
                }
                // 저장·음성 생성 중에는 **닫기도 잠근다.** 저장 버튼만 잠그면(:285) 사용자가
                // X 를 눌러 취소한 줄 아는데 몇 초 뒤 알람이 저장·예약되고 탭이 튄다.
                // 반대로 예약이 실패해도 경고 알럿이 이미 사라진 뷰에 붙어 아무 데도 안 뜬다.
                // 안드로이드도 저장 중에는 취소를 함께 잠근다
                // (AlarmEditorScreen 의 `val busy = generating || saving` → EditorActionButtons).
                .disabled(isWorking || voiceStudio.isBusy)
                .accessibilityLabel(Text("닫기"))
            }
        }
        // 아래로 쓸어 닫는 것도 같은 이유로 막는다 — X 만 잠그면 제스처로 같은 상태가 된다.
        .interactiveDismissDisabled(isWorking || voiceStudio.isBusy)
        .sheet(isPresented: $usageGuidePresented, onDismiss: {
            UsageGuideStore().markSeen(.alarmEditor)
        }) {
            UsageGuideSheet(steps: Self.usageGuideSteps) {
                usageGuidePresented = false
            }
        }
        .alert(item: $validationAlert) { content in
            Alert(
                title: Text(content.title),
                message: Text(content.message),
                dismissButton: .default(Text("확인"))
            )
        }
        // 검증/실패 알림이 뜰 때 한 번 error 햅틱을 울려 저장 실패를 촉각으로 알린다.
        .onChange(of: validationAlert?.id) { _, newID in
            if newID != nil {
                UINotificationFeedbackGenerator().notificationOccurred(.error)
            }
        }
        .alert(item: $duplicateAlarmConfirm) { content in
            Alert(
                title: Text("같은 시각 알람이 있어요"),
                message: Text(duplicateAlarmMessage(content)),
                primaryButton: .destructive(Text("교체하기")) {
                    Task { await confirmReplaceDuplicate(content) }
                },
                secondaryButton: .cancel(Text("취소"))
            )
        }
        .onAppear {
            guard !didLoadInitial else { return }
            didLoadInitial = true
            loadInitialState()
            if target.editingAlarmID == nil,
               !target.familyAlarmMode,
               !UsageGuideStore().hasSeen(.alarmEditor) {
                usageGuidePresented = true
            }
            Task {
                await voiceStudio.refresh(session: auth.session)
                selectDefaultVoiceProfileIfNeeded()
                if target.familyAlarmMode {
                    await socialFeatures.refreshAll(session: auth.session)
                    selectDefaultFamilyRecipientIfNeeded()
                }
            }
            // 스톡 클립 카탈로그는 refresh 와 독립적으로 1회 로드한다(무료 등급 +
            // 시스템 보이스 선택 시 StockClipPicker 가 사용). 실패는 비차단.
            Task { await voiceStudio.loadStockClips(session: auth.session) }
        }
        .sheet(item: $sharedVoiceSetupTarget) { profile in
            SharedVoiceSelectionSetupSheet(
                profile: profile,
                isWorking: voiceStudio.isBusy,
                onCancel: {
                    // 공유 음성 미리듣기는 voiceStudio.previewPlayer 로 재생되므로
                    // 시트가 닫힐 때 직접 정지해 잔여 오디오가 이어지지 않게 한다.
                    voiceStudio.previewPlayer.stop()
                    sharedVoiceSetupTarget = nil
                },
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
                        // 미리듣기가 재생 중일 수 있으므로 확정 시에도 정지한다.
                        voiceStudio.previewPlayer.stop()
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
                localAudioMessage = AudioUserFacingError.message(for: error, fallback: "파일을 선택하지 못했어요.")
            }
        }
        // 플랜이 시트 오픈 후 비동기로 free 로 확정되는 경우(socialFeatures.subscription
        // 가 늦게 채워질 때) freeVoiceTier 가 뒤늦게 flip 된다. Android 가
        // `LaunchedEffect(freeVoiceTier, playMode)` 로 재확정하듯, freeVoiceTier
        // (및 currentPlan) 변화에도 4-값 잠금을 다시 강제해 유료 컨트롤이 잠깐
        // 노출되는 일을 막는다. coerceFreeVoiceTierConstraints 는 값이 실제로
        // 달라질 때만 재할당하므로 무한 루프가 생기지 않는다.
        .onChange(of: freeVoiceTier) { _, _ in coerceFreeVoiceTierConstraints() }
        .onChange(of: currentPlan) { _, _ in coerceFreeVoiceTierConstraints() }
        // 선택 목소리가 바뀌면 직전 생성/스톡 선택을 비워, 다른 프로필의 오디오를
        // 저장하지 않게 한다. 미리듣기 중이면 함께 정지한다.
        .onChange(of: voiceStudio.selectedProfileID) { oldProfileID, newProfileID in
            guard !suppressProfileChangeInvalidation else { return }
            if (oldProfileID).nilIfBlank != (newProfileID).nilIfBlank {
                ttsProfileChangedDuringEdit = true
            }
            stopAllEditorPreviews()
            stockSelectedMessageID = nil
            voiceStudio.preparedAlarm = nil
        }
        .onChange(of: voiceStudio.weatherCountry) { _, _ in voiceStudio.preparedAlarm = nil }
        .onChange(of: voiceStudio.weatherCity) { _, _ in voiceStudio.preparedAlarm = nil }
        .onChange(of: voiceStudio.fortuneGender) { _, _ in voiceStudio.preparedAlarm = nil }
        .onChange(of: voiceStudio.fortuneBirthDate) { _, _ in voiceStudio.preparedAlarm = nil }
        .onChange(of: voiceStudio.fortuneBirthTime) { _, _ in voiceStudio.preparedAlarm = nil }
        // 시각이 바뀌면 랜덤 문구용으로 준비한 음원은 발화 시각이 어긋나 stale 이 되므로 무효화한다
        // (canReuseExistingTtsAudio 의 fireAt 검사와 짝). 단 고정 문구/스톡 클립은 시각과
        // 무관하므로 건드리지 않는다 — TimeWheelPicker 스크롤 중간값이 스톡 선택을 지우지
        // 않도록 randomPrompt && 스톡 미스테이징 일 때만 비운다(RISK C).
        .onChange(of: draft.hour) { _, _ in invalidatePreparedRandomClipOnTimeChange() }
        .onChange(of: draft.minute) { _, _ in invalidatePreparedRandomClipOnTimeChange() }
        // 반복 요일이 모두 꺼지면 공휴일 OFF 는 무의미해진다. 토글은 disable 만 되어
        // (HolidayOffToggle.enabled=false) 켜진 값이 그대로 레코드에 남을 수 있으므로,
        // mask 가 0 이 되는 순간 holidayOff 를 false 로 되돌려 stale true 를 막는다(PR6).
        .onChange(of: draft.repeatDaysMask) { _, newMask in
            if newMask == 0, draft.holidayOff {
                draft.holidayOff = false
            }
        }
        .onChange(of: localRecorder.elapsedSeconds) { _, seconds in
            if seconds >= TimeInterval(AlarmAudioLimits.maxDurationMillis / 1000),
               localRecorder.isRecording {
                localRecorder.stop()
                localAudioMessage = "최대 \(AlarmAudioLimits.maxDurationMillis / 1000)초까지 녹음했어요."
            }
        }
        .onDisappear {
            localRecorder.stop()
            stopAllEditorPreviews()
        }
    }

    /// 에디터의 모든 미리듣기를 끄는 단일 진입점(change 4). 흩어져 있던
    /// previewPlayer.stop()/localPreviewPlayer.stop()/previewingStockMessageID=nil 을 대체한다.
    /// Android `stopPreview` (AlarmEditorScreen.kt:280-288) 미러.
    func stopAllEditorPreviews() {
        editorPreviewPlayer.stop()
        // 공유 음성 미리듣기는 voiceStudio.previewPlayer 경로를 쓰므로 함께 정지해
        // 이중 재생/잔여 오디오를 막는다.
        voiceStudio.previewPlayer.stop()
        previewTarget = nil
    }

    /// 처음 알람을 만드는 사용자를 위한 단계 가이드 (handoff 코치마크 카피 참고).
    static let usageGuideSteps: [UsageGuideStep] = [
        UsageGuideStep(
            systemImage: "clock.fill",
            title: "시간과 반복부터",
            body: "휠을 돌려 시각을 맞추고 반복할 요일을 골라요. 반복을 켜면 공휴일에는 끄기도 선택할 수 있어요."
        ),
        UsageGuideStep(
            systemImage: "waveform",
            title: "재생 방식을 골라요",
            body: "'알람 + 음성'을 고르면 등록한 목소리가 함께 울려요. 랜덤 문구를 켜면 아침마다 새로운 메시지로 깨워줘요."
        ),
        UsageGuideStep(
            systemImage: "checkmark.circle.fill",
            title: "저장하면 끝이에요",
            body: "음량·진동·스누즈는 아래로 스크롤해 조정할 수 있어요. 저장을 누르면 알람이 바로 예약돼요."
        ),
    ]

    var saveButtonTitle: String {
        target.editingAlarmID == nil ? "저장" : "수정 저장"
    }

    /// 알람음 on/off 바인딩 (Android `AlarmSettingsCard.kt:162-165`). 켜면 100%, 끄면 0%
    /// (무음) 로 alarmVolumePercent 를 토글한다.
    var alarmSoundEnabledBinding: Binding<Bool> {
        Binding(
            get: { draft.alarmVolumePercent > 0 },
            set: { draft.alarmVolumePercent = $0 ? 100 : 0 }
        )
    }

    /// 진동 on/off 바인딩 (Android `AlarmEditorScreen.kt:1263-1265`). 켜면 default 패턴,
    /// 끄면 none. '없음' 은 패턴 picker 목록에서 제외하고 이 토글로만 끈다.
    var vibrationEnabledBinding: Binding<Bool> {
        Binding(
            get: { draft.vibrationPattern != .none },
            set: { draft.vibrationPattern = $0 ? .default : .none }
        )
    }

    /// 알람음 종류 라벨. iOS 는 커스텀 링톤 선택 API 가 없어 기존 레코드에 저장된
    /// alarmSoundLabel 이 있으면 그대로, 없으면 '기본 알람음' 을 보여준다
    /// (Android `editor2_default_alarm_sound` 미러).
    var alarmSoundDisplayLabel: String {
        (editingAlarm?.alarmSoundLabel).nilIfBlank ?? "기본 알람음"
    }

    /// 알람 음량 슬라이더를 Android 와 동일하게 10단위(0/10/…/100, 11개 stop)로 스냅시킨다.
    /// AlarmVolumeSlider 자체는 step 1 이므로, 호출부 바인딩 setter 가 가장 가까운 10의
    /// 배수로 반올림해 deciles 로 제한한다 (Android `AlarmSettingsCard.kt:376` Slider steps=9 미러).
    var alarmVolumeDecileBinding: Binding<Int> {
        Binding(
            get: { draft.alarmVolumePercent },
            set: { draft.alarmVolumePercent = Int((Double($0) / 10.0).rounded()) * 10 }
        )
    }

    /// 요일 칩 위에 보여줄 반복 요약(PR6). 0x7f=매일, 일부 요일=매주 목록, 0=다음 울릴 날짜.
    /// Android `AlarmEditorControls.kt` RepeatSelector 상단 요약과 같은 의도.
    var repeatSummary: String {
        let mask = draft.repeatDaysMask
        if mask == 0x7f { return "매일" }
        if mask != 0 {
            let days = RepeatDay.displayOrder
                .filter { mask.hasRepeatDay($0) }
                .map { $0.shortLabel }
                .joined(separator: " ")
            return "매주: \(days)"
        }
        // mask == 0 : 한 번만 — 다음 발화 날짜를 보여준다(공휴일 OFF 는 의미 없지만 계산은 동일).
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let fireAt = (try? AlarmTimeCalculator.nextFireAtMillis(
            hour: draft.hour,
            minute: draft.minute,
            repeatDaysMask: 0,
            holidayOff: draft.holidayOff,
            nowMillis: now,
            isHoliday: holidayStore.holidayPredicate()
        )) ?? LocalAlarmRecord.fallbackFireAtMillis(
            hour: draft.hour,
            minute: draft.minute,
            referenceMillis: now
        )
        return Self.repeatSummaryDateFormatter.string(
            from: Date(timeIntervalSince1970: TimeInterval(fireAt) / 1000.0)
        )
    }

    /// "한 번만" 알람의 다음 발화 날짜 표기(예: 6월 21일 (토)). 매 호출 생성 비용을 피하려 static.
    static let repeatSummaryDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ko_KR")
        formatter.setLocalizedDateFormatFromTemplate("MMMd EEE")
        return formatter
    }()

    /// 저장이 막힌 이유 — 비활성 버튼만으로는 무엇이 빠졌는지 알 수 없어 버튼 위에 사유를
    /// 함께 보여준다. nil 이면 저장 가능. Android `editorSaveBlockedReason`
    /// (AlarmEditorScreen.kt:918-940) 미러.
    ///
    /// 중요: 단일 저장 버튼이 캐시 미스 시 직접 생성하므로(saveFlow), "아직 생성 안 됨" 은
    /// 막을 사유가 아니다. 정말로 만족 불가능한 상태(목소리 미선택 / 사용 불가 목소리 /
    /// 랜덤 문구 정보 미완 / 빈 직접 문구)만 막는다. 신규 랜덤 문구 한-탭 생성 경로
    /// (randomPrompt=true, preset)는 nil 이어야 저장이 활성화돼 탭 시 생성이 돈다(RISK F).
    var editorSaveBlockedReason: String? {
        if draft.playMode == .alarmOnly { return nil }
        if voiceSourceMode == .localAudio {
            let hasNewSource = selectedLocalAudioURL != nil || localRecorder.latestRecordingURL != nil
            if hasNewSource || existingLocalAudioLabel != nil {
                return nil
            }
            return "들려줄 음성을 녹음하거나 파일로 선택해 주세요."
        }

        // tts_profile 분기. 스톡 클립이 스테이징돼 있으면 곧바로 저장 가능.
        if selectedStockMessageID != nil { return nil }

        guard let profileID = (voiceStudio.selectedProfileID).nilIfBlank else {
            return "알람에서 들을 목소리를 선택해 주세요."
        }
        // 선택된 목소리가 더 이상 alarm 선택 대상이 아니면(삭제/미준비 등) 사용 불가.
        // 단, 기존 알람의 음원이 그대로 재사용 가능한 경우엔 막지 않는다(아래 생성 경로가 흡수).
        let profileReady = voiceStudio.profiles.contains { $0.id == profileID && $0.isReadyForAlarmSelection } ||
            voiceStudio.familyVoices.contains { $0.id == profileID && $0.isReadyForAlarmSelection }
        let preparedForProfile = voiceStudio.preparedAlarm?.voiceProfileID == profileID
        if !profileReady, !preparedForProfile, !reuseExistingTtsForCurrentSelection {
            return "선택한 목소리를 쓸 수 없어요. 다른 목소리를 선택해 주세요."
        }
        if voiceStudio.randomPrompt {
            if !randomPromptSettingsComplete {
                return "랜덤 문구 설정에서 날씨 지역·운세 정보를 채워 주세요."
            }
            return nil
        }
        if voiceStudio.ttsText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return "들려줄 문구를 입력하거나 랜덤 문구를 켜 주세요."
        }
        return nil
    }

    var editorCanSave: Bool { editorSaveBlockedReason == nil }

    /// 랜덤 문구가 켜졌을 때 컨텍스트별 필수 정보가 채워졌는지. 가족 알람은 상대의 준비
    /// 상태(weatherReady/fortuneReady)도 인정한다 — generateTTS 검증(688-694) 미러.
    var randomPromptSettingsComplete: Bool {
        guard voiceStudio.randomPrompt else { return true }
        let context = activePromptContext
        if context.usesWeather, !voiceStudio.hasWeatherInfo, !targetWeatherReady {
            return false
        }
        if context.usesFortune, !voiceStudio.hasFortuneInfo, !targetFortuneReady {
            return false
        }
        return true
    }

    /// editorSaveBlockedReason 전용 — 현재 선택으로 기존 알람의 TTS 음원을 그대로 재사용할 수
    /// 있는지. saveFlow 와 같은 방식으로 다음 발화 시각을 계산해 넘긴다(랜덤 문구일 때만 의미).
    private var reuseExistingTtsForCurrentSelection: Bool {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let fireAt = (try? AlarmTimeCalculator.nextFireAtMillis(
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
        return AlarmEditDraft.canReuseExistingTtsAudio(
            existing: editingAlarm,
            selectedProfileID: voiceStudio.selectedProfileID,
            text: voiceStudio.ttsText,
            randomPrompt: voiceStudio.randomPrompt,
            randomContext: voiceStudio.randomContext,
            language: voiceStudio.ttsLanguage,
            translateText: voiceStudio.translateText,
            fireAtMillis: fireAt,
            listenerTitle: ttsListenerTitleForCurrentSelection(existing: editingAlarm)
        )
    }

    private func shouldPreserveExistingTtsListenerTitle(existing: LocalAlarmRecord?) -> Bool {
        guard let existing,
              existing.playModeEnum != .alarmOnly,
              existing.voiceSourceEnum != .localAudio,
              !ttsProfileChangedDuringEdit,
              (existing.voiceListenerTitle).nilIfBlank != nil,
              let selectedProfileID = (voiceStudio.selectedProfileID).nilIfBlank,
              selectedProfileID == (existing.voiceProfileId).nilIfBlank else {
            return false
        }
        return true
    }

    private func ttsListenerTitleForCurrentSelection(existing: LocalAlarmRecord?) -> String? {
        if shouldPreserveExistingTtsListenerTitle(existing: existing) {
            return existing?.voiceListenerTitle
        }
        return voiceStudio.selectedListenerTitle
    }

    var navigationTitle: String {
        if target.familyAlarmMode { return "상대 알람 맞추기" }
        return target.editingAlarmID == nil ? "알람 만들기" : "알람 수정"
    }

    var activePromptContext: RandomPromptContext {
        RandomPromptContext.normalized(voiceStudio.randomContext)
    }

    var targetWeatherReady: Bool {
        target.familyAlarmMode && selectedFamilyRecipient?.dynamicPromptSettingsState?.weatherReady == true
    }

    var targetFortuneReady: Bool {
        target.familyAlarmMode && selectedFamilyRecipient?.dynamicPromptSettingsState?.fortuneReady == true
    }

    /// 음성 기능 접근 등급 (Android `AlarmEditorScreen.kt:144-146` 미러).
    /// - loggedOut: 로그아웃. 음성 모드 자체가 잠긴다 (alarm_only 강제).
    /// - free: 로그인했으나 유료 음성 권한 없음. 음성은 쓰되 시스템 보이스 +
    ///   랜덤 preset 으로만 제한된다.
    /// - paid: personal 이상. 모든 음성 기능 사용 가능.
    enum PlanAccess { case loggedOut, free, paid }

    /// `currentPlan` 만으로는 loggedOut 과 free 를 구분할 수 없다
    /// (`PlanTier.bestKnown` 은 두 경우 모두 .free 를 반환). Android 가
    /// `authSession == null` 로 판별하듯, 세션 유무를 discriminator 로 쓴다.
    var planAccess: PlanAccess {
        guard auth.session != nil else { return .loggedOut }
        return currentPlan.meetsOrExceeds(.personal) ? .paid : .free
    }

    /// 로그아웃 상태에서만 음성 모드를 통째로 막는다 (재생 방식 picker + 저장/로드 시
    /// alarm_only 강제). 기존 `voicePlanLocked` 의 자리를 대체.
    var voiceModeBlocked: Bool { planAccess == .loggedOut }

    /// 로그인 무료 등급 — 음성은 허용하되 시스템 보이스/preset 으로 강제하는 graduated 경로.
    var freeVoiceTier: Bool { planAccess == .free }

    var familyAlarmLocked: Bool {
        socialFeatures.familyGroup?.group == nil && !currentPlan.meetsOrExceeds(.couple)
    }

    var currentPlan: PlanTier {
        PlanTier.bestKnown(
            serverSubscription: socialFeatures.subscription,
            storeTier: subscriptions.currentTier,
            userPlan: auth.session?.user.plan
        )
    }

    var defaultPlayModeForPlan: AlarmPlayMode {
        voiceModeBlocked ? .alarmOnly : .soundThenVoice
    }

    /// 준비된 음성 미리듣기 chip(change 1).
    ///
    /// - 준비된 음원이 있으면 재생/정지 버튼 + 문구·언어·길이 표시. 재생은
    ///   `voiceStudio.playPreparedAudio(using: editorPreviewPlayer)` 로 *캐시 재생만* 한다
    ///   — 절대 generateTTS 를 호출하지 않고, 자동 재생도 하지 않으며(opt-in 탭),
    ///   저장을 막지도 않는다(editorSaveBlockedReason 불변).
    /// - 30초(+tolerance)를 넘으면 잠금 재생을 위해 30초로 잘린다는 경고를 함께 보여준다.
    /// - 준비된 음원이 없으면 기존 안내 문구를 그대로 텍스트로 보여준다.
    @ViewBuilder
    var preparedVoiceChip: some View {
        if let prepared = voiceStudio.preparedAlarm {
            let durationMs = AudioCacheStore.shared.readMetadata(cacheKey: prepared.audioCacheKey)?.durationMs
            let isPlayingChip = previewTarget == .preparedVoice && editorPreviewPlayer.isPlaying
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 10) {
                    Button {
                        togglePreparedVoicePreview()
                    } label: {
                        Image(systemName: isPlayingChip ? "stop.fill" : "play.fill")
                            .font(.headline)
                            .foregroundStyle(theme.palette.primary)
                            .frame(width: 34, height: 34)
                            .background(theme.palette.primaryContainer.opacity(0.5))
                            .clipShape(Circle())
                            .contentShape(Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text(isPlayingChip ? "정지" : "미리듣기"))

                    VStack(alignment: .leading, spacing: 2) {
                        Text(prepared.text)
                            .font(theme.typography.bodySmall)
                            .foregroundStyle(theme.palette.onSurface)
                            .lineLimit(2)
                        HStack(spacing: 6) {
                            if let languageLabel = preparedVoiceLanguageLabel(prepared.language) {
                                Text(languageLabel)
                                Text("·")
                            }
                            if let durationMs {
                                Text(HelperFormatters.audioTimeLabel(Int(durationMs)))
                                    .monospacedDigit()
                                Text("·")
                            }
                            Text("준비 완료")
                        }
                        .font(theme.typography.bodySmall)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                    }
                    Spacer(minLength: 0)
                }
                if let durationMs,
                   durationMs > AlarmAudioLimits.maxDurationMillis + AlarmAudioLimits.durationToleranceMillis {
                    Text("30초가 넘는 음성은 잠금 화면에서 울리도록 앞 30초만 사용돼요.")
                        .font(theme.typography.bodySmall)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        } else {
            Text("아직 생성한 음성이 없어요. 음성 탭에서 음성을 생성해 주세요.")
                .font(theme.typography.bodySmall)
                .foregroundStyle(theme.palette.onSurfaceVariant)
        }
    }

    /// 준비된 음성 chip 의 언어 라벨. raw locale(ko/en/ja)을 한국어/영어/일본어로 풀고,
    /// 알 수 없는 코드는 숨긴다(nil). 서버가 빈 값을 줄 수도 있어 blank 도 숨긴다.
    func preparedVoiceLanguageLabel(_ language: String) -> String? {
        switch language {
        case "ko": return "한국어"
        case "en": return "영어"
        case "ja": return "일본어"
        default: return nil
        }
    }

    /// 준비된 음성 chip 의 재생/정지 토글. 캐시 재생만(네트워크 없음).
    func togglePreparedVoicePreview() {
        if previewTarget == .preparedVoice, editorPreviewPlayer.isPlaying {
            stopAllEditorPreviews()
            return
        }
        stopAllEditorPreviews()
        previewTarget = .preparedVoice
        voiceStudio.playPreparedAudio(using: editorPreviewPlayer)
    }

    var editingAlarm: LocalAlarmRecord? {
        target.editingAlarmID.flatMap { id in
            store.alarms.first { $0.id == id }
        }
    }

    var existingLocalAudioLabel: String? {
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

    var familyRecipients: [FamilyGroupMember] {
        let currentUserID = auth.session?.user.id
        let currentEmail = auth.session?.user.email
        return (socialFeatures.familyGroup?.members ?? []).filter { member in
            member.userId != currentUserID &&
                member.email != currentEmail &&
                member.allowFamilyAlarms == true
        }
    }

    var selectedFamilyRecipient: FamilyGroupMember? {
        if let selectedFamilyRecipientID,
           let selected = familyRecipients.first(where: { $0.userId == selectedFamilyRecipientID }) {
            return selected
        }
        return familyRecipients.first
    }

    // MARK: - Initial load

    func loadInitialState() {
        if let editingID = target.editingAlarmID,
           let alarm = store.alarms.first(where: { $0.id == editingID }) {
            draft = AlarmEditDraft(from: alarm)
            voiceSourceMode = alarm.voiceSourceEnum == .localAudio ? .localAudio : .ttsProfile
            clearExistingLocalAudio = false
            if voiceModeBlocked && draft.playMode != .alarmOnly {
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

    func loadVoicePromptState(from alarm: LocalAlarmRecord?) {
        let saved = savedPromptPreferences()
        ttsProfileChangedDuringEdit = false
        suppressProfileChangeInvalidation = true
        voiceStudio.selectedProfileID = alarm?.voiceProfileId
        voiceStudio.preparedAlarm = nil
        stockSelectedMessageID = nil
        stopAllEditorPreviews()
        voiceStudio.ttsText = alarm?.voiceText ?? ""
        voiceStudio.ttsCategory = alarm?.voiceCategory ?? "morning"
        voiceStudio.ttsLanguage = alarm?.voiceLanguage ?? "ko"
        // 신규 알람은 랜덤 문구 ON 으로 열려 한-탭 저장이 가능해야 한다
        // (Android `AlarmEditorState.from` line 331-333). 기존 알람은 저장값을 따른다.
        voiceStudio.randomPrompt = alarm?.voiceRandomPrompt ?? true
        voiceStudio.randomContext = RandomPromptContext.normalized(alarm?.voiceRandomContext).rawValue
        voiceStudio.translateText = !voiceStudio.randomPrompt && voiceStudio.ttsLanguage != "ko"
        voiceStudio.weatherCountry = alarm?.voiceWeatherCountry ?? saved.weatherCountry
        voiceStudio.weatherCity = alarm?.voiceWeatherCity ?? saved.weatherCity
        voiceStudio.fortuneGender = alarm?.voiceFortuneGender ?? saved.fortuneGender
        voiceStudio.fortuneBirthDate = alarm?.voiceFortuneBirthDate ?? saved.fortuneBirthDate
        voiceStudio.fortuneBirthTime = alarm?.voiceFortuneBirthTime ?? saved.fortuneBirthTime
        // 기존 스톡 클립 알람은 선택/준비 상태로 복원해 저장 시 같은 캐시 음원을 재사용한다
        // (P2). selectedProfileID 가 위에서 먼저 설정되고 그 onChange 훅이
        // stockSelectedMessageID 를 비우므로, 복원은 반드시 그 이후 — 즉 coerce 직전 —
        // 에 수행한다. coerce 가 보기 전에 preparedAlarm/stockSelectedMessageID 가 채워져
        // 있어야 803 라인 가드가 4-값 강제를 건너뛴다.
        restoreStockClipSelectionIfNeeded(from: alarm)
        coerceFreeVoiceTierConstraints()
        DispatchQueue.main.async {
            suppressProfileChangeInvalidation = false
        }
    }

    /// 기존에 저장된 스톡 클립 알람을 다시 "선택/준비" 상태로 복원한다(P2).
    /// P1 과 동일한 신호(`audioCacheKey` 의 `stock_` prefix + 시스템 voiceProfileId)로
    /// 스톡 알람을 식별하고, 스테이징됐던 캐시 파일이 디스크에 그대로 있을 때만
    /// `preparedAlarm` + `stockSelectedMessageID` 를 재구성한다. 이렇게 하면
    /// `selectedStockMessageID`(prepared.audioCacheKey 의 stock_ prefix 접근자)가
    /// 선택을 보고해 editorSaveBlockedReason 이 nil 을 반환하고, saveFlow 가 스톡 분기
    /// (1121-1143)로 동일 audioCacheKey 를 재사용한다. 캐시가 sweep 됐으면 복원하지
    /// 않아 saveFlow 가 정상 재생성 경로를 타게 둔다(dangling 파일 재사용 방지, risk 1).
    private func restoreStockClipSelectionIfNeeded(from alarm: LocalAlarmRecord?) {
        guard let alarm, alarm.isStockVoiceClip,
              let cacheKey = alarm.audioCacheKey,
              let messageID = (alarm.ttsMessageId).nilIfBlank,
              let profileID = (alarm.voiceProfileId).nilIfBlank,
              let localFileName = (alarm.localAudioUri).nilIfBlank else {
            return
        }
        // 스테이징된 `stock_<id>` 캐시 파일이 살아 있을 때만 재사용한다.
        guard AudioCacheStore.shared.cachedURL(for: cacheKey) != nil else { return }
        voiceStudio.preparedAlarm = PreparedAlarmTalk(
            messageID: messageID,
            voiceProfileID: profileID,
            localAudioFileName: localFileName,
            audioCacheKey: cacheKey,
            rawAudioURL: alarm.rawAudioUri,
            text: alarm.voiceText ?? "",
            language: alarm.voiceLanguage ?? "ko",
            listenerTitle: alarm.voiceListenerTitle
        )
        stockSelectedMessageID = messageID
        // 스톡 클립은 고정 음원이므로 랜덤 문구가 아니다(저장값 voiceRandomPrompt=false 미러).
        voiceStudio.randomPrompt = false
    }

    /// 무료 등급 음성 제약을 강제한다 (Android `AlarmEditorScreen.kt:863-882` 미러).
    /// `freeVoiceTier && playMode != .alarmOnly` 일 때 음성을 다음 4-값으로 고정한다:
    /// tts_profile 소스 + randomPrompt=true + randomContext='preset' + translate=false.
    /// 값이 실제로 달라질 때만 재할당하고 preparedAlarm 을 무효화한다(무한 무효화 방지).
    @discardableResult
    func coerceFreeVoiceTierConstraints() -> Bool {
        guard freeVoiceTier, draft.playMode != .alarmOnly else { return false }
        // 스톡 클립이 스테이징된 동안에는 4-값 강제를 건너뛴다. 스톡 선택은 생성을
        // 우회해 preparedAlarm 을 직접 채우므로, 혹시라도 randomPrompt 등이 흔들려
        // coerce 가 preparedAlarm 을 무효화하면 선택이 사라진다(spec risk 3 mitigation).
        // 정상 상태에서는 4-값이 이미 고정돼 있어 어차피 변경이 없다.
        // selectedStockMessageID(prepared.audioCacheKey 의 stock_ prefix 파생 접근자)도
        // 함께 검사해, @State stockSelectedMessageID 가 onChange 훅으로 잠깐 비워졌어도
        // preparedAlarm 이 스톡 클립이면 복원된 선택을 보존한다(belt-and-suspenders).
        if voiceStudio.preparedAlarm != nil,
           stockSelectedMessageID != nil || selectedStockMessageID != nil {
            return false
        }
        var changed = false
        if voiceSourceMode != .ttsProfile {
            voiceSourceMode = .ttsProfile
            changed = true
        }
        if !voiceStudio.randomPrompt {
            voiceStudio.randomPrompt = true
            changed = true
        }
        let presetContext = RandomPromptContext.preset.rawValue
        if RandomPromptContext.normalized(voiceStudio.randomContext).rawValue != presetContext {
            voiceStudio.randomContext = presetContext
            changed = true
        }
        if voiceStudio.translateText {
            voiceStudio.translateText = false
            changed = true
        }
        // 언어를 비번역 기본값 "ko"(source)로 고정한다. randomPrompt 분기에서
        // activeLanguage = ttsLanguage 이므로(VoiceStudioViewModel generateTTS:756) translate=false
        // 라도 stale en/ja 가 그대로 전송돼 서버가 번역 경로로 흐른다. source 로 맞춰 무료
        // 프리셋 요청이 번역을 유발하지 못하게 막는다(서버가 source of truth, 이는 클라 차단).
        if voiceStudio.ttsLanguage != "ko" {
            voiceStudio.ttsLanguage = "ko"
            changed = true
        }
        if changed {
            voiceStudio.preparedAlarm = nil
        }
        return changed
    }

    /// 시각 변경 시 랜덤 문구용 준비 음원을 무효화한다. 랜덤 클립은 발화 시각에 종속되어
    /// 다른 시각용으로 합성된 음원을 그대로 저장하면 stale 이 된다. 고정 문구/스톡 클립은
    /// 시각과 무관하므로 무효화하지 않는다(스크롤 중간값이 스톡 선택을 지우는 것 방지).
    func invalidatePreparedRandomClipOnTimeChange() {
        guard voiceStudio.randomPrompt else { return }
        guard stockSelectedMessageID == nil, selectedStockMessageID == nil else { return }
        voiceStudio.preparedAlarm = nil
    }

    func savedPromptPreferences() -> DynamicPromptPreferences {
        let server = DynamicPromptPreferences.from(settings: auth.session?.user.dynamicPromptSettings)
        return server == DynamicPromptPreferences() ? .loadFromDefaults() : server
    }

    /// 저장 시 사용자가 입력한 날씨 지역/운세 정보를 기기 기본값에 보존해, 다음 알람을
    /// 만들 때 매번 서울/대한민국·생년월일을 다시 입력하지 않게 한다. Android
    /// `AlarmEditorScreen.kt:967-992` 의 saveWeatherLocation/saveFortuneInfo 미러 —
    /// 가족(상대) 알람은 상대 정보라 내 기본값을 덮어쓰지 않는다.
    func persistDynamicPromptPreferencesIfNeeded() {
        guard !target.familyAlarmMode, voiceStudio.randomPrompt else { return }
        let context = activePromptContext
        var prefs = DynamicPromptPreferences.loadFromDefaults()
        var changed = false
        if context.usesWeather,
           let country = (voiceStudio.weatherCountry).nilIfBlank,
           let city = (voiceStudio.weatherCity).nilIfBlank {
            prefs.weatherCountry = country
            prefs.weatherCity = city
            changed = true
        }
        if context.usesFortune,
           let gender = (voiceStudio.fortuneGender).nilIfBlank,
           let birthDate = (voiceStudio.fortuneBirthDate).nilIfBlank,
           let birthTime = (voiceStudio.fortuneBirthTime).nilIfBlank {
            prefs.fortuneGender = gender
            prefs.fortuneBirthDate = birthDate
            prefs.fortuneBirthTime = birthTime
            changed = true
        }
        if changed {
            prefs.saveToDefaults()
        }
    }

    func applyVoicePromptState(to record: inout LocalAlarmRecord) {
        let enabled = record.playModeEnum != .alarmOnly && voiceStudio.randomPrompt
        let context = RandomPromptContext.normalized(voiceStudio.randomContext)
        record.voiceRandomPrompt = enabled
        record.voiceRandomContext = enabled ? context.rawValue : nil
        record.voiceWeatherCountry = enabled && context.usesWeather ? (voiceStudio.weatherCountry).nilIfBlank : nil
        record.voiceWeatherCity = enabled && context.usesWeather ? (voiceStudio.weatherCity).nilIfBlank : nil
        record.voiceFortuneGender = enabled && context.usesFortune ? (voiceStudio.fortuneGender).nilIfBlank : nil
        record.voiceFortuneBirthDate = enabled && context.usesFortune ? (voiceStudio.fortuneBirthDate).nilIfBlank : nil
        record.voiceFortuneBirthTime = enabled && context.usesFortune ? (voiceStudio.fortuneBirthTime).nilIfBlank : nil
    }

    func showVoicePlanLockedAlert() {
        // Android `editor_plan_gate_paid_features` vs `editor_plan_gate_login_required` 분기.
        let message: String
        if voiceModeBlocked {
            message = "음성 알람은 로그인 후 사용할 수 있어요."
        } else {
            message = "녹음/파일·직접 문구·날씨/운세 맞춤은 유료 이용권에서 사용할 수 있어요. 무료에서는 시스템 목소리와 기본 랜덤 문구로 알람을 만들 수 있어요."
        }
        validationAlert = ValidationAlertContent(
            title: "이용권이 필요해요",
            message: message
        )
    }

    func selectDefaultFamilyRecipientIfNeeded() {
        guard target.familyAlarmMode else { return }
        if let selectedFamilyRecipientID,
           familyRecipients.contains(where: { $0.userId == selectedFamilyRecipientID }) {
            return
        }
        if let first = familyRecipients.first {
            selectFamilyRecipient(first.userId)
        }
    }

    func selectDefaultVoiceProfileIfNeeded() {
        guard draft.playMode != .alarmOnly else { return }
        let selected = voiceStudio.selectedProfileID
        let readyOwn = voiceStudio.profiles.filter { $0.isReadyForAlarmSelection }
        let readyShared = voiceStudio.familyVoices.filter { $0.isReadyForAlarmSelection }

        // 무료 등급은 서버가 시스템 보이스만 허용한다(tts.ts:684-693).
        // 비-시스템 프로필이 선택돼 있으면 시스템 보이스로 갈아끼워 403 을 예방한다.
        // 온보딩/목소리 탭에서 고른 기본 목소리(시스템)를 우선 선택 — Android VoiceAudioCard 미러.
        let defaultVoice = readyOwn.first { $0.id == voiceStudio.defaultVoiceId }

        if freeVoiceTier {
            let systemVoice = defaultVoice ?? readyOwn.first { isSystemVoice($0) }
            let selectedIsSystem = voiceStudio.isSystemVoiceProfile(id: selected)
            if selectedIsSystem,
               readyOwn.contains(where: { $0.id == selected }) {
                return
            }
            if let systemVoice {
                voiceStudio.selectedProfileID = systemVoice.id
            }
            return
        }

        let selectedStillAvailable = selected.map { selectedID in
            readyOwn.contains(where: { $0.id == selectedID }) ||
                readyShared.contains(where: { $0.id == selectedID })
        } ?? false
        if selectedStillAvailable {
            return
        }
        if let defaultVoice {
            voiceStudio.selectedProfileID = defaultVoice.id
        } else if let first = readyOwn.first {
            voiceStudio.selectedProfileID = first.id
        } else if let first = readyShared.first, !first.requiresViewerInfo {
            voiceStudio.selectedProfileID = first.id
        }
    }

    func selectFamilyRecipient(_ userID: String) {
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

    func saveFlow() async {
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

        if voiceModeBlocked && draft.playMode != .alarmOnly {
            draft.playMode = .alarmOnly
            showVoicePlanLockedAlert()
            return
        }

        // 무료 등급은 음성을 쓰되 시스템 보이스 + preset 으로 강제. 저장 직전에도
        // 4-값 잠금을 재확인해 사용자 조작/레이스로 빠져나간 경우를 막는다.
        coerceFreeVoiceTierConstraints()

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

        let existing = editingAlarm

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

        // 단일 저장 버튼 게이트(Android saveEditor 미러). 음성 알람인데 준비된 음원이 없고
        // 기존 음원도 재사용할 수 없으면 — 그냥 막지 않고 여기서 직접 생성한다. 생성이
        // 실패하면(generateTTS 가 mapVoiceError 로 statusMessage 를 채우고 nil 반환) 저장을
        // 중단해, 음성 없는 알람이 저장되거나 설정한 시간/이름/반복이 사라지는 일이 없다.
        let shouldPreserveExistingListenerTitle = shouldPreserveExistingTtsListenerTitle(existing: existing)
        let currentListenerTitle = ttsListenerTitleForCurrentSelection(existing: existing)

        if draft.playMode != .alarmOnly,
           voiceSourceMode == .ttsProfile,
           voiceStudio.preparedAlarm == nil,
           !AlarmEditDraft.canReuseExistingTtsAudio(
                existing: existing,
                selectedProfileID: voiceStudio.selectedProfileID,
                text: voiceStudio.ttsText,
                randomPrompt: voiceStudio.randomPrompt,
                randomContext: voiceStudio.randomContext,
                language: voiceStudio.ttsLanguage,
                translateText: voiceStudio.translateText,
                fireAtMillis: fireAt,
                listenerTitle: currentListenerTitle
            ) {
            let prepared = await voiceStudio.generateTTS(
                session: auth.session,
                alarmHour: draft.hour,
                alarmMinute: draft.minute,
                targetUserId: target.familyAlarmMode ? selectedFamilyRecipient?.userId : nil,
                targetDynamicPromptState: target.familyAlarmMode ? selectedFamilyRecipient?.dynamicPromptSettingsState : nil,
                listenerTitleOverride: currentListenerTitle,
                useListenerTitleOverride: shouldPreserveExistingListenerTitle,
                // 저장 흐름의 인라인 생성: 성공 햅틱은 이어지는 finishScheduling 이
                // 울린다. 여기서도 울리면 두 번 진동하므로 억제한다.
                triggerSuccessHaptic: false
            )
            // 실패 게이트: nil 이면 statusMessage 에 사유가 남고, 레코드를 만들거나
            // finishScheduling 하기 전에 중단한다. draft(시간/이름/반복)는 @State 라 그대로다.
            guard prepared != nil else { return }
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
                localAudioMessage = AudioUserFacingError.message(for: error, fallback: "선택한 알람 음성을 준비하지 못했어요.")
                return
            }
        } else {
            familyLocalVoiceSource = nil
        }

        let cachedLocalAudio: CachedLocalAlarmAudio?
        if familyRecipient == nil,
           draft.playMode != .alarmOnly,
           voiceSourceMode == .localAudio {
            do {
                cachedLocalAudio = try await cachedLocalAudioForSave(existing: existing)
            } catch {
                localAudioMessage = AudioUserFacingError.message(for: error, fallback: "선택한 알람 음성을 준비하지 못했어요.")
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

        // playMode 가 음성을 포함하면, voiceStudio 의 prepared 결과를 record 의
        // 음원/프로필 필드에 합쳐 둔다.
        var merged = draft.toRecord(existing: existing, fireAtMillis: fireAt, nowMillis: now)
        applyVoicePromptState(to: &merged)
        // 입력한 날씨 지역/운세 정보를 기기 기본값에 보존(다음 알람 입력 생략). 음성 비활성
        // 알람은 randomPrompt 가 무시되므로 enabled 분기를 한 번 더 게이트한다.
        if merged.playModeEnum != .alarmOnly {
            persistDynamicPromptPreferencesIfNeeded()
        }
        if let cachedLocalAudio, draft.playMode != .alarmOnly {
            merged.voiceSource = VoiceSource.localAudio.rawValue
            merged.localAudioUri = cachedLocalAudio.fileName
            merged.audioCacheKey = cachedLocalAudio.cacheKey
            merged.rawAudioUri = nil
            merged.voiceProfileId = nil
            merged.voiceListenerTitle = nil
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
            // 스톡 클립은 cacheKey 가 `stock_` prefix 다. 스톡 음성은 고정 음원이라
            // 매일 다른 랜덤 TTS 로 갈아끼우면 안 된다 — Android `setStockClipAudio`
            // 가 voiceRandomPrompt=false 로 두어 DynamicVoiceRefresh 대상에서 빼듯,
            // 여기서도 voiceRandomPrompt=false + dynamicVoicePreparedForFireAtMillis=nil
            // 로 강제해 REPEATING 스톡 알람이 refresh 윈도우에 덮어써지지 않게 한다.
            let isStockClip = prepared.audioCacheKey.hasPrefix("stock_")
            merged.voiceSource = VoiceSource.serverTts.rawValue
            merged.localAudioUri = prepared.localAudioFileName
            merged.audioCacheKey = prepared.audioCacheKey
            merged.rawAudioUri = prepared.rawAudioURL ?? merged.rawAudioUri
            merged.voiceProfileId = prepared.voiceProfileID
            merged.voiceListenerTitle = prepared.listenerTitle
            merged.voiceText = prepared.text
            let usesRandomPrompt = voiceStudio.randomPrompt && !isStockClip
            merged.voiceCategory = usesRandomPrompt ? activePromptContext.ttsCategory : "custom"
            merged.voiceLanguage = prepared.language
            merged.dynamicVoicePreparedForFireAtMillis = usesRandomPrompt ? merged.fireAtMillis : nil
            merged.ttsMessageId = prepared.messageID
            if isStockClip {
                merged.voiceRandomPrompt = false
                merged.voiceRandomContext = nil
            }
        }

        do {
            try LocalAlarmStore.validateDraft(merged)
        } catch {
            validationAlert = ValidationAlertContent(
                title: "저장할 수 없어요",
                message: AudioUserFacingError.message(for: error, fallback: "알람 설정을 확인해 주세요.")
            )
            return
        }

        // "한 시각에는 알람 하나" — 같은 시각 알람이 있으면 바로 거부하지 않고
        // 교체 여부를 모달로 묻는다(자동 삭제하지 않음). 동의 시 confirmReplaceDuplicate.
        let conflicts = store.conflictingAlarms(
            hour: merged.hour,
            minute: merged.minute,
            excludingID: existing?.id
        )
        if !conflicts.isEmpty {
            duplicateAlarmConfirm = DuplicateAlarmConfirmContent(
                timeLabel: String(format: "%02d:%02d", merged.hour, merged.minute),
                existingLabel: conflicts.first?.label,
                merged: merged,
                existing: existing,
                conflicts: conflicts
            )
            return
        }

        await finishScheduling(merged: merged, existing: existing)
    }

    /// 충돌이 없거나 교체 동의 후, 실제 저장 + AlarmKit 예약을 수행한다. 예약 실패 시
    /// 롤백하고 false 를 반환한다(교체 흐름이 충돌 알람을 지우지 않도록).
    @discardableResult
    func finishScheduling(merged: LocalAlarmRecord, existing: LocalAlarmRecord?) async -> Bool {
        store.upsert(merged)
        let scheduled = await alarmKit.schedule(record: merged, store: store)
        guard scheduled else {
            if let existing {
                store.upsert(existing)
            } else {
                // 신규 저장 롤백. 반환되는 releasedAudioCacheKey 는 의도적으로
                // 무시한다 — 같은 키의 음원을 voiceStudio.preparedAlarm 이 아직
                // 들고 있어 사용자가 곧바로 재시도하면 그대로 재사용되기 때문.
                // 재시도 없이 버려진 캐시는 30일 sweep 이 회수한다.
                store.deleteByID(merged.id)
            }
            validationAlert = ValidationAlertContent(
                title: "예약할 수 없어요",
                message: alarmKit.statusMessage ?? "알람 예약에 실패했어요."
            )
            return false
        }
        if let existing {
            await alarmKit.cancelScheduledAlarm(record: existing)
        }
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        onSchedulingDidFinish()
        return true
    }

    /// 중복 시각 교체 동의: 새 알람을 먼저 저장·예약한 뒤, 충돌 알람을 삭제한다.
    /// 순서가 중요하다 — 충돌 알람을 먼저 지우면 둘이 공유하는 audioCacheKey 음성이
    /// 마지막 참조로 간주돼 삭제되어, 같은 음성을 재사용하는 새 알람이 깨진다.
    /// 저장 실패 시에는 충돌 알람을 보존한다.
    func confirmReplaceDuplicate(_ content: DuplicateAlarmConfirmContent) async {
        let saved = await finishScheduling(merged: content.merged, existing: content.existing)
        guard saved else { return }
        for conflict in content.conflicts {
            // cancel(record:store:) = AlarmKit 예약 취소 + store.delete + 고아 캐시만 정리.
            _ = await alarmKit.cancel(record: conflict, store: store)
        }
    }

    private func duplicateAlarmMessage(_ content: DuplicateAlarmConfirmContent) -> String {
        if let label = content.existingLabel, !label.isEmpty {
            return "\(content.timeLabel)에 이미 '\(label)' 알람이 있어요.\n기존 알람을 새 알람으로 교체할까요?"
        }
        return "\(content.timeLabel)에 이미 알람이 있어요.\n기존 알람을 새 알람으로 교체할까요?"
    }

    // MARK: - Stock clips (free tier + system voice)

    /// 스톡 클립 미리듣기. 같은 클립을 다시 누르면 정지, 아니면 음원을 받아
    /// `stock_preview_<messageId>` 키로 캐싱한 뒤 재생한다. Android `previewStockClip` 미러.
    func previewStockClip(_ clip: StockClip) async {
        // 같은 클립을 다시 누르면 정지.
        if previewTarget == .stockClip(clip.id), editorPreviewPlayer.isPlaying {
            stopAllEditorPreviews()
            return
        }
        guard let token = auth.session?.token else {
            voiceStudio.statusMessage = "로그인이 필요해요."
            return
        }
        // 다운로드 동안 스피너를 띄운다(change 2) — target 설정 + isPreparing=true.
        stopAllEditorPreviews()
        previewTarget = .stockClip(clip.id)
        editorPreviewPlayer.setPreparing(true)
        do {
            let response = try await AlarmTalkAPI.shared.getTTSMessageAudio(id: clip.messageId, token: token)
            // 사용자가 그새 다른 미리듣기로 옮겨갔으면 폐기.
            guard previewTarget == .stockClip(clip.id) else { return }
            let cached = try await AudioCacheStore.cacheStockClipOffMain(
                audio: response,
                messageId: clip.messageId,
                cacheKey: AudioCacheStore.stockPreviewCacheKey(messageId: clip.messageId)
            )
            guard previewTarget == .stockClip(clip.id) else { return }
            // play(...) 가 isPreparing 을 false 로 내린다.
            try editorPreviewPlayer.play(url: cached.url)
        } catch {
            if previewTarget == .stockClip(clip.id) {
                stopAllEditorPreviews()
            }
            voiceStudio.statusMessage = AudioUserFacingError.message(for: error, fallback: "미리듣기를 재생하지 못했어요.")
        }
    }

    /// 스톡 클립 선택. 음원을 받아 캐싱하고 `voiceStudio.preparedAlarm` 을 채운다.
    /// 이후 저장은 생성 TTS 와 동일한 경로(server_tts 병합)를 탄다. Android `selectStockClip` 미러.
    func selectStockClip(_ clip: StockClip) async {
        guard !isWorking, !voiceStudio.isBusy else { return }
        let prepared = await voiceStudio.prepareStockClip(clip, session: auth.session)
        guard prepared != nil else { return }
        stockSelectedMessageID = clip.id
        voiceStudio.statusMessage = "기본 제공 음성을 선택했어요."
    }

    func validateFamilyAlarmTarget() -> FamilyGroupMember? {
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

    func createFamilyTargetAlarm(
        recipient: FamilyGroupMember,
        localVoiceSource: FamilyLocalVoiceUploadSource?
    ) async {
        guard let token = auth.session?.token else {
            validationAlert = ValidationAlertContent(title: "로그인이 필요해요", message: "상대 알람은 로그인 후 사용할 수 있어요.")
            return
        }
        do {
            if let localVoiceSource {
                let upload = try await AlarmTalkAPI.shared.uploadVoiceAudio(
                    audioFileURL: localVoiceSource.url,
                    durationMs: localVoiceSource.durationMs,
                    originalName: localVoiceSource.displayName,
                    token: token
                )
                let request = FamilyAlarmTalkRequest(
                    recipientUserId: recipient.userId,
                    wakeAt: String(format: "%02d:%02d", draft.hour, draft.minute),
                    voiceUploadId: upload.id,
                    label: (draft.label).nilIfBlank ?? "가족이 보낸 음성",
                    dubTargetLanguage: nil,
                    repeatDays: RemoteAlarmMapper.repeatDays(fromMask: draft.repeatDaysMask)
                )
                _ = try await AlarmTalkAPI.shared.createFamilyAlarmTalk(request, token: token)
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
                _ = try await AlarmTalkAPI.shared.createAlarm(request, token: token)
            }
            await remoteSync.refresh(session: auth.session, force: true)
            await socialFeatures.refreshAll(session: auth.session, force: true)
            validationAlert = nil
            // 가족(상대) 알람 저장 성공 햅틱. self-alarm 경로의 finishScheduling 과 동일하게
            // 정확히 1회만 울리도록, 인라인 생성 호출은 triggerSuccessHaptic:false 로 둔다.
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            onSchedulingDidFinish()
        } catch {
            validationAlert = ValidationAlertContent(
                title: "상대 알람 설정에 실패했어요",
                message: userFacingErrorMessage(
                    error,
                    fallback: "상대 알람 설정에 실패했어요."
                )
            )
        }
    }

    func handleLocalAudioModeChange(_ mode: AlarmLocalAudioInputMode) {
        stopAllEditorPreviews()
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

    func toggleLocalRecording() {
        stopAllEditorPreviews()
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
                localAudioMessage = "녹음 중…"
            } catch {
                localAudioMessage = AudioUserFacingError.message(for: error, fallback: "녹음을 시작하지 못했어요.")
            }
        }
    }

    func importLocalAlarmAudio(_ source: URL) async {
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
            localAudioMessage = AudioUserFacingError.message(for: error, fallback: "선택한 알람 음성을 준비하지 못했어요.")
        }
    }

    func previewLocalAlarmAudio() {
        if editorPreviewPlayer.isPlaying,
           previewTarget == .selectedCrop || previewTarget == .cachedLocalAudio {
            stopAllEditorPreviews()
            return
        }
        // 항상 크롭 윈도우로 재생해 알람 구간만 들려준다(change 1). 녹음 클립은 start=0
        // 이라 윈도우가 무해하다. file 모드는 preparedLocalAlarmAudioSource 가 이미
        // 크롭 파일을 만들어 주므로 start=0, 전체 길이를 그대로 윈도우로 쓴다.
        let startMs = localAudioCropStartMs
        Task {
            stopAllEditorPreviews()
            do {
                if selectedLocalAudioURL == nil,
                   localRecorder.latestRecordingURL == nil,
                   let url = existingLocalAudioURL() {
                    // 기존 캐시 경로도 저장된 크롭 윈도우(start..start+limit)를 적용해
                    // 알람과 동일 구간만 audition 한다.
                    previewTarget = .cachedLocalAudio
                    let stopAfter = max(0, localAudioCropEndMs - startMs)
                    // 캐시 파일은 저장 시 이미 크롭 시작점부터 잘려 있으므로 파일 자체가
                    // start 에서 시작한다. startMs 로 다시 seek 하면 이중 오프셋이 되어
                    // (start 가 0 이 아닐 때) 구간이 밀리므로 startMs 를 0 으로 고정한다.
                    try editorPreviewPlayer.play(
                        url: url,
                        startMs: 0,
                        stopAfterMs: stopAfter > 0 ? stopAfter : nil
                    )
                } else {
                    let prepared = try await preparedLocalAlarmAudioSource()
                    previewTarget = .selectedCrop
                    // preparedLocalAlarmAudioSource 가 크롭을 끝낸 파일을 주므로(또는 녹음
                    // 전체) 0 부터 그 길이만큼만 재생한다.
                    try editorPreviewPlayer.play(
                        url: prepared.url,
                        startMs: 0,
                        stopAfterMs: prepared.durationMs > 0 ? prepared.durationMs : nil
                    )
                }
            } catch {
                stopAllEditorPreviews()
                localAudioMessage = AudioUserFacingError.message(for: error, fallback: "미리듣기를 재생하지 못했어요.")
            }
        }
    }

    func clearLocalAlarmAudio() {
        stopAllEditorPreviews()
        localRecorder.clearLatest()
        selectedLocalAudioURL = nil
        selectedLocalAudioName = nil
        selectedLocalAudioDurationMs = nil
        clearExistingLocalAudio = true
        localAudioCropStartMs = 0
        localAudioCropEndMs = Int(AlarmAudioLimits.maxDurationMillis)
        localAudioMessage = "음성 오디오를 지웠어요."
    }

    func cachedLocalAudioForSave(existing: LocalAlarmRecord?) async throws -> CachedLocalAlarmAudio {
        let hasNewSource = selectedLocalAudioURL != nil || localRecorder.latestRecordingURL != nil
        if hasNewSource {
            let prepared = try await preparedLocalAlarmAudioSource()
            let data = try Data(contentsOf: prepared.url)
            let cacheKey = AudioCacheStore.computeCacheKey(data)
            let mimeType = AudioCacheStore.mimeType(forFormat: prepared.url.pathExtension.isEmpty ? "m4a" : prepared.url.pathExtension)
            let cachedURL = try await AudioCacheStore.shared.cacheBytesOffMain(
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

    func existingLocalAudioURL() -> URL? {
        guard !clearExistingLocalAudio,
              let alarm = editingAlarm,
              alarm.voiceSourceEnum == .localAudio,
              let cacheKey = alarm.audioCacheKey else {
            return nil
        }
        return AudioCacheStore.shared.cachedURL(for: cacheKey)
    }

    func preparedLocalAlarmAudioSource() async throws -> (url: URL, durationMs: Int) {
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

    func copyImportedAudio(_ source: URL) throws -> URL {
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

    func readAudioDurationMs(_ url: URL) async throws -> Int {
        let asset = AVURLAsset(url: url, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
        let duration = try await asset.load(.duration)
        let seconds = CMTimeGetSeconds(duration)
        guard seconds.isFinite, seconds > 0 else {
            throw LocalAlarmAudioError.invalidDuration
        }
        return Int((seconds * 1000).rounded())
    }


    func localAudioUploadDisplayName(for url: URL) -> String {
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

    func errorMessage(_ error: AlarmEditDraft.ValidationError) -> String {
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
            return "목소리 크기는 30–100% 사이여야 해요."
        }
    }
}
