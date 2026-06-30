import AVFoundation
import SwiftUI
import UIKit
import UniformTypeIdentifiers

private enum VoiceCloneSourceMode: String, CaseIterable, Identifiable {
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

/// 녹음/파일 선택 -> 60~120초 검증 -> 노이즈 제거 옵션 -> upload -> status 표시 워크플로우.
///
/// Android `VoiceProfileManagementPanel.kt:577~764` 의 생성 다이얼로그를 SwiftUI 자체
/// 화면으로 분리한 것. 녹음은 `VoiceStudioViewModel.recorder`, 파일은 `fileImporter` 와
/// `AudioCropper` 를 활용하고, 업로드는 입력 방식과 noiseRemovalEnabled 에 따라 분기한다.
struct VoiceCloneUploadFlow: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var voice: VoiceStudioViewModel
    @EnvironmentObject private var socialFeatures: SocialFeatureViewModel
    @EnvironmentObject private var subscriptions: SubscriptionManager

    @Binding var route: VoicesRoute

    @State private var sourceMode: VoiceCloneSourceMode = .record
    @State private var profileName: String = ""
    @State private var relationshipSelection = VoiceRelationshipSelection()
    @State private var noiseRemovalEnabled: Bool = false
    @State private var isShared: Bool = false
    /// 목소리 성별('male'|'female'|'neutral', 기본 neutral)과 일본어 정중체 선택.
    /// 켜면 speech_formality='polite', 끄면 'auto'(기본). Android `VoiceProfileManagementPanel.kt:340-341`.
    @State private var voiceGender: String = "neutral"
    @State private var japanesePolite: Bool = false
    /// Android 생성 플로우처럼 랜덤 문구와 공유 음성에서 쓸 호칭을 함께 저장한다.
    @State private var listenerTitle: String = ""
    @State private var submitted: Bool = false
    @State private var fileImporterPresented: Bool = false
    @State private var selectedFileURL: URL?
    @State private var selectedFileName: String?
    @State private var selectedFileDurationMs: Int?
    @State private var cropStartMs: Int = 0
    @State private var cropEndMs: Int = VoiceProfileLimits.maxDurationMs
    @State private var localError: String?
    @State private var animatedLevel: CGFloat = 0.0
    @State private var levelTimer: Timer?
    @State private var usageGuidePresented = false

    /// 처음 목소리를 만드는 사용자를 위한 단계 가이드 (handoff 코치마크 카피 참고).
    private static let usageGuideSteps: [UsageGuideStep] = [
        UsageGuideStep(
            systemImage: "mic.fill",
            title: "조용한 곳에서 녹음해요",
            body: "1분 이상 2분 이하로 평소 목소리처럼 또박또박 읽어 주세요. 가지고 있는 음성 파일이나 영상으로도 만들 수 있어요."
        ),
        UsageGuideStep(
            systemImage: "person.text.rectangle",
            title: "누구의 목소리인지 알려줘요",
            body: "이름·관계와 '나를 부를 호칭'을 입력하면, 랜덤 문구에서 그 호칭으로 다정하게 불러줘요."
        ),
        UsageGuideStep(
            systemImage: "sparkles",
            title: "학습을 시작하면 완성",
            body: "학습이 끝난 목소리는 알람 만들기의 재생 방식에서 골라 쓸 수 있어요."
        ),
    ]

    private var activeDurationMs: Int {
        switch sourceMode {
        case .record:
            return voice.recorder.latestDurationMs ?? Int(voice.recorder.elapsedSeconds * 1000)
        case .file:
            return cropDurationMs
        }
    }

    private var cropDurationMs: Int {
        max(0, cropEndMs - cropStartMs)
    }

    /// 60~120초 구간 검증. 상단은 Android 처럼 5초 허용 오차를 둬 120.x초 측정값도 받아들인다.
    private var isInValidRange: Bool {
        activeDurationMs >= VoiceProfileLimits.minDurationMs
            && activeDurationMs <= VoiceProfileLimits.maxDurationMs + VoiceProfileLimits.maxDurationToleranceMs
    }

    private var hasPreparedSource: Bool {
        switch sourceMode {
        case .record:
            return voice.recorder.latestRecordingURL != nil
        case .file:
            return selectedFileURL != nil && selectedFileDurationMs != nil
        }
    }

    private var canSubmit: Bool {
        !voice.isBusy
            && !voice.recorder.isRecording
            && canCreateVoice
            && hasPreparedSource
            && isInValidRange
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            header
            nameSection
            voiceTuningSection
            sourceModeSection
            if sourceMode == .record {
                recordingSection
            } else {
                fileSection
            }
            durationSection
            optionsSection
            guidanceSection
            actionsSection
            statusSection
        }
        .onAppear {
            profileName = voice.cloneName
            if !UsageGuideStore().hasSeen(.voiceClone) {
                usageGuidePresented = true
            }
        }
        .onDisappear { levelTimer?.invalidate() }
        .sheet(isPresented: $usageGuidePresented, onDismiss: {
            UsageGuideStore().markSeen(.voiceClone)
        }) {
            UsageGuideSheet(steps: Self.usageGuideSteps) {
                usageGuidePresented = false
            }
        }
        .fileImporter(
            isPresented: $fileImporterPresented,
            allowedContentTypes: VoiceImportContentTypes.profileTraining,
            allowsMultipleSelection: false
        ) { result in
            switch result {
            case .success(let urls):
                guard let source = urls.first else { return }
                Task { await importAudioFile(source) }
            case .failure(let error):
                localError = AudioUserFacingError.message(for: error, fallback: "파일을 선택하지 못했어요.")
            }
        }
        .onChange(of: sourceMode) { _, newValue in
            if newValue == .file, voice.recorder.isRecording {
                voice.stopRecording()
                stopLevelAnimation()
            }
        }
        .onChange(of: voice.recorder.isRecording) { wasRecording, isRecording in
            // 2분 하드 캡(VoiceRecorder) 으로 녹음이 자동 정지되면, 수동 정지와 동일하게
            // 파형 애니메이션을 멈추고 안내 문구를 '저장' 상태로 갱신한다. Android `:599-601`.
            guard wasRecording, !isRecording else { return }
            stopLevelAnimation()
            if voice.recorder.latestRecordingURL != nil {
                voice.statusMessage = "녹음을 저장했어요. \(voice.recordingDurationLabel)"
            }
        }
    }

    private var header: some View {
        HStack(alignment: .center) {
            Button(action: { route = .management }) {
                Label("뒤로", systemImage: "chevron.left")
            }
            .buttonStyle(.borderless)
            .tint(AlarmTalkTheme.primary)
            Spacer()
            Text("목소리 만들기")
                .font(.headline)
            Spacer()
            Button {
                usageGuidePresented = true
            } label: {
                Image(systemName: "questionmark.circle")
            }
            .buttonStyle(.borderless)
            .tint(AlarmTalkTheme.textSecondary)
            .accessibilityLabel(Text("사용 가이드"))
        }
    }

    private var nameSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("이름")
                .font(.caption.weight(.semibold))
                .foregroundStyle(AlarmTalkTheme.textSecondary)
            TextField("목소리 이름", text: $profileName)
                .textFieldStyle(.roundedBorder)
                .onChange(of: profileName) { _, newValue in
                    voice.cloneName = newValue
                    if newValue.count > 50 {
                        profileName = String(newValue.prefix(50))
                        voice.cloneName = profileName
                    }
                }
            if submitted && profileName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Text("목소리 이름을 입력해 주세요.")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(AlarmTalkTheme.error)
            }

            VoiceRelationshipInputField(
                selection: $relationshipSelection,
                submitted: submitted
            )
            .padding(.top, 4)

            Text("이 목소리가 부를 호칭")
                .font(.caption.weight(.semibold))
                .foregroundStyle(AlarmTalkTheme.textSecondary)
                .padding(.top, 4)
            TextField("예: 지호야, 우리 강아지", text: $listenerTitle)
                .textFieldStyle(.roundedBorder)
                .onChange(of: listenerTitle) { _, newValue in
                    if newValue.count > 30 {
                        listenerTitle = String(newValue.prefix(30))
                    }
                }
            if submitted && listenerTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Text("이 목소리가 나를 부를 이름을 입력해 주세요.")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(AlarmTalkTheme.error)
            } else {
                Text("랜덤 문구에서 이 이름으로 나를 불러요.")
                    .font(.caption2)
                    .foregroundStyle(AlarmTalkTheme.textSecondary)
            }
            VoiceListenerPreviewCard(
                listenerTitle: listenerTitle,
                relationshipLabel: relationshipSelection.resolved
            )
            HStack(spacing: 10) {
                Toggle(isOn: $isShared) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("목소리 공유")
                            .font(.footnote.weight(.semibold))
                        Text(shareDescription)
                            .font(.caption2)
                            .foregroundStyle(AlarmTalkTheme.textSecondary)
                    }
                }
                .toggleStyle(.switch)
                .disabled(!canShareVoice)
            }
        }
        .sectionSurface()
    }

    /// 목소리 성별(male/female/neutral)·일본어 정중체(speech_formality) 선택 카드.
    /// Android `VoiceProfileManagementPanel.kt:207-289,1390-1397` 의 VoiceGenderSelector /
    /// JapanesePoliteToggle 를 옮겼다. 생성 시 두 값을 항상 함께 전송해 일본어 1인칭·말투
    /// 자연성과 성별 튜닝 기준을 백엔드와 맞춘다.
    private var voiceTuningSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 8) {
                Text("목소리 성별")
                    .font(.subheadline.weight(.semibold))
                HStack(spacing: 8) {
                    genderChip(value: "male", label: "남성")
                    genderChip(value: "female", label: "여성")
                    genderChip(value: "neutral", label: "중립")
                }
            }
            Toggle(isOn: $japanesePolite) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("일본어 정중체")
                        .font(.subheadline.weight(.semibold))
                    Text("일본어로 말할 때 정중한 말투(です·ます)를 써요.")
                        .font(.caption)
                        .foregroundStyle(AlarmTalkTheme.textSecondary)
                }
            }
            .toggleStyle(.switch)
            .tint(AlarmTalkTheme.primary)
        }
        .sectionSurface()
    }

    private func genderChip(value: String, label: String) -> some View {
        let isSelected = voiceGender == value
        return Button {
            voiceGender = value
        } label: {
            Text(label)
                .font(.subheadline.weight(.semibold))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 11)
                .background(
                    isSelected ? AlarmTalkTheme.primary.opacity(0.15) : AlarmTalkTheme.surfaceVariant.opacity(0.45),
                    in: RoundedRectangle(cornerRadius: 14)
                )
                .foregroundStyle(isSelected ? AlarmTalkTheme.primary : AlarmTalkTheme.text)
        }
        .buttonStyle(.plain)
    }

    private var recordingSection: some View {
        VStack(alignment: .center, spacing: 14) {
            // 큰 원형 녹음 버튼.
            Button {
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                if voice.recorder.isRecording {
                    voice.stopRecording()
                    stopLevelAnimation()
                } else {
                    Task {
                        await voice.startRecording()
                        startLevelAnimation()
                    }
                }
            } label: {
                ZStack {
                    Circle()
                        .fill(voice.recorder.isRecording ? AlarmTalkTheme.error : AlarmTalkTheme.primary)
                        .frame(width: 100, height: 100)
                        .overlay(
                            Circle()
                                .stroke(Color.white.opacity(0.5), lineWidth: 4)
                                .scaleEffect(1.0 + animatedLevel * 0.2)
                                .opacity(voice.recorder.isRecording ? 1 : 0)
                        )
                    Image(systemName: voice.recorder.isRecording ? "stop.fill" : "mic.fill")
                        .font(.system(size: 36, weight: .bold))
                        .foregroundStyle(.white)
                }
            }
            .buttonStyle(.plain)

            Text(voice.recorder.isRecording ? "녹음 중…" : (voice.recorder.latestRecordingURL == nil ? "녹음을 시작해 주세요" : "녹음을 저장했어요"))
                .font(.subheadline.weight(.semibold))

            // 단순 파형 시각화 — 18개 막대를 임의 높이로.
            RecordingWaveform(active: voice.recorder.isRecording, level: animatedLevel)
        }
        .frame(maxWidth: .infinity)
        .sectionSurface()
    }

    private var sourceModeSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("입력 방식")
                .font(.subheadline.weight(.semibold))
            Picker("입력 방식", selection: $sourceMode) {
                ForEach(VoiceCloneSourceMode.allCases) { mode in
                    Text(mode.label).tag(mode)
                }
            }
            .pickerStyle(.segmented)
        }
        .sectionSurface()
    }

    private var fileSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("파일/영상으로 목소리 만들기")
                        .font(.subheadline.weight(.semibold))
                    Text("1분 이상 2분 이하 구간만 학습에 사용할 수 있어요.")
                        .font(.caption)
                        .foregroundStyle(AlarmTalkTheme.textSecondary)
                }
                Spacer(minLength: 0)
                Button {
                    fileImporterPresented = true
                } label: {
                    Label("선택", systemImage: "folder")
                }
                .buttonStyle(.bordered)
            }

            if let url = selectedFileURL, let durationMs = selectedFileDurationMs {
                fileCropCard(url: url, durationMs: durationMs)
            } else {
                EmptyStatePlaceholder(
                    title: "선택한 음성 파일이나 영상이 없어요.",
                    subtitle: "m4a, mp3, wav, mp4 등 iOS가 읽을 수 있는 파일을 선택해 주세요.",
                    icon: "folder.badge.plus"
                )
            }

            if let localError {
                Text(localError)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(AlarmTalkTheme.error)
            }
        }
        .sectionSurface()
    }

    private func fileCropCard(url: URL, durationMs: Int) -> some View {
        let effectiveEndMs = min(cropEndMs, durationMs)
        let effectiveDurationMs = max(0, effectiveEndMs - cropStartMs)
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(selectedFileName ?? "선택한 파일")
                        .font(.subheadline.weight(.semibold))
                    Text("전체 \(HelperFormatters.audioTimeLabel(durationMs)) · 사용할 구간 \(HelperFormatters.audioTimeLabel(effectiveDurationMs))")
                        .font(.caption)
                        .foregroundStyle(AlarmTalkTheme.textSecondary)
                }
                Spacer(minLength: 0)
                Button {
                    clearImportedFile()
                } label: {
                    Image(systemName: "xmark.circle")
                }
                .buttonStyle(.borderless)
                .foregroundStyle(AlarmTalkTheme.textSecondary)
            }

            if durationMs >= VoiceProfileLimits.minDurationMs {
                VStack(alignment: .leading, spacing: 6) {
                    Text("자를 구간 \(HelperFormatters.audioTimeLabel(cropStartMs)) - \(HelperFormatters.audioTimeLabel(effectiveEndMs))")
                        .font(.caption.weight(.semibold))
                    // Android `AudioCropRangeSelector` 처럼 양쪽 핸들로 60~120초 구간을 직접 고른다
                    // (이전엔 시작점만 움직이고 길이는 항상 120초로 고정됐음).
                    AudioCropRangeSlider(
                        durationMs: durationMs,
                        minDurationMs: VoiceProfileLimits.minDurationMs,
                        maxDurationMs: VoiceProfileLimits.maxDurationMs,
                        cropStartMs: $cropStartMs,
                        cropEndMs: $cropEndMs
                    )
                    Text("1분 이상 2분 이하 구간을 골라 주세요.")
                        .font(.caption2)
                        .foregroundStyle(AlarmTalkTheme.textSecondary)
                }
            }

            VoiceSegmentPreviewPlayer(
                title: "선택 구간 미리듣기",
                subtitle: "\(HelperFormatters.audioTimeLabel(cropStartMs)) - \(HelperFormatters.audioTimeLabel(effectiveEndMs))",
                audioURL: url,
                startMs: cropStartMs,
                endMs: effectiveEndMs,
                onError: { localError = $0 }
            )

            if durationMs < VoiceProfileLimits.minDurationMs {
                Text("1분 이상 파일을 선택해 주세요.")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(AlarmTalkTheme.error)
            } else if effectiveDurationMs < VoiceProfileLimits.minDurationMs {
                Text("1분 이상 들리는 구간을 선택해 주세요.")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(AlarmTalkTheme.error)
            }
        }
        .padding(12)
        .background(AlarmTalkTheme.surfaceVariant.opacity(0.44), in: RoundedRectangle(cornerRadius: 12))
    }

    private var durationSection: some View {
        let elapsedSec = activeDurationMs / 1000
        let total = VoiceProfileLimits.maxDurationMs / 1000
        let progress = min(1.0, Double(activeDurationMs) / Double(VoiceProfileLimits.maxDurationMs))
        let validZoneStart = Double(VoiceProfileLimits.minDurationMs) / Double(VoiceProfileLimits.maxDurationMs)
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("길이")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Text(String(format: "%d:%02d / %d:%02d",
                            elapsedSec / 60, elapsedSec % 60,
                            total / 60, total % 60))
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(isInValidRange ? AlarmTalkTheme.accent : AlarmTalkTheme.textSecondary)
            }
            ZStack(alignment: .leading) {
                GeometryReader { geo in
                    // valid zone (60s ~ 120s) 강조.
                    Rectangle()
                        .fill(AlarmTalkTheme.accent.opacity(0.15))
                        .frame(width: geo.size.width * (1 - validZoneStart), height: 8)
                        .offset(x: geo.size.width * validZoneStart)
                    // progress.
                    Rectangle()
                        .fill(isInValidRange ? AlarmTalkTheme.accent : AlarmTalkTheme.primary)
                        .frame(width: geo.size.width * progress, height: 8)
                    // 60s 마커.
                    Rectangle()
                        .fill(AlarmTalkTheme.accent)
                        .frame(width: 2, height: 16)
                        .offset(x: geo.size.width * validZoneStart - 1, y: -4)
                }
                .frame(height: 8)
                .clipShape(RoundedRectangle(cornerRadius: 4))
                .background(AlarmTalkTheme.surfaceVariant, in: RoundedRectangle(cornerRadius: 4))
            }
            .frame(height: 8)

            Text(sourceMode == .record ? "1분 이상 2분 이하로 녹음해 주세요. 1분 30초를 권장해요." : "1분 이상 2분 이하 구간만 사용할 수 있어요.")
                .font(.footnote)
                .foregroundStyle(AlarmTalkTheme.textSecondary)
            if !isInValidRange && activeDurationMs > 0 {
                Text(activeDurationMs < VoiceProfileLimits.minDurationMs
                     ? "1분 이상 준비해야 등록할 수 있어요."
                     : "2분 이내 구간만 사용할 수 있어요.")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(AlarmTalkTheme.error)
            }
        }
        .sectionSurface()
    }

    private var optionsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Toggle(isOn: $noiseRemovalEnabled) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("배경음 자동 제거")
                        .font(.subheadline.weight(.semibold))
                    Text("기차·카페 같은 환경음을 줄여 학습 품질을 높여요.")
                        .font(.caption)
                        .foregroundStyle(AlarmTalkTheme.textSecondary)
                }
            }
        }
        .sectionSurface()
    }

    private var guidanceSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("녹음 예시")
                .font(.subheadline.weight(.semibold))
            Text("아래 문장을 자연스럽게 읽고, 중간중간 쉬면서 평소 목소리를 유지해 주세요.")
                .font(.caption)
                .foregroundStyle(AlarmTalkTheme.textSecondary)
            VStack(alignment: .leading, spacing: 4) {
                bulletLine("좋은 아침이야. 이제 천천히 일어날 시간이야.")
                bulletLine("오늘 하루도 정말 고생했어. 잠깐 숨을 고르고 쉬어도 돼.")
                bulletLine("내 목소리가 알람으로 들린다면 어떤 말이 가장 힘이 될지 생각하며 편하게 말해볼게.")
            }
        }
        .sectionSurface()
    }

    private func bulletLine(_ text: String) -> some View {
        HStack(alignment: .top, spacing: 6) {
            Text("•").foregroundStyle(AlarmTalkTheme.primary)
            Text(text).font(.footnote).foregroundStyle(AlarmTalkTheme.textSecondary)
        }
    }

    private var actionsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                if sourceMode == .record {
                    Button {
                        voice.playRecording()
                    } label: {
                        Label("들어보기", systemImage: "play.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .disabled(voice.recorder.latestRecordingURL == nil)
                }

                Button {
                    Task { await submit() }
                } label: {
                    Label(noiseRemovalEnabled ? "노이즈 제거 학습" : "학습 시작",
                          systemImage: "icloud.and.arrow.up")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(AlarmTalkTheme.primary)
                .disabled(!canSubmit)
            }
            if voice.isBusy {
                ProgressView("처리 중…")
                    .frame(maxWidth: .infinity)
            }
        }
    }

    @ViewBuilder
    private var statusSection: some View {
        if let message = voice.statusMessage, !message.isEmpty {
            Text(message)
                .font(.footnote)
                .foregroundStyle(AlarmTalkTheme.textSecondary)
                .padding(.horizontal, 4)
        }
    }

    // MARK: - Actions

    private func submit() async {
        submitted = true
        guard hasPaidVoiceAccess else {
            voice.statusMessage = "유료 이용권에서 사용할 수 있어요."
            return
        }
        guard !voice.isProfileLimitReached else {
            voice.statusMessage = "목소리는 최대 \(VoiceProfileLimits.maxProfiles)개까지 만들 수 있어요."
            return
        }
        let trimmedName = profileName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty else {
            voice.statusMessage = "목소리 이름을 입력해 주세요."
            return
        }
        let trimmedRelationship = relationshipSelection.resolved
        guard !trimmedRelationship.isEmpty else {
            voice.statusMessage = "나와의 관계를 입력해 주세요."
            return
        }
        let trimmedListener = listenerTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedListener.isEmpty else {
            voice.statusMessage = "이 목소리가 나를 부를 이름을 입력해 주세요."
            return
        }
        // 일본어 정중체 토글: 켜면 'polite', 끄면 'auto'. Android `:966,992` 미러.
        let speechFormality = japanesePolite ? "polite" : "auto"

        switch sourceMode {
        case .record:
            guard let url = voice.recorder.latestRecordingURL,
                  let durationMs = voice.recorder.latestDurationMs else {
                voice.statusMessage = "먼저 목소리를 녹음해 주세요."
                return
            }
            if noiseRemovalEnabled {
                let _ = await voice.cloneWithNoiseRemoval(
                    audioFileURL: url,
                    name: trimmedName,
                    durationMs: durationMs,
                    isShared: shouldShareVoice,
                    session: auth.session,
                    relationshipLabel: trimmedRelationship,
                    listenerTitle: trimmedListener,
                    voiceGender: voiceGender,
                    speechFormality: speechFormality
                )
            } else {
                voice.cloneName = trimmedName
                await voice.uploadRecordingForClone(
                    session: auth.session,
                    isShared: shouldShareVoice,
                    relationshipLabel: trimmedRelationship,
                    listenerTitle: trimmedListener,
                    voiceGender: voiceGender,
                    speechFormality: speechFormality
                )
            }
        case .file:
            do {
                let prepared = try await preparedFileAudio()
                _ = await voice.cloneAudioForProfile(
                    audioFileURL: prepared.url,
                    name: trimmedName,
                    durationMs: prepared.durationMs,
                    isShared: shouldShareVoice,
                    session: auth.session,
                    noiseRemoval: noiseRemovalEnabled,
                    uploadFileName: prepared.uploadFileName,
                    relationshipLabel: trimmedRelationship,
                    listenerTitle: trimmedListener,
                    voiceGender: voiceGender,
                    speechFormality: speechFormality
                )
            } catch {
                let message = AudioUserFacingError.message(for: error, fallback: "선택한 음성을 준비하지 못했어요.")
                localError = message
                voice.statusMessage = message
                return
            }
        }
        // 성공 시 management 로 복귀.
        if voice.statusMessage?.contains("등록") == true || voice.statusMessage?.contains("완료") == true {
            route = .management
        }
    }

    private var canShareVoice: Bool {
        canShareVoiceWithOthers(
            subscriptionResponse: socialFeatures.subscription,
            familyGroup: socialFeatures.familyGroup,
            authSession: auth.session,
            storeTier: subscriptions.currentTier,
            userPlan: auth.session?.user.plan
        )
    }

    private var hasPaidVoiceAccess: Bool {
        PlanTier.bestKnown(
            serverSubscription: socialFeatures.subscription,
            storeTier: subscriptions.currentTier,
            userPlan: auth.session?.user.plan
        )
        .meetsOrExceeds(.personal)
    }

    private var canCreateVoice: Bool {
        hasPaidVoiceAccess && !voice.isProfileLimitReached
    }

    private var shouldShareVoice: Bool {
        isShared && canShareVoice
    }

    private var shareDescription: String {
        if !canShareVoice {
            return "공유는 커플/가족 이용권에서 사용할 수 있어요."
        }
        return isShared ? "이용권을 같이 사용하는 사람들에게 목소리를 공유해요." : "내 계정에서만 사용해요."
    }

    private func importAudioFile(_ source: URL) async {
        do {
            let importedURL = try copyImportedAudio(source)
            let durationMs = try await readAudioDurationMs(importedURL)
            await MainActor.run {
                selectedFileURL = importedURL
                selectedFileName = source.lastPathComponent
                selectedFileDurationMs = durationMs
                applyCropDefaults(durationMs: durationMs)
                localError = durationMs < VoiceProfileLimits.minDurationMs
                    ? "1분 이상 파일을 선택해 주세요."
                    : nil
            }
        } catch {
            await MainActor.run {
                localError = AudioUserFacingError.message(for: error, fallback: "선택한 파일을 준비하지 못했어요.")
            }
        }
    }

    private func preparedFileAudio() async throws -> (url: URL, durationMs: Int, uploadFileName: String?) {
        guard let source = selectedFileURL,
              let sourceDuration = selectedFileDurationMs else {
            throw AudioCropper.CropperError.invalidRange
        }
        let uploadFileName = selectedFileName ?? source.lastPathComponent
        let endMs = min(cropEndMs, sourceDuration)
        let durationMs = max(0, endMs - cropStartMs)
        guard durationMs >= VoiceProfileLimits.minDurationMs else {
            throw AudioCropper.CropperError.invalidRange
        }
        guard durationMs <= VoiceProfileLimits.maxDurationMs else {
            throw AudioCropper.CropperError.invalidRange
        }
        guard AudioCropper.shouldExportAudioOnly(
            source: source,
            startMs: cropStartMs,
            endMs: endMs,
            sourceDurationMs: sourceDuration
        ) else {
            return (source, durationMs, uploadFileName)
        }
        let audioOnly = try await AudioCropper.crop(source: source, startMs: cropStartMs, endMs: endMs)
        return (audioOnly, durationMs, uploadFileName)
    }

    private func copyImportedAudio(_ source: URL) throws -> URL {
        let scoped = source.startAccessingSecurityScopedResource()
        defer {
            if scoped {
                source.stopAccessingSecurityScopedResource()
            }
        }
        let directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("VoiceImports", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let ext = source.pathExtension.isEmpty ? "m4a" : source.pathExtension
        let destination = directory.appendingPathComponent("clone-import-\(UUID().uuidString).\(ext)")
        try FileManager.default.copyItem(at: source, to: destination)
        return destination
    }

    private func readAudioDurationMs(_ url: URL) async throws -> Int {
        let asset = AVURLAsset(url: url, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
        let audioTracks = try await asset.loadTracks(withMediaType: .audio)
        guard !audioTracks.isEmpty else {
            throw AudioCropper.CropperError.noAudioTrack
        }
        let duration = try await asset.load(.duration)
        let seconds = CMTimeGetSeconds(duration)
        guard seconds.isFinite, seconds > 0 else {
            throw AudioCropper.CropperError.invalidRange
        }
        return Int((seconds * 1000).rounded())
    }

    private func applyCropDefaults(durationMs: Int) {
        cropStartMs = 0
        cropEndMs = min(durationMs, VoiceProfileLimits.maxDurationMs)
    }

    private func clearImportedFile() {
        selectedFileURL = nil
        selectedFileName = nil
        selectedFileDurationMs = nil
        cropStartMs = 0
        cropEndMs = VoiceProfileLimits.maxDurationMs
        localError = nil
    }


    private func startLevelAnimation() {
        levelTimer?.invalidate()
        levelTimer = Timer.scheduledTimer(withTimeInterval: 0.15, repeats: true) { _ in
            Task { @MainActor in
                // 가벼운 랜덤 워크. 실제 amplitude 는 VoiceRecorder 가 노출하지 않으므로
                // 시각적 신호만 제공.
                animatedLevel = CGFloat.random(in: 0.2...1.0)
            }
        }
    }

    private func stopLevelAnimation() {
        levelTimer?.invalidate()
        levelTimer = nil
        animatedLevel = 0
    }
}

// MARK: - Waveform

/// 녹음 중 보여줄 단순 막대 파형. 실제 마이크 amplitude 미사용 시 fallback.
private struct RecordingWaveform: View {
    let active: Bool
    let level: CGFloat

    var body: some View {
        HStack(spacing: 3) {
            ForEach(0..<18) { idx in
                Capsule()
                    .fill(active ? AlarmTalkTheme.error : AlarmTalkTheme.outline)
                    .frame(width: 4, height: barHeight(for: idx))
            }
        }
        .frame(height: 44)
    }

    private func barHeight(for idx: Int) -> CGFloat {
        if !active {
            return 8 + CGFloat((idx % 4)) * 2.5
        }
        let phaseOffset = sin(Double(idx) * 0.6 + Double(level) * 4.0)
        let amplitude = 12 + CGFloat(abs(phaseOffset)) * 28 * level
        return max(8, amplitude)
    }
}

#if DEBUG
#Preview("VoiceCloneUploadFlow (light)") {
    VoiceCloneUploadFlow(route: .constant(.clone))
        .voiceAlarmPreviewEnvironment()
}

#Preview("VoiceCloneUploadFlow (dark)") {
    VoiceCloneUploadFlow(route: .constant(.clone))
        .preferredColorScheme(.dark)
        .voiceAlarmPreviewEnvironment()
}
#endif
