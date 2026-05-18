import Combine
import Foundation

struct PreparedVoiceAlarm {
    var messageID: String
    var voiceProfileID: String
    var localAudioFileName: String
    var rawAudioURL: String?
    var text: String
    var language: String
}

@MainActor
final class VoiceStudioViewModel: ObservableObject {
    @Published var profiles: [VoiceProfile] = []
    @Published var messages: [TtsMessage] = []
    @Published var selectedProfileID: String?
    @Published var ttsText = "좋은 아침이에요! 일어나세요! 오늘 하루도 힘내봐요!"
    @Published var ttsCategory = "morning"
    @Published var ttsLanguage = "ko"
    @Published var translateText = false
    @Published var randomPrompt = false
    @Published var cloneName = "내 목소리"
    @Published var isBusy = false
    @Published var statusMessage: String?
    @Published var preparedAlarm: PreparedVoiceAlarm?

    let recorder = VoiceRecorder()
    let previewPlayer = AudioPreviewPlayer()

    private let api: VoiceAlarmAPI
    private var cancellables = Set<AnyCancellable>()

    init(api: VoiceAlarmAPI = .shared) {
        self.api = api
        recorder.objectWillChange
            .sink { [weak self] _ in
                Task { @MainActor in self?.objectWillChange.send() }
            }
            .store(in: &cancellables)
        previewPlayer.objectWillChange
            .sink { [weak self] _ in
                Task { @MainActor in self?.objectWillChange.send() }
            }
            .store(in: &cancellables)
    }

    var selectedProfile: VoiceProfile? {
        guard let selectedProfileID else { return nil }
        return profiles.first { $0.id == selectedProfileID }
    }

    var canUploadRecording: Bool {
        recorder.latestRecordingURL != nil && (recorder.latestDurationMs ?? 0) >= 60_000
    }

    func refresh(session: AuthSession?) async {
        guard let token = session?.token else { return }
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }

        do {
            async let nextProfiles = api.listVoiceProfiles(token: token)
            async let nextMessages = api.listTTSMessages(token: token)
            profiles = try await nextProfiles
            messages = try await nextMessages
            if selectedProfileID == nil {
                selectedProfileID = profiles.first(where: { $0.status == "ready" })?.id ?? profiles.first?.id
            }
            statusMessage = "목소리 정보를 불러왔어요."
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    func startRecording() async {
        do {
            try await recorder.start()
            statusMessage = "녹음 중이에요. 음성 학습은 60초 이상 필요해요."
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    func stopRecording() {
        recorder.stop()
        statusMessage = "녹음을 저장했어요. \(recordingDurationLabel)"
    }

    func uploadRecordingForClone(session: AuthSession?) async {
        guard let token = session?.token else {
            statusMessage = "로그인이 필요해요."
            return
        }
        guard let url = recorder.latestRecordingURL, let durationMs = recorder.latestDurationMs else {
            statusMessage = "먼저 목소리를 녹음해 주세요."
            return
        }
        guard durationMs >= 60_000 && durationMs <= 120_000 else {
            statusMessage = "음성 학습 파일은 60초 이상 120초 이하로 준비해 주세요."
            return
        }
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }

        do {
            let profile = try await api.cloneVoice(
                audioFileURL: url,
                name: cloneName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "내 목소리" : cloneName,
                isShared: false,
                durationMs: durationMs,
                token: token
            )
            selectedProfileID = profile.id
            statusMessage = "목소리 학습을 등록했어요."
            await refresh(session: session)
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    func generateTTS(session: AuthSession?) async -> PreparedVoiceAlarm? {
        guard let token = session?.token else {
            statusMessage = "로그인이 필요해요."
            return nil
        }
        guard let profileID = selectedProfileID else {
            statusMessage = "사용할 목소리를 먼저 선택해 주세요."
            return nil
        }
        guard randomPrompt || !ttsText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            statusMessage = "깨워줄 말을 입력하거나 랜덤 생성을 켜 주세요."
            return nil
        }
        guard !isBusy else { return nil }
        isBusy = true
        defer { isBusy = false }

        do {
            let response = try await api.generateTTS(
                TtsGenerateRequest(
                    voiceProfileId: profileID,
                    text: ttsText,
                    category: ttsCategory,
                    language: ttsLanguage,
                    translate: translateText,
                    random: randomPrompt
                ),
                token: token
            )
            let cached = try AudioCacheStore.cache(tts: response)
            let prepared = PreparedVoiceAlarm(
                messageID: response.messageId,
                voiceProfileID: response.voiceProfileId,
                localAudioFileName: cached.fileName,
                rawAudioURL: response.audioUrl,
                text: response.text,
                language: ttsLanguage
            )
            preparedAlarm = prepared
            statusMessage = response.cacheHit == true ? "캐시된 음성을 준비했어요." : "새 음성을 생성하고 로컬에 저장했어요."
            await refresh(session: session)
            return prepared
        } catch {
            statusMessage = error.localizedDescription
            return nil
        }
    }

    func playPreparedAudio() {
        guard let preparedAlarm else {
            statusMessage = "먼저 음성을 생성해 주세요."
            return
        }
        do {
            try previewPlayer.play(url: AudioCacheStore.url(for: preparedAlarm.localAudioFileName))
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    func playRecording() {
        guard let url = recorder.latestRecordingURL else {
            statusMessage = "재생할 녹음이 없어요."
            return
        }
        do {
            try previewPlayer.play(url: url)
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    func deleteProfile(_ profile: VoiceProfile, session: AuthSession?) async {
        guard let token = session?.token else { return }
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }

        do {
            try await api.deleteVoiceProfile(id: profile.id, token: token)
            if selectedProfileID == profile.id {
                selectedProfileID = nil
            }
            statusMessage = "목소리를 삭제했어요."
            await refresh(session: session)
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    var recordingDurationLabel: String {
        let seconds = Int((recorder.latestDurationMs ?? Int(recorder.elapsedSeconds * 1000)) / 1000)
        return "\(seconds)초"
    }
}
