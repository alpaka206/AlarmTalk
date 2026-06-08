import AVFoundation
import SwiftUI
import UniformTypeIdentifiers

private enum SpeakerDraftStatus {
    case cloning
    case synthesizing
    case ready
    case failed
}

private struct SpeakerDraftState {
    var profileId: String?
    var previewURL: URL?
    var status: SpeakerDraftStatus = .cloning
    var errorMessage: String?

    var isReady: Bool {
        status == .ready && previewURL != nil && profileId != nil
    }
}

/// 화자 분리 워크플로우.
///
/// 1. 녹음 또는 기존 녹음 사용 -> raw upload (`uploadForSeparation`)
/// 2. `runSeparation(uploadId:)` 호출 -> [VoiceSpeakerSegment]
/// 3. 각 화자별 draft 목소리 생성 -> 생성 음성 미리듣기
/// 4. 선택한 draft 만 정식 목소리로 승격하고 나머지는 삭제
///
/// Android `VoiceProfileManagementPanel.kt:660~764` 의 화자 분리 블록을 풀어쓴 화면.
struct SpeakerSeparationFlow: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var voice: VoiceStudioViewModel
    @EnvironmentObject private var socialFeatures: SocialFeatureViewModel
    @EnvironmentObject private var subscriptions: SubscriptionManager

    @Binding var route: VoicesRoute

    @State private var uploadId: String?
    @State private var uploadedAudioURL: URL?
    @State private var uploadedDurationMs: Int?
    @State private var speakers: [VoiceSpeakerSegment] = []
    @State private var speakerDraftStates: [String: SpeakerDraftState] = [:]
    @State private var speakerDraftRunID = UUID()
    @State private var activePreviewSpeakerId: String?
    @State private var promotingSpeakerId: String?
    @State private var removedSpeakerIds: Set<String> = []
    @State private var profileName: String = "분리한 목소리"
    @State private var separationBusy: Bool = false
    @State private var fileImporterPresented: Bool = false
    @State private var selectedFileURL: URL?
    @State private var selectedFileName: String?
    @State private var selectedFileDurationMs: Int?
    @State private var cropStartMs: Int = 0
    @State private var cropEndMs: Int = VoiceProfileLimits.maxDurationMs
    @State private var localError: String?

    private var preparedSourceURL: URL? {
        selectedFileURL ?? voice.recorder.latestRecordingURL
    }

    private var preparedSourceName: String {
        selectedFileName ?? "최근 녹음"
    }

    private var preparedUploadFileName: String {
        selectedFileName ?? preparedSourceURL?.lastPathComponent ?? preparedSourceName
    }

    private var preparedDurationMs: Int? {
        selectedFileDurationMs ?? voice.recorder.latestDurationMs
    }

    private var cropDurationMs: Int {
        max(0, cropEndMs - cropStartMs)
    }

    private var preparedSourceReady: Bool {
        guard preparedSourceURL != nil,
              let duration = preparedDurationMs else {
            return false
        }
        return duration >= VoiceProfileLimits.minDurationMs &&
            cropDurationMs >= VoiceProfileLimits.minDurationMs &&
            cropDurationMs <= VoiceProfileLimits.maxDurationMs
    }

    private var canCreateVoice: Bool {
        hasPaidVoiceAccess && !voice.isProfileLimitReached
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            header
            introCard
            stepRecord
            if uploadId != nil {
                stepSeparate
            }
            if !speakers.isEmpty {
                stepPick
            }
            if let localError {
                Text(localError)
                    .font(.footnote)
                    .foregroundStyle(VoiceAlarmTheme.error)
                    .padding(.horizontal, 4)
            }
            if let status = voice.statusMessage {
                Text(status)
                    .font(.footnote)
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
                    .padding(.horizontal, 4)
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
        .onChange(of: voice.recorder.latestDurationMs) { _, durationMs in
            guard selectedFileURL == nil, let durationMs else { return }
            cleanupDrafts()
            applyCropDefaults(durationMs: durationMs)
            uploadId = nil
            uploadedAudioURL = nil
            uploadedDurationMs = nil
            speakers.removeAll()
            removedSpeakerIds.removeAll()
        }
        .onChange(of: voice.previewPlayer.isPlaying) { _, playing in
            if !playing {
                activePreviewSpeakerId = nil
            }
        }
        .onDisappear {
            cleanupDrafts()
        }
    }

    private var header: some View {
        HStack {
            Button(action: { route = .management }) {
                Label("뒤로", systemImage: "chevron.left")
            }
            .buttonStyle(.borderless)
            .tint(VoiceAlarmTheme.primary)
            Spacer()
            Text("화자 분리")
                .font(.headline)
            Spacer()
            Color.clear.frame(width: 40, height: 1)
        }
    }

    private var introCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("여러 명이 함께 녹음됐을 때 가장 잘 들리는 한 명을 골라 학습할 수 있어요.")
                .font(.subheadline)
            Text("최대 3명까지 분리하고, 1분 이상 충분히 들리는 화자만 등록할 수 있어요.")
                .font(.caption)
                .foregroundStyle(VoiceAlarmTheme.textSecondary)
        }
        .sectionSurface()
    }

    // MARK: - Step 1: record / use existing

    private var stepRecord: some View {
        VStack(alignment: .leading, spacing: 10) {
            stepLabel(num: 1, title: "여러 화자가 섞인 파일/영상 준비")
            HStack(spacing: 12) {
                Button {
                    if voice.recorder.isRecording {
                        voice.stopRecording()
                    } else {
                        Task { await voice.startRecording() }
                    }
                } label: {
                    Label(voice.recorder.isRecording ? "정지" : "녹음 시작",
                          systemImage: voice.recorder.isRecording ? "stop.fill" : "mic.fill")
                }
                .buttonStyle(.bordered)

                Button {
                    voice.playRecording()
                } label: {
                    Label("들어보기", systemImage: "play.fill")
                }
                .buttonStyle(.bordered)
                .disabled(voice.recorder.latestRecordingURL == nil)

                Button {
                    fileImporterPresented = true
                } label: {
                    Label("파일 선택", systemImage: "folder")
                }
                .buttonStyle(.bordered)
            }
            if let url = preparedSourceURL, let durationMs = preparedDurationMs {
                sourceCropCard(url: url, durationMs: durationMs)
            }
            Button {
                Task { await uploadCurrentRecording() }
            } label: {
                Label("업로드", systemImage: "icloud.and.arrow.up")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(VoiceAlarmTheme.primary)
            .disabled(!preparedSourceReady || !canCreateVoice || voice.isBusy)
        }
        .sectionSurface()
    }

    private func sourceCropCard(url: URL, durationMs: Int) -> some View {
        let effectiveEndMs = min(cropEndMs, durationMs)
        let effectiveDurationMs = max(0, effectiveEndMs - cropStartMs)
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(preparedSourceName)
                        .font(.subheadline.weight(.semibold))
                    Text("전체 \(HelperFormatters.audioTimeLabel(durationMs)) · 사용할 구간 \(HelperFormatters.audioTimeLabel(effectiveDurationMs))")
                        .font(.caption)
                        .foregroundStyle(VoiceAlarmTheme.textSecondary)
                }
                Spacer(minLength: 0)
                Button {
                    clearImportedFile()
                } label: {
                    Image(systemName: "xmark.circle")
                }
                .buttonStyle(.borderless)
                .foregroundStyle(VoiceAlarmTheme.textSecondary)
                .opacity(selectedFileURL == nil ? 0 : 1)
                .disabled(selectedFileURL == nil)
            }

            if durationMs > VoiceProfileLimits.maxDurationMs {
                VStack(alignment: .leading, spacing: 6) {
                    Text("자를 구간 \(HelperFormatters.audioTimeLabel(cropStartMs)) - \(HelperFormatters.audioTimeLabel(cropEndMs))")
                        .font(.caption.weight(.semibold))
                    Slider(
                        value: Binding(
                            get: { Double(cropStartMs) / 1000.0 },
                            set: { seconds in
                                let maxStart = max(0, durationMs - VoiceProfileLimits.maxDurationMs)
                                cropStartMs = min(maxStart, max(0, Int(seconds * 1000)))
                                cropEndMs = min(durationMs, cropStartMs + VoiceProfileLimits.maxDurationMs)
                            }
                        ),
                        in: 0...(Double(max(0, durationMs - VoiceProfileLimits.maxDurationMs)) / 1000.0),
                        step: 1
                    )
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

            if effectiveDurationMs < VoiceProfileLimits.minDurationMs {
                Text("1분 이상 들리는 구간을 선택해 주세요.")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(VoiceAlarmTheme.error)
            }
        }
        .padding(12)
        .background(VoiceAlarmTheme.surfaceVariant.opacity(0.44), in: RoundedRectangle(cornerRadius: 12))
    }

    // MARK: - Step 2: separate

    private var stepSeparate: some View {
        VStack(alignment: .leading, spacing: 10) {
            stepLabel(num: 2, title: "화자 분리 실행")
            Text("AI 가 화자별 구간을 자동으로 분리해요. 잠깐 시간이 걸려요.")
                .font(.caption)
                .foregroundStyle(VoiceAlarmTheme.textSecondary)
            HStack {
                Button {
                    Task { await runSeparate() }
                } label: {
                    Label(separationBusy ? "분리 중…" : "화자 분리 시작",
                          systemImage: "person.2.wave.2")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(VoiceAlarmTheme.primary)
                .disabled(separationBusy || !canCreateVoice || voice.isBusy)

                Button {
                    resetSpeakers()
                } label: {
                    Image(systemName: "arrow.counterclockwise")
                }
                .buttonStyle(.bordered)
                .disabled(speakers.isEmpty)
            }
        }
        .sectionSurface()
    }

    // MARK: - Step 3: pick speakers

    private var stepPick: some View {
        VStack(alignment: .leading, spacing: 10) {
            stepLabel(num: 3, title: "사용할 화자 고르기")
            Text("각 화자의 목소리를 만든 뒤 미리듣고 사용할 목소리를 하나 골라 주세요.")
                .font(.caption)
                .foregroundStyle(VoiceAlarmTheme.textSecondary)
            let visible = speakers.filter { !removedSpeakerIds.contains($0.id) }
            ForEach(Array(visible.enumerated()), id: \.element.id) { idx, speaker in
                speakerCard(speaker: speaker, index: idx)
            }
            if visible.isEmpty {
                Text("표시할 화자가 없어요. 다시 분리해 주세요.")
                    .font(.footnote)
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
            }
        }
        .sectionSurface()
    }

    private func speakerCard(speaker: VoiceSpeakerSegment, index: Int) -> some View {
        let draftState = speakerDraftStates[speaker.id] ?? SpeakerDraftState()
        let isPlaying = activePreviewSpeakerId == speaker.id && voice.previewPlayer.isPlaying
        let isPromoting = promotingSpeakerId == speaker.id
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("목소리 \(index + 1)")
                    .font(.subheadline.weight(.semibold))
                if let label = speaker.label as String?, !label.isEmpty, label != "Speaker A" {
                    Text(label).font(.caption).foregroundStyle(VoiceAlarmTheme.textSecondary)
                }
                Spacer()
                Text(speaker.durationLabel)
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
            }
            HStack(spacing: 8) {
                draftStatusIcon(draftState)
                Text(draftStatusLabel(draftState))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(draftState.status == .failed ? VoiceAlarmTheme.error : VoiceAlarmTheme.textSecondary)
                Spacer(minLength: 0)
                if draftState.status == .cloning || draftState.status == .synthesizing || isPromoting {
                    ProgressView()
                        .controlSize(.small)
                }
            }
            HStack(spacing: 8) {
                Button {
                    toggleDraftPreview(speaker.id)
                } label: {
                    Label(isPlaying ? "일시정지" : "미리듣기",
                          systemImage: isPlaying ? "pause.fill" : "play.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(!draftState.isReady || isPromoting)

                Button {
                    Task { await promoteSpeakerDraft(speaker.id) }
                } label: {
                    Label(isPromoting ? "등록 중" : "이 목소리 선택",
                          systemImage: isPromoting ? "hourglass" : "checkmark.seal")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(VoiceAlarmTheme.primary)
                .disabled(!draftState.isReady || isPromoting || promotingSpeakerId != nil || voice.isBusy)

                Button(role: .destructive) {
                    removeSpeaker(speaker.id)
                } label: {
                    Image(systemName: "xmark.bin")
                }
                .buttonStyle(.bordered)
                .disabled(isPromoting)
            }
        }
        .padding(12)
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(draftState.isReady ? VoiceAlarmTheme.primary.opacity(0.7) : VoiceAlarmTheme.outline, lineWidth: draftState.isReady ? 1.5 : 1)
        )
        .background(VoiceAlarmTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    private func stepLabel(num: Int, title: String) -> some View {
        HStack(spacing: 8) {
            Text("\(num)")
                .font(.caption.weight(.bold))
                .frame(width: 22, height: 22)
                .background(VoiceAlarmTheme.primary, in: Circle())
                .foregroundStyle(.white)
            Text(title)
                .font(.subheadline.weight(.semibold))
        }
    }

    private func draftStatusIcon(_ state: SpeakerDraftState) -> some View {
        let systemName: String
        let color: Color
        switch state.status {
        case .cloning:
            systemName = "waveform"
            color = VoiceAlarmTheme.textSecondary
        case .synthesizing:
            systemName = "speaker.wave.2.fill"
            color = VoiceAlarmTheme.textSecondary
        case .ready:
            systemName = "checkmark.circle.fill"
            color = VoiceAlarmTheme.primary
        case .failed:
            systemName = "exclamationmark.triangle.fill"
            color = VoiceAlarmTheme.error
        }
        return Image(systemName: systemName)
            .font(.caption.weight(.semibold))
            .foregroundStyle(color)
    }

    private func draftStatusLabel(_ state: SpeakerDraftState) -> String {
        switch state.status {
        case .cloning:
            return "목소리를 만드는 중"
        case .synthesizing:
            return "미리듣기를 만드는 중"
        case .ready:
            return "준비 완료"
        case .failed:
            return state.errorMessage ?? "미리듣기를 준비하지 못했어요."
        }
    }

    // MARK: - Actions

    private func importAudioFile(_ source: URL) async {
        do {
            let importedURL = try copyImportedAudio(source)
            let durationMs = try await readAudioDurationMs(importedURL)
            await MainActor.run {
                cleanupDrafts()
                selectedFileURL = importedURL
                selectedFileName = source.lastPathComponent
                selectedFileDurationMs = durationMs
                applyCropDefaults(durationMs: durationMs)
                uploadId = nil
                uploadedAudioURL = nil
                uploadedDurationMs = nil
                speakers.removeAll()
                removedSpeakerIds.removeAll()
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

    private func uploadCurrentRecording() async {
        guard validateCreateVoiceAccess() else { return }
        guard preparedSourceURL != nil,
              preparedDurationMs != nil else {
            localError = "녹음하거나 파일을 선택해 주세요."
            return
        }
        let prepared: (url: URL, durationMs: Int)
        do {
            prepared = try await preparedCroppedAudio()
        } catch {
            if localError == nil {
                localError = AudioUserFacingError.message(for: error, fallback: "선택한 음성을 준비하지 못했어요.")
            }
            return
        }
        localError = nil
        let id = await voice.uploadForSeparation(
            audioFileURL: prepared.url,
            durationMs: prepared.durationMs,
            originalName: preparedUploadFileName,
            session: auth.session
        )
        guard let id else { return }
        await MainActor.run {
            cleanupDrafts()
            self.uploadId = id
            self.uploadedAudioURL = prepared.url
            self.uploadedDurationMs = prepared.durationMs
            self.speakers.removeAll()
            self.removedSpeakerIds.removeAll()
        }
    }

    private func runSeparate() async {
        guard validateCreateVoiceAccess() else { return }
        guard let uploadId else { return }
        cleanupDrafts()
        separationBusy = true
        defer { separationBusy = false }
        let result = await voice.runSeparation(uploadId: uploadId, session: auth.session)
        let visible = result.filter { $0.endMs > $0.startMs }.prefix(3).map { $0 }
        let draftRunID = UUID()
        await MainActor.run {
            self.speakerDraftRunID = draftRunID
            self.speakers = visible
            self.speakerDraftStates = Dictionary(uniqueKeysWithValues: visible.map { ($0.id, SpeakerDraftState(status: .cloning)) })
            self.removedSpeakerIds.removeAll()
        }
        for speaker in visible {
            await prepareSpeakerDraft(speaker, runID: draftRunID)
        }
    }

    private func resetSpeakers() {
        cleanupDrafts()
        speakers.removeAll()
        removedSpeakerIds.removeAll()
    }

    private func prepareSpeakerDraft(_ speaker: VoiceSpeakerSegment, runID: UUID) async {
        guard let source = uploadedAudioURL ?? preparedSourceURL else {
            markDraftFailed(speaker.id, message: "원본 음원을 찾지 못했어요.")
            return
        }
        let endMs = speakerDraftEndMs(for: speaker)
        let durationMs = max(0, endMs - speaker.startMs)
        guard durationMs >= VoiceProfileLimits.minDurationMs else {
            markDraftFailed(speaker.id, message: "1분 이상 들리는 구간이 필요해요.")
            return
        }
        guard durationMs <= VoiceProfileLimits.maxDurationMs else {
            markDraftFailed(speaker.id, message: "2분 이하 구간만 사용할 수 있어요.")
            return
        }
        let cropped: URL
        do {
            cropped = try await cropAudio(source: source, startMs: speaker.startMs, endMs: endMs)
        } catch {
            guard isCurrentDraftRun(runID, speakerId: speaker.id) else { return }
            markDraftFailed(
                speaker.id,
                message: AudioUserFacingError.message(for: error, fallback: "화자 구간을 준비하지 못했어요.")
            )
            return
        }
        guard isCurrentDraftRun(runID, speakerId: speaker.id) else { return }
        let resolvedName = profileName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? "분리한 목소리"
            : profileName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let profile = await voice.cloneSpeakerDraft(
            audioFileURL: cropped,
            name: resolvedName,
            durationMs: durationMs,
            uploadFileName: preparedUploadFileName,
            session: auth.session
        ) else {
            guard isCurrentDraftRun(runID, speakerId: speaker.id) else { return }
            markDraftFailed(speaker.id, message: voice.statusMessage ?? "목소리를 만들지 못했어요.")
            return
        }
        guard isCurrentDraftRun(runID, speakerId: speaker.id) else {
            await voice.deleteDraftVoice(profileId: profile.id, session: auth.session)
            return
        }
        speakerDraftStates[speaker.id] = SpeakerDraftState(
            profileId: profile.id,
            status: .synthesizing
        )
        guard let previewURL = await voice.prepareSpeakerDraftPreview(
            profileId: profile.id,
            session: auth.session
        ) else {
            guard isCurrentDraftRun(runID, speakerId: speaker.id) else {
                await voice.deleteDraftVoice(profileId: profile.id, session: auth.session)
                return
            }
            markDraftFailed(
                speaker.id,
                profileId: profile.id,
                message: voice.statusMessage ?? "미리듣기를 만들지 못했어요."
            )
            await voice.deleteDraftVoice(profileId: profile.id, session: auth.session)
            return
        }
        guard isCurrentDraftRun(runID, speakerId: speaker.id) else {
            await voice.deleteDraftVoice(profileId: profile.id, session: auth.session)
            return
        }
        speakerDraftStates[speaker.id] = SpeakerDraftState(
            profileId: profile.id,
            previewURL: previewURL,
            status: .ready
        )
    }

    private func isCurrentDraftRun(_ runID: UUID, speakerId: String) -> Bool {
        speakerDraftRunID == runID &&
            !removedSpeakerIds.contains(speakerId) &&
            speakers.contains(where: { $0.id == speakerId })
    }

    private func speakerDraftEndMs(for speaker: VoiceSpeakerSegment) -> Int {
        let sourceDuration = uploadedDurationMs
            ?? preparedDurationMs
            ?? max(speaker.endMs, speaker.startMs + VoiceProfileLimits.minDurationMs)
        let desiredDuration = min(
            max(speaker.durationMs, VoiceProfileLimits.minDurationMs),
            VoiceProfileLimits.maxDurationMs
        )
        return min(sourceDuration, speaker.startMs + desiredDuration)
    }

    private func markDraftFailed(_ speakerId: String, profileId: String? = nil, message: String? = nil) {
        var state = speakerDraftStates[speakerId] ?? SpeakerDraftState()
        state.profileId = profileId ?? state.profileId
        state.status = .failed
        state.errorMessage = message
        speakerDraftStates[speakerId] = state
    }

    private func toggleDraftPreview(_ speakerId: String) {
        if activePreviewSpeakerId == speakerId, voice.previewPlayer.isPlaying {
            voice.previewPlayer.stop()
            activePreviewSpeakerId = nil
            return
        }
        guard let previewURL = speakerDraftStates[speakerId]?.previewURL else { return }
        do {
            try voice.previewPlayer.play(url: previewURL)
            activePreviewSpeakerId = speakerId
            localError = nil
        } catch {
            localError = "미리듣기를 재생하지 못했어요."
        }
    }

    private func promoteSpeakerDraft(_ speakerId: String) async {
        guard let profileId = speakerDraftStates[speakerId]?.profileId else { return }
        promotingSpeakerId = speakerId
        voice.previewPlayer.stop()
        defer { promotingSpeakerId = nil }
        let promoted = await voice.promoteDraftVoice(profileId: profileId, session: auth.session)
        guard promoted != nil else {
            localError = voice.statusMessage ?? "목소리를 등록하지 못했어요."
            return
        }
        cleanupDrafts(excluding: [profileId])
        route = .management
    }

    private func removeSpeaker(_ speakerId: String) {
        cleanupDraft(for: speakerId)
        removedSpeakerIds.insert(speakerId)
    }

    private func cleanupDraft(for speakerId: String) {
        let state = speakerDraftStates.removeValue(forKey: speakerId)
        if activePreviewSpeakerId == speakerId {
            voice.previewPlayer.stop()
            activePreviewSpeakerId = nil
        }
        guard let profileId = state?.profileId else { return }
        let session = auth.session
        Task { @MainActor in
            await voice.deleteDraftVoice(profileId: profileId, session: session)
        }
    }

    private func cleanupDrafts(excluding keptProfileIds: Set<String> = []) {
        let profileIds = speakerDraftStates.values
            .compactMap(\.profileId)
            .filter { !keptProfileIds.contains($0) }
        voice.previewPlayer.stop()
        activePreviewSpeakerId = nil
        speakerDraftRunID = UUID()
        speakerDraftStates.removeAll()
        guard !profileIds.isEmpty else { return }
        let session = auth.session
        Task { @MainActor in
            for profileId in profileIds {
                await voice.deleteDraftVoice(profileId: profileId, session: session)
            }
        }
    }

    private var hasPaidVoiceAccess: Bool {
        PlanTier.bestKnown(
            serverSubscription: socialFeatures.subscription,
            storeTier: subscriptions.currentTier,
            userPlan: auth.session?.user.plan
        )
        .meetsOrExceeds(.personal)
    }

    private func validateCreateVoiceAccess() -> Bool {
        guard hasPaidVoiceAccess else {
            localError = "유료 이용권에서 사용할 수 있어요."
            return false
        }
        guard !voice.isProfileLimitReached else {
            localError = "목소리는 최대 \(VoiceProfileLimits.maxProfiles)개까지 만들 수 있어요."
            return false
        }
        return true
    }

    /// 임시 cropping — AVAssetExportSession 기반.
    private func cropAudio(source: URL, startMs: Int, endMs: Int) async throws -> URL {
        try await AudioCropper.crop(source: source, startMs: startMs, endMs: endMs)
    }

    private func preparedCroppedAudio() async throws -> (url: URL, durationMs: Int) {
        guard let source = preparedSourceURL,
              let sourceDuration = preparedDurationMs else {
            localError = "녹음하거나 파일을 선택해 주세요."
            throw AudioCropper.CropperError.invalidRange
        }
        let endMs = min(cropEndMs, sourceDuration)
        let durationMs = max(0, endMs - cropStartMs)
        guard durationMs >= VoiceProfileLimits.minDurationMs else {
            localError = "1분 이상 들리는 구간을 선택해 주세요."
            throw AudioCropper.CropperError.invalidRange
        }
        guard durationMs <= VoiceProfileLimits.maxDurationMs else {
            localError = "2분 이하 구간만 사용할 수 있어요."
            throw AudioCropper.CropperError.invalidRange
        }
        guard AudioCropper.shouldExportAudioOnly(
            source: source,
            startMs: cropStartMs,
            endMs: endMs,
            sourceDurationMs: sourceDuration
        ) else {
            return (source, durationMs)
        }
        let audioOnly = try await cropAudio(source: source, startMs: cropStartMs, endMs: endMs)
        return (audioOnly, durationMs)
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
        let destination = directory.appendingPathComponent("import-\(UUID().uuidString).\(ext)")
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
        cleanupDrafts()
        selectedFileURL = nil
        selectedFileName = nil
        selectedFileDurationMs = nil
        if let durationMs = voice.recorder.latestDurationMs {
            applyCropDefaults(durationMs: durationMs)
        } else {
            cropStartMs = 0
            cropEndMs = VoiceProfileLimits.maxDurationMs
        }
        uploadId = nil
        uploadedAudioURL = nil
        uploadedDurationMs = nil
        speakers.removeAll()
        removedSpeakerIds.removeAll()
        localError = nil
    }

}

#if DEBUG
#Preview("SpeakerSeparationFlow (light)") {
    SpeakerSeparationFlow(route: .constant(.separate))
        .voiceAlarmPreviewEnvironment()
}

#Preview("SpeakerSeparationFlow (dark)") {
    SpeakerSeparationFlow(route: .constant(.separate))
        .preferredColorScheme(.dark)
        .voiceAlarmPreviewEnvironment()
}
#endif
