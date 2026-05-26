import AVFoundation
import SwiftUI
import UniformTypeIdentifiers

/// 화자 분리 워크플로우.
///
/// 1. 녹음 또는 기존 녹음 사용 -> raw upload (`uploadForSeparation`)
/// 2. `runSeparation(uploadId:)` 호출 -> [VoiceSpeakerSegment]
/// 3. 각 화자별 미리듣기 (`VoiceSegmentPreviewPlayer`) -> 본 화자 선택
/// 4. 선택한 화자만 cropping 해 `selectSpeakerAndClone` 로 등록
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
    @State private var speakers: [VoiceSpeakerSegment] = []
    @State private var selectedSpeakerIds: Set<String> = []
    @State private var removedSpeakerIds: Set<String> = []
    @State private var profileName: String = "분리한 목소리"
    @State private var relationshipSelection = VoiceRelationshipSelection()
    @State private var listenerTitle: String = ""
    @State private var isShared: Bool = false
    @State private var separationBusy: Bool = false
    @State private var fileImporterPresented: Bool = false
    @State private var selectedFileURL: URL?
    @State private var selectedFileName: String?
    @State private var selectedFileDurationMs: Int?
    @State private var cropStartMs: Int = 0
    @State private var cropEndMs: Int = VoiceProfileLimits.maxDurationMs
    @State private var registerSubmitted: Bool = false
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
                stepRegister
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
            applyCropDefaults(durationMs: durationMs)
            uploadId = nil
            uploadedAudioURL = nil
            speakers.removeAll()
            selectedSpeakerIds.removeAll()
            removedSpeakerIds.removeAll()
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
            .disabled(!preparedSourceReady || voice.isBusy)
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
                    Text("전체 \(timeLabel(durationMs)) · 사용할 구간 \(timeLabel(effectiveDurationMs))")
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
                    Text("자를 구간 \(timeLabel(cropStartMs)) - \(timeLabel(cropEndMs))")
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
                subtitle: "\(timeLabel(cropStartMs)) - \(timeLabel(effectiveEndMs))",
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
                .disabled(separationBusy || voice.isBusy)

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
            Text("재생해 보고 가장 잘 들리는 화자를 골라 주세요. 최대 \(voice.remainingProfileSlots)명까지 동시에 등록할 수 있어요.")
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
        let selected = selectedSpeakerIds.contains(speaker.id)
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
            if let url = uploadedAudioURL ?? preparedSourceURL {
                VoiceSegmentPreviewPlayer(
                    title: "구간 미리듣기",
                    subtitle: nil,
                    audioURL: url,
                    startMs: speaker.startMs,
                    endMs: speaker.endMs,
                    onError: { localError = $0 }
                )
            }
            HStack(spacing: 8) {
                Button {
                    toggleSpeaker(speaker.id)
                } label: {
                    Text(selected ? "선택됨" : "선택")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(selected ? .borderedProminent : .bordered)
                .tint(selected ? VoiceAlarmTheme.primary : VoiceAlarmTheme.textSecondary)
                .disabled(!selected && selectedSpeakerIds.count >= voice.remainingProfileSlots)

                Button(role: .destructive) {
                    removedSpeakerIds.insert(speaker.id)
                    selectedSpeakerIds.remove(speaker.id)
                } label: {
                    Image(systemName: "xmark.bin")
                }
                .buttonStyle(.bordered)
            }
        }
        .padding(12)
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(selected ? VoiceAlarmTheme.primary : VoiceAlarmTheme.outline, lineWidth: selected ? 1.5 : 1)
        )
        .background(VoiceAlarmTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    // MARK: - Step 4: register

    private var stepRegister: some View {
        VStack(alignment: .leading, spacing: 10) {
            stepLabel(num: 4, title: "이름 정하고 등록")
            TextField("목소리 이름", text: $profileName)
                .textFieldStyle(.roundedBorder)
                .onChange(of: profileName) { _, newValue in
                    if newValue.count > 50 {
                        profileName = String(newValue.prefix(50))
                    }
                }
            if registerSubmitted && profileName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Text("목소리 이름을 입력해 주세요.")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(VoiceAlarmTheme.error)
            }

            VoiceRelationshipInputField(
                selection: $relationshipSelection,
                submitted: registerSubmitted
            )

            VStack(alignment: .leading, spacing: 6) {
                Text("이 목소리가 나를 부를 이름")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
                TextField("예: 지호야, 여보, 우리 손주", text: $listenerTitle)
                    .textFieldStyle(.roundedBorder)
                    .onChange(of: listenerTitle) { _, newValue in
                        if newValue.count > 30 {
                            listenerTitle = String(newValue.prefix(30))
                        }
                    }
                if registerSubmitted && listenerTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Text("꼭 입력해 주세요.")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(VoiceAlarmTheme.error)
                }
            }
            VoiceListenerPreviewCard(
                listenerTitle: listenerTitle,
                relationshipLabel: relationshipSelection.resolved
            )

            Toggle(isOn: $isShared) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("목소리 공유")
                        .font(.footnote.weight(.semibold))
                    Text(shareDescription)
                        .font(.caption2)
                        .foregroundStyle(VoiceAlarmTheme.textSecondary)
                }
            }
            .disabled(!canShareVoice)
            Button {
                Task { await registerSelected() }
            } label: {
                Label("선택한 화자 학습", systemImage: "checkmark.seal")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(VoiceAlarmTheme.primary)
            .disabled(selectedSpeakerIds.isEmpty || voice.isBusy)
            if selectedSpeakerIds.count > voice.remainingProfileSlots {
                Text("남은 슬롯(\(voice.remainingProfileSlots))보다 많이 골랐어요.")
                    .font(.caption)
                    .foregroundStyle(VoiceAlarmTheme.error)
            }
        }
        .sectionSurface()
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

    // MARK: - Actions

    private func importAudioFile(_ source: URL) async {
        do {
            let importedURL = try copyImportedAudio(source)
            let durationMs = try await readAudioDurationMs(importedURL)
            await MainActor.run {
                selectedFileURL = importedURL
                selectedFileName = source.lastPathComponent
                selectedFileDurationMs = durationMs
                applyCropDefaults(durationMs: durationMs)
                uploadId = nil
                uploadedAudioURL = nil
                speakers.removeAll()
                selectedSpeakerIds.removeAll()
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
        await MainActor.run {
            self.uploadId = id
            self.uploadedAudioURL = prepared.url
            self.speakers.removeAll()
            self.selectedSpeakerIds.removeAll()
            self.removedSpeakerIds.removeAll()
        }
    }

    private func runSeparate() async {
        guard let uploadId else { return }
        separationBusy = true
        defer { separationBusy = false }
        let result = await voice.runSeparation(uploadId: uploadId, session: auth.session)
        await MainActor.run {
            self.speakers = result.filter { $0.endMs > $0.startMs }.prefix(3).map { $0 }
            self.selectedSpeakerIds.removeAll()
            self.removedSpeakerIds.removeAll()
        }
    }

    private func resetSpeakers() {
        speakers.removeAll()
        selectedSpeakerIds.removeAll()
        removedSpeakerIds.removeAll()
    }

    private func toggleSpeaker(_ id: String) {
        if selectedSpeakerIds.contains(id) {
            selectedSpeakerIds.remove(id)
        } else if selectedSpeakerIds.count < voice.remainingProfileSlots {
            selectedSpeakerIds.insert(id)
        }
    }

    private func registerSelected() async {
        registerSubmitted = true
        guard let uploadId else {
            localError = "업로드 정보를 잃어버렸어요. 처음부터 다시 시도해 주세요."
            return
        }
        let chosen = speakers.filter { selectedSpeakerIds.contains($0.id) }
        guard !chosen.isEmpty else {
            localError = "등록할 화자를 선택해 주세요."
            return
        }
        // 각 화자별 구간 길이가 minDuration 이상인지 확인.
        let tooShort = chosen.first(where: { $0.durationMs < VoiceProfileLimits.minDurationMs })
        if let tooShort {
            localError = "화자 '\(tooShort.label)' 의 구간이 1분보다 짧아요."
            return
        }
        let trimmedName = profileName.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedRelationship = relationshipSelection.resolved
        let trimmedListener = listenerTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty else {
            localError = nil
            return
        }
        guard !trimmedRelationship.isEmpty else {
            localError = nil
            return
        }
        guard !trimmedListener.isEmpty else {
            localError = nil
            return
        }
        guard let originalURL = uploadedAudioURL ?? preparedSourceURL else {
            localError = "원본 음원을 찾지 못했어요."
            return
        }
        localError = nil
        for (idx, speaker) in chosen.enumerated() {
            let resolvedName = chosen.count == 1
                ? trimmedName
                : "\(trimmedName) \(idx + 1)"
            // 화자 구간만 잘라 새 임시 파일로.
            if let cropped = try? await cropAudio(
                source: originalURL,
                startMs: speaker.startMs,
                endMs: speaker.endMs
            ) {
                _ = await voice.selectSpeakerAndClone(
                    uploadId: uploadId,
                    speakerId: speaker.id,
                    name: resolvedName.isEmpty ? "분리한 목소리" : resolvedName,
                    isShared: shouldShareVoice,
                    durationMs: speaker.durationMs,
                    audioFileURL: cropped,
                    uploadFileName: preparedUploadFileName,
                    relationshipLabel: trimmedRelationship,
                    listenerTitle: trimmedListener,
                    session: auth.session
                )
            }
        }
        // 성공 후 정리.
        if voice.statusMessage?.contains("학습") == true {
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

    private var shouldShareVoice: Bool {
        isShared && canShareVoice
    }

    private var shareDescription: String {
        if !canShareVoice {
            return "공유는 커플/가족 이용권에서 사용할 수 있어요."
        }
        return isShared ? "이용권을 같이 사용하는 사람들에게 목소리를 공유해요." : "내 계정에서만 사용해요."
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
        speakers.removeAll()
        selectedSpeakerIds.removeAll()
        removedSpeakerIds.removeAll()
        localError = nil
    }

    private func timeLabel(_ millis: Int) -> String {
        let seconds = max(0, millis / 1000)
        return String(format: "%d:%02d", seconds / 60, seconds % 60)
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
