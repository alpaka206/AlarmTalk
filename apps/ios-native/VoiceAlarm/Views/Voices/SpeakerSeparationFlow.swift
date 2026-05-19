import SwiftUI

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

    @Binding var route: VoicesRoute

    @State private var uploadId: String?
    @State private var speakers: [VoiceSpeakerSegment] = []
    @State private var selectedSpeakerIds: Set<String> = []
    @State private var removedSpeakerIds: Set<String> = []
    @State private var profileName: String = "분리한 보이스"
    @State private var isShared: Bool = false
    @State private var separationBusy: Bool = false
    @State private var localError: String?

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
            stepLabel(num: 1, title: "여러 화자가 섞인 음원 준비")
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
            }
            if let durationMs = voice.recorder.latestDurationMs {
                Text("길이: \(durationMs / 1000)초")
                    .font(.caption)
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
            }
            Button {
                Task { await uploadCurrentRecording() }
            } label: {
                Label("업로드", systemImage: "icloud.and.arrow.up")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(VoiceAlarmTheme.primary)
            .disabled(voice.recorder.latestRecordingURL == nil || voice.isBusy)
        }
        .sectionSurface()
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
            if let url = voice.recorder.latestRecordingURL {
                VoiceSegmentPreviewPlayer(
                    title: "구간 미리듣기",
                    subtitle: nil,
                    audioURL: url,
                    startMs: speaker.startMs,
                    endMs: speaker.endMs
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
            TextField("보이스 이름", text: $profileName)
                .textFieldStyle(.roundedBorder)
            Toggle("가족·커플과 공유", isOn: $isShared)
                .font(.footnote)
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

    private func uploadCurrentRecording() async {
        guard let url = voice.recorder.latestRecordingURL,
              let durationMs = voice.recorder.latestDurationMs else {
            localError = "녹음을 먼저 진행해 주세요."
            return
        }
        localError = nil
        let id = await voice.uploadForSeparation(
            audioFileURL: url,
            durationMs: durationMs,
            originalName: url.lastPathComponent,
            session: auth.session
        )
        await MainActor.run { self.uploadId = id }
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
        guard let originalURL = voice.recorder.latestRecordingURL else {
            localError = "원본 녹음을 찾지 못했어요."
            return
        }
        localError = nil
        for (idx, speaker) in chosen.enumerated() {
            let resolvedName = chosen.count == 1
                ? profileName.trimmingCharacters(in: .whitespacesAndNewlines)
                : "\(profileName) \(idx + 1)"
            // 화자 구간만 잘라 새 임시 파일로.
            if let cropped = try? await cropAudio(
                source: originalURL,
                startMs: speaker.startMs,
                endMs: speaker.endMs
            ) {
                _ = await voice.selectSpeakerAndClone(
                    uploadId: uploadId,
                    speakerId: speaker.id,
                    name: resolvedName.isEmpty ? "분리한 보이스" : resolvedName,
                    isShared: isShared,
                    durationMs: speaker.durationMs,
                    audioFileURL: cropped,
                    session: auth.session
                )
            }
        }
        // 성공 후 정리.
        if voice.statusMessage?.contains("학습") == true {
            route = .management
        }
    }

    /// 임시 cropping — AVAssetExportSession 기반.
    private func cropAudio(source: URL, startMs: Int, endMs: Int) async throws -> URL {
        try await AudioCropper.crop(source: source, startMs: startMs, endMs: endMs)
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
