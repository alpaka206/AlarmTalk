import Combine
import Foundation

struct PreparedVoiceAlarm {
    var messageID: String
    var voiceProfileID: String
    var localAudioFileName: String
    var audioCacheKey: String
    var rawAudioURL: String?
    var text: String
    var language: String
}

/// VoiceAlarm 의 보이스 슬롯 / 길이 정책 상수.
///
/// Android 의 `VoiceProfileAudioLimits` 와 `MAX_VOICE_PROFILES` 를 그대로 옮긴다.
/// 본 상수는 ViewModel 과 View 가 동일한 기준으로 다이얼로그/에러 메시지를 만들기 위해
/// 존재한다.
enum VoiceProfileLimits {
    /// 사용자당 최대 보이스 프로필 수.
    static let maxProfiles = 5
    /// 클로닝에 허용되는 최소 음성 길이 (ms).
    static let minDurationMs = 60_000
    /// 클로닝에 허용되는 최대 음성 길이 (ms).
    static let maxDurationMs = 120_000
}

@MainActor
final class VoiceStudioViewModel: ObservableObject {
    @Published var profiles: [VoiceProfile] = []
    @Published var familyVoices: [FamilyVoiceProfile] = []
    @Published var messages: [TtsMessage] = []
    @Published var selectedProfileID: String?
    @Published var ttsText = "좋은 아침이에요! 일어나세요! 오늘 하루도 힘내봐요!"
    @Published var ttsCategory = "morning"
    @Published var ttsLanguage = "ko"
    @Published var translateText = false
    @Published var randomPrompt = false
    /// 랜덤 프롬프트 컨텍스트. Android `TtsApi.kt` randomContext 와 동일.
    /// 허용 값: preset / wake_weather / wake_fortune / meal / sleep / exercise / love.
    /// randomPrompt 가 true 일 때만 의미가 있다.
    @Published var randomContext: String = RandomPromptContext.defaultContext.rawValue
    @Published var weatherCountry = ""
    @Published var weatherCity = ""
    @Published var fortuneGender = ""
    @Published var fortuneBirthDate = ""
    @Published var fortuneBirthTime = ""
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

    var selectedFamilyVoice: FamilyVoiceProfile? {
        guard let selectedProfileID else { return nil }
        return familyVoices.first { $0.id == selectedProfileID }
    }

    private var selectedListenerTitle: String? {
        if let listener = selectedProfile?.listenerTitle, let trimmed = nonEmpty(listener) {
            return trimmed
        }
        if let listener = selectedFamilyVoice?.listenerTitle, let trimmed = nonEmpty(listener) {
            return trimmed
        }
        return nil
    }

    var canUploadRecording: Bool {
        recorder.latestRecordingURL != nil
            && (recorder.latestDurationMs ?? 0) >= VoiceProfileLimits.minDurationMs
            && (recorder.latestDurationMs ?? 0) <= VoiceProfileLimits.maxDurationMs
    }

    var hasWeatherInfo: Bool {
        nonEmpty(weatherCountry) != nil && nonEmpty(weatherCity) != nil
    }

    var hasFortuneInfo: Bool {
        nonEmpty(fortuneGender) != nil &&
            nonEmpty(fortuneBirthDate) != nil &&
            nonEmpty(fortuneBirthTime) != nil
    }

    /// 슬롯이 가득 찼는지 — VoiceProfileManagementPanel 의 슬롯 카드/추가 버튼 비활성에 사용.
    var isProfileLimitReached: Bool { profiles.count >= VoiceProfileLimits.maxProfiles }

    /// 남은 슬롯 — SpeakerSeparationFlow 가 동시에 여러 화자 선택을 허용할 때 cap.
    var remainingProfileSlots: Int {
        max(0, VoiceProfileLimits.maxProfiles - profiles.count)
    }

    func refresh(
        session: AuthSession?,
        force: Bool = false,
        successMessage: String? = "목소리 정보를 불러왔어요."
    ) async {
        guard let token = session?.token else { return }
        guard force || !isBusy else { return }
        let shouldManageBusy = !isBusy
        if shouldManageBusy {
            isBusy = true
        }
        defer {
            if shouldManageBusy {
                isBusy = false
            }
        }

        do {
            async let nextProfiles = api.listVoiceProfiles(token: token)
            async let nextMessages = api.listTTSMessages(token: token)
            // 가족 보이스는 plan 에 따라 403 이 날 수 있으므로 실패해도 무시.
            let familyResult: [FamilyVoiceProfile]
            do {
                familyResult = try await api.listFamilyVoiceProfiles(token: token)
            } catch {
                familyResult = []
            }
            profiles = try await nextProfiles
            messages = try await nextMessages
            familyVoices = familyResult
            if let selectedProfileID,
               !profiles.contains(where: { $0.id == selectedProfileID }),
               !familyVoices.contains(where: { $0.id == selectedProfileID }) {
                self.selectedProfileID = nil
            }
            if selectedProfileID == nil {
                selectedProfileID = profiles.first(where: { $0.status == "ready" })?.id ??
                    profiles.first?.id ??
                    familyVoices.first(where: { $0.status == "ready" })?.id ??
                    familyVoices.first?.id
            }
            if let successMessage {
                statusMessage = successMessage
            }
        } catch {
            statusMessage = mapVoiceError(error)
        }
    }

    func startRecording() async {
        do {
            try await recorder.start()
            statusMessage = "녹음 중이에요. 1분 이상 2분 이하로 녹음해 주세요."
        } catch {
            statusMessage = mapVoiceError(error)
        }
    }

    func stopRecording() {
        recorder.stop()
        statusMessage = "녹음을 저장했어요. \(recordingDurationLabel)"
    }

    func uploadRecordingForClone(
        session: AuthSession?,
        isShared: Bool = false,
        relationshipLabel: String? = nil,
        listenerTitle: String? = nil
    ) async {
        guard let token = session?.token else {
            statusMessage = "로그인이 필요해요."
            return
        }
        guard let url = recorder.latestRecordingURL, let durationMs = recorder.latestDurationMs else {
            statusMessage = "먼저 목소리를 녹음해 주세요."
            return
        }
        guard durationMs >= VoiceProfileLimits.minDurationMs && durationMs <= VoiceProfileLimits.maxDurationMs else {
            statusMessage = durationMs < VoiceProfileLimits.minDurationMs
                ? "1분 이상 녹음해 주세요."
                : "2분 이하 음성으로 등록할 수 있어요."
            return
        }
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }

        do {
            let profile = try await api.cloneVoice(
                audioFileURL: url,
                name: cloneName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "내 목소리" : cloneName,
                isShared: isShared,
                durationMs: durationMs,
                token: token,
                relationshipLabel: relationshipLabel,
                listenerTitle: listenerTitle
            )
            selectedProfileID = profile.id
            statusMessage = "목소리 학습을 등록했어요."
            await refresh(session: session, force: true, successMessage: nil)
        } catch {
            statusMessage = mapVoiceError(error)
        }
    }

    /// 배경음 자동 제거 옵션을 켠 채로 클로닝. `feat/voice-clone-noise-removal` 머지 후 활성.
    func cloneWithNoiseRemoval(
        audioFileURL: URL,
        name: String,
        durationMs: Int,
        isShared: Bool,
        session: AuthSession?,
        relationshipLabel: String? = nil,
        listenerTitle: String? = nil
    ) async -> VoiceProfile? {
        guard let token = session?.token else {
            statusMessage = "로그인이 필요해요."
            return nil
        }
        guard !isBusy else { return nil }
        isBusy = true
        defer { isBusy = false }
        do {
            let profile = try await api.cloneVoice(
                audioFileURL: audioFileURL,
                name: name,
                isShared: isShared,
                durationMs: durationMs,
                token: token,
                noiseRemoval: true,
                relationshipLabel: relationshipLabel,
                listenerTitle: listenerTitle
            )
            selectedProfileID = profile.id
            statusMessage = "배경음 제거 학습이 완료됐어요."
            await refresh(session: session, force: true, successMessage: nil)
            return profile
        } catch {
            statusMessage = mapVoiceError(error)
            return nil
        }
    }

    /// 녹음 외 파일 업로드/자르기 결과처럼 임의 URL을 곧바로 보이스 프로필로 등록한다.
    func cloneAudioForProfile(
        audioFileURL: URL,
        name: String,
        durationMs: Int,
        isShared: Bool,
        session: AuthSession?,
        noiseRemoval: Bool = false,
        relationshipLabel: String? = nil,
        listenerTitle: String? = nil
    ) async -> VoiceProfile? {
        guard let token = session?.token else {
            statusMessage = "로그인이 필요해요."
            return nil
        }
        guard durationMs >= VoiceProfileLimits.minDurationMs && durationMs <= VoiceProfileLimits.maxDurationMs else {
            statusMessage = durationMs < VoiceProfileLimits.minDurationMs
                ? "1분 이상 준비해 주세요."
                : "2분 이하 음성으로 등록할 수 있어요."
            return nil
        }
        guard !isBusy else { return nil }
        isBusy = true
        defer { isBusy = false }
        do {
            let profile = try await api.cloneVoice(
                audioFileURL: audioFileURL,
                name: name,
                isShared: isShared,
                durationMs: durationMs,
                token: token,
                noiseRemoval: noiseRemoval,
                relationshipLabel: relationshipLabel,
                listenerTitle: listenerTitle
            )
            selectedProfileID = profile.id
            statusMessage = noiseRemoval ? "배경음 제거 학습이 완료됐어요." : "목소리 학습을 등록했어요."
            await refresh(session: session, force: true, successMessage: nil)
            return profile
        } catch {
            statusMessage = mapVoiceError(error)
            return nil
        }
    }

    /// 공유받은 음성에 viewer 의 관계·호칭을 등록한다.
    /// `VoiceProfileManagementPanel` 의 SharedVoiceViewerInfoDialog 가 호출.
    func updateSharedVoiceViewerInfo(
        profileId: String,
        relationshipLabel: String,
        listenerTitle: String,
        session: AuthSession?
    ) async {
        guard let token = session?.token else {
            statusMessage = "로그인이 필요해요."
            return
        }
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }
        do {
            _ = try await api.updateVoiceProfileRelationship(
                profileId: profileId,
                relationshipLabel: relationshipLabel,
                listenerTitle: listenerTitle,
                token: token
            )
            statusMessage = "공유 음성 정보를 저장했어요."
            await refresh(session: session, force: true, successMessage: nil)
        } catch {
            statusMessage = mapVoiceError(error)
        }
    }

    /// 공유받은 목소리를 설정할 때 Android 와 같은 문장으로 짧게 미리듣는다.
    func previewSharedVoice(profileId: String, session: AuthSession?) async {
        guard let token = session?.token else {
            statusMessage = "로그인이 필요해요."
            return
        }
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }

        do {
            let response = try await api.generateTTS(
                TtsGenerateRequest(
                    voiceProfileId: profileId,
                    text: "이 목소리로 깨워드릴까요?",
                    category: "custom",
                    language: "ko",
                    translate: false,
                    random: false
                ),
                token: token
            )
            let cached = try AudioCacheStore.cache(tts: response)
            try previewPlayer.play(url: AudioCacheStore.url(for: cached.fileName))
            statusMessage = "미리듣기를 재생하고 있어요."
        } catch {
            statusMessage = mapVoiceError(error)
        }
    }

    /// SpeakerSeparationFlow 의 1단계 — raw 음원을 업로드해 uploadId 를 얻는다.
    func uploadForSeparation(
        audioFileURL: URL,
        durationMs: Int,
        originalName: String? = nil,
        session: AuthSession?
    ) async -> String? {
        guard let token = session?.token else {
            statusMessage = "로그인이 필요해요."
            return nil
        }
        guard !isBusy else { return nil }
        isBusy = true
        defer { isBusy = false }
        do {
            let upload = try await api.uploadVoiceAudio(
                audioFileURL: audioFileURL,
                durationMs: durationMs,
                originalName: originalName,
                token: token
            )
            return upload.id
        } catch {
            statusMessage = mapVoiceError(error)
            return nil
        }
    }

    /// SpeakerSeparationFlow 의 2단계 — 업로드된 음원을 분리하고 segments 반환.
    func runSeparation(uploadId: String, session: AuthSession?) async -> [VoiceSpeakerSegment] {
        guard let token = session?.token else {
            statusMessage = "로그인이 필요해요."
            return []
        }
        guard !isBusy else { return [] }
        isBusy = true
        defer { isBusy = false }
        do {
            let speakers = try await api.separateVoiceUpload(uploadId: uploadId, token: token)
            statusMessage = speakers.isEmpty
                ? "분리할 화자를 찾지 못했어요."
                : "\(speakers.count)명의 목소리를 찾았어요."
            return speakers
        } catch {
            statusMessage = mapVoiceError(error)
            return []
        }
    }

    /// 이미 분리된 결과를 다시 불러올 때 — 화면을 재진입한 경우 사용.
    func fetchExistingSpeakers(uploadId: String, session: AuthSession?) async -> [VoiceSpeakerSegment] {
        guard let token = session?.token else { return [] }
        do {
            let response = try await api.getVoiceUploadSpeakers(uploadId: uploadId, token: token)
            return response.speakers
        } catch {
            return []
        }
    }

    /// SpeakerSeparationFlow 의 3단계 — 사용자가 선택한 화자만 골라 새 보이스로 등록.
    func selectSpeakerAndClone(
        uploadId: String,
        speakerId: String,
        name: String,
        isShared: Bool,
        durationMs: Int,
        audioFileURL: URL,
        relationshipLabel: String? = nil,
        listenerTitle: String? = nil,
        session: AuthSession?
    ) async -> VoiceProfile? {
        // 현재 백엔드는 화자 선택 후 별도 endpoint 가 아니라 cropped audio 를 다시
        // /voice/clone 에 업로드해 처리한다. View 가 audio 를 cropping 한 뒤 결과 URL 을
        // 넘기면 이 메서드가 clone 한다.
        guard let token = session?.token else {
            statusMessage = "로그인이 필요해요."
            return nil
        }
        guard !isBusy else { return nil }
        isBusy = true
        defer { isBusy = false }
        do {
            // 화자 라벨 업데이트(존재할 때만) — best-effort.
            _ = try? await api.updateVoiceUploadSpeaker(
                uploadId: uploadId,
                speakerId: speakerId,
                label: name,
                token: token
            )
            let profile = try await api.cloneVoice(
                audioFileURL: audioFileURL,
                name: name,
                isShared: isShared,
                durationMs: durationMs,
                token: token,
                relationshipLabel: relationshipLabel,
                listenerTitle: listenerTitle
            )
            selectedProfileID = profile.id
            statusMessage = "선택한 목소리를 학습했어요."
            await refresh(session: session, force: true, successMessage: nil)
            return profile
        } catch {
            statusMessage = mapVoiceError(error)
            return nil
        }
    }

    func generateTTS(
        session: AuthSession?,
        alarmHour: Int? = nil,
        alarmMinute: Int? = nil,
        targetUserId: String? = nil,
        targetDynamicPromptState: DynamicPromptSettingsState? = nil
    ) async -> PreparedVoiceAlarm? {
        guard let token = session?.token else {
            statusMessage = "로그인이 필요해요."
            return nil
        }
        guard let profileID = selectedProfileID else {
            statusMessage = "사용할 목소리를 먼저 선택해 주세요."
            return nil
        }
        if selectedFamilyVoice?.requiresViewerInfo == true {
            statusMessage = "공유받은 목소리의 관계와 호칭을 먼저 설정해 주세요."
            return nil
        }
        guard randomPrompt || !ttsText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            statusMessage = "깨워줄 말을 입력하거나 랜덤 생성을 켜 주세요."
            return nil
        }
        let promptContext = RandomPromptContext.normalized(randomContext)
        let targetWeatherReady = targetDynamicPromptState?.weatherReady == true
        let targetFortuneReady = targetDynamicPromptState?.fortuneReady == true
        if randomPrompt && promptContext.usesWeather && !hasWeatherInfo && !targetWeatherReady {
            statusMessage = "날씨를 쓸 지역을 입력해 주세요."
            return nil
        }
        if randomPrompt && promptContext.usesFortune && !hasFortuneInfo && !targetFortuneReady {
            statusMessage = "운세에 쓸 정보를 모두 입력해 주세요."
            return nil
        }
        guard !isBusy else { return nil }
        isBusy = true
        defer { isBusy = false }

        do {
            let shouldTranslate = !randomPrompt && translateText
            let activeLanguage = randomPrompt || shouldTranslate ? ttsLanguage : "ko"
            let response = try await api.generateTTS(
                TtsGenerateRequest(
                    voiceProfileId: profileID,
                    text: randomPrompt ? "" : ttsText,
                    category: randomPrompt ? promptContext.ttsCategory : "custom",
                    language: activeLanguage,
                    translate: shouldTranslate,
                    random: randomPrompt,
                    randomContext: randomPrompt ? promptContext.rawValue : nil,
                    alarmHour: randomPrompt ? alarmHour : nil,
                    alarmMinute: randomPrompt ? alarmMinute : nil,
                    weatherCountry: targetUserId == nil && randomPrompt && promptContext.usesWeather ? nonEmpty(weatherCountry) : nil,
                    weatherCity: targetUserId == nil && randomPrompt && promptContext.usesWeather ? nonEmpty(weatherCity) : nil,
                    fortuneGender: targetUserId == nil && randomPrompt && promptContext.usesFortune ? nonEmpty(fortuneGender) : nil,
                    fortuneBirthDate: targetUserId == nil && randomPrompt && promptContext.usesFortune ? nonEmpty(fortuneBirthDate) : nil,
                    fortuneBirthTime: targetUserId == nil && randomPrompt && promptContext.usesFortune ? nonEmpty(fortuneBirthTime) : nil,
                    listenerTitle: selectedListenerTitle,
                    targetUserId: targetUserId
                ),
                token: token
            )
            let cached = try AudioCacheStore.cache(tts: response)
            let prepared = PreparedVoiceAlarm(
                messageID: response.messageId,
                voiceProfileID: response.voiceProfileId,
                localAudioFileName: cached.fileName,
                audioCacheKey: cached.cacheKey,
                rawAudioURL: response.remoteAudioURI,
                text: response.text,
                language: activeLanguage
            )
            preparedAlarm = prepared
            statusMessage = response.cacheHit == true ? "캐시된 음성을 준비했어요." : "새 음성을 생성하고 로컬에 저장했어요."
            await refresh(session: session, force: true, successMessage: nil)
            return prepared
        } catch {
            statusMessage = mapVoiceError(error)
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
            statusMessage = mapVoiceError(error)
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
            statusMessage = mapVoiceError(error)
        }
    }

    /// 보이스 프로필 삭제. force=true 가 기본 — Android 와 마찬가지로 사용 중인 알람이 있어도
    /// cascade 로 sound-only 강등 후 삭제한다.
    ///
    /// `alarmStore` 가 주입되면 이 프로필을 쓰는 로컬 알람을 즉시 sound-only 로 강등하고
    /// 더 이상 참조되지 않는 오디오 캐시를 정리한다. 백엔드 cascade 응답을 기다리지 않으므로
    /// 오프라인/sync 지연 상황에서도 사용자 인지와 실제 알람 동작이 일치한다.
    func deleteProfile(
        _ profile: VoiceProfile,
        session: AuthSession?,
        force: Bool = true,
        alarmStore: LocalAlarmStore? = nil,
        audioCache: AudioCacheStore? = nil
    ) async {
        guard let token = session?.token else { return }
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }

        do {
            try await api.deleteVoiceProfile(id: profile.id, token: token, force: force)
            if selectedProfileID == profile.id {
                selectedProfileID = nil
            }
            if let alarmStore {
                cascadeAlarmsAfterVoiceDeletion(
                    profileID: profile.id,
                    alarmStore: alarmStore,
                    audioCache: audioCache
                )
            }
            statusMessage = "목소리를 삭제했어요."
            await refresh(session: session, force: true, successMessage: nil)
        } catch {
            statusMessage = mapVoiceError(error)
        }
    }

    /// 로컬 알람의 voice 메타를 비우고 sound-only 로 강등 + 더 이상 참조되지 않는 캐시 정리.
    private func cascadeAlarmsAfterVoiceDeletion(
        profileID: String,
        alarmStore: LocalAlarmStore,
        audioCache: AudioCacheStore?
    ) {
        let affected = alarmStore.alarms.filter { $0.voiceProfileId == profileID }
        guard !affected.isEmpty else { return }

        var releasedKeys: Set<String> = []
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        for record in affected {
            if let key = record.audioCacheKey { releasedKeys.insert(key) }
            var updated = record
            updated.playMode = AlarmPlayMode.alarmOnly.rawValue
            updated.voiceProfileId = nil
            updated.voiceText = nil
            updated.voiceCategory = nil
            updated.voiceLanguage = nil
            updated.voiceSource = VoiceSource.localAudio.rawValue
            updated.localAudioUri = nil
            updated.audioCacheKey = nil
            updated.ttsMessageId = nil
            updated.syncState = AlarmSyncState.dirty.rawValue
            updated.updatedAtMillis = now
            _ = alarmStore.upsert(updated)
        }

        if let audioCache, !releasedKeys.isEmpty {
            let stillReferenced = Set(alarmStore.alarms.compactMap { $0.audioCacheKey })
            let toRemove = releasedKeys.subtracting(stillReferenced)
            for key in toRemove {
                try? audioCache.deleteCachedAudio(cacheKey: key)
            }
        }
    }

    private func nonEmpty(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    /// 프로필 정보 변경 — VoiceProfileManagementPanel 의 편집 다이얼로그가 호출.
    func updateProfileInfo(
        _ profile: VoiceProfile,
        newName: String,
        relationshipLabel: String,
        listenerTitle: String,
        session: AuthSession?
    ) async {
        guard let token = session?.token else { return }
        let trimmed = newName.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedRelationship = relationshipLabel.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedListener = listenerTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            statusMessage = "이름을 비울 수 없어요."
            return
        }
        guard !trimmedRelationship.isEmpty else {
            statusMessage = "나와의 관계를 입력해 주세요."
            return
        }
        guard !trimmedListener.isEmpty else {
            statusMessage = "이 목소리가 나를 부를 이름을 입력해 주세요."
            return
        }
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }
        do {
            _ = try await api.updateVoiceProfile(
                id: profile.id,
                name: trimmed,
                isShared: nil,
                relationshipLabel: trimmedRelationship,
                listenerTitle: trimmedListener,
                token: token
            )
            statusMessage = "정보를 수정했어요."
            await refresh(session: session, force: true, successMessage: nil)
        } catch {
            statusMessage = mapVoiceError(error)
        }
    }

    /// 공유 토글 — VoiceProfileManagementPanel 의 공유 스위치가 호출.
    func toggleShare(_ profile: VoiceProfile, isShared: Bool, session: AuthSession?) async {
        guard let token = session?.token else { return }
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }
        do {
            _ = try await api.updateVoiceProfile(id: profile.id, name: nil, isShared: isShared, token: token)
            statusMessage = isShared ? "공유를 켰어요." : "공유를 껐어요."
            await refresh(session: session, force: true, successMessage: nil)
        } catch {
            statusMessage = mapVoiceError(error)
        }
    }

    var recordingDurationLabel: String {
        let seconds = Int((recorder.latestDurationMs ?? Int(recorder.elapsedSeconds * 1000)) / 1000)
        return "\(seconds)초"
    }
}

// MARK: - errorCode 매핑
//
// Android `MainViewModelVoiceActions.kt:136-144` 의 mapping 을 그대로 옮긴다. 본 매퍼는
// `APIError.server` 응답 body 안의 error_code 를 한국어 메시지로 변환한다. 해당 코드가
// 없는 경우 generic fallback 메시지를 반환한다.
extension VoiceStudioViewModel {
    /// 외부에서도 테스트하기 위해 nonisolated.
    nonisolated func mapVoiceError(_ error: Error) -> String {
        // 1) ServerError.errorCode 가 디코드되어 APIError.server 에 실린 경우.
        if let code = extractServerErrorCode(from: error) {
            return Self.localizedVoiceMessage(forCode: code)
        }
        // 2) URLError / VoiceRecorderError / 일반 메시지.
        if let recorderError = error as? VoiceRecorderError {
            return recorderError.errorDescription ?? "녹음 중 오류가 발생했어요."
        }
        if let urlError = error as? URLError {
            switch urlError.code {
            case .notConnectedToInternet, .networkConnectionLost, .timedOut:
                return "네트워크가 불안정해요. 잠시 후 다시 시도해 주세요."
            default:
                return "연결에 실패했어요. 다시 시도해 주세요."
            }
        }
        if let apiError = error as? APIError {
            switch apiError {
            case .invalidResponse:
                return "서버 응답을 해석하지 못했어요."
            case .server(let status, let message, _):
                if status == 401 || status == 403 { return "권한이 없어요. 로그인 상태를 확인해 주세요." }
                if status >= 500 { return "서버가 응답하지 않아요. 잠시 후 다시 시도해 주세요." }
                return message.isEmpty ? "처리 중 오류가 발생했어요." : message
            }
        }
        return "처리 중 오류가 발생했어요."
    }

    /// 코드 -> 한국어 메시지. 테스트가 직접 호출할 수 있게 static.
    nonisolated static func localizedVoiceMessage(forCode code: String) -> String {
        switch code {
        case "VOICE_SLOT_EXHAUSTED":
            return "보이스 슬롯이 가득 찼어요. 기존 보이스를 삭제하거나 플랜을 업그레이드해 주세요."
        case "VOICE_FEATURE_REQUIRES_PAID_PLAN":
            return "유료 플랜에서 사용할 수 있어요."
        case "VOICE_CLONE_AUDIO_TOO_SHORT":
            return "60초 이상의 음성을 녹음해 주세요."
        case "VOICE_CLONE_AUDIO_TOO_LONG":
            return "120초 이내로 녹음해 주세요."
        case "VOICE_LIMIT_REACHED":
            return "이번 달 보이스 생성 한도를 모두 사용했어요."
        case "AUDIO_DURATION_TOO_SHORT":
            return "음성이 너무 짧아요. 다시 녹음해 주세요."
        case "VOICE_PROFILE_NOT_FOUND":
            return "보이스를 찾지 못했어요. 새로고침 후 다시 시도해 주세요."
        case "INVALID_VOICE_PROFILE_ID":
            return "잘못된 보이스 식별자예요."
        case "NAME_TOO_LONG":
            return "이름은 50자 이내로 입력해 주세요."
        case "AUDIO_AND_NAME_REQUIRED":
            return "음성과 이름을 모두 입력해 주세요."
        default:
            return code
        }
    }

    private nonisolated func extractServerErrorCode(from error: Error) -> String? {
        // 1) 정상 경로 — APIError 가 errorCode 를 보존하고 있다.
        if let apiError = error as? APIError, let code = apiError.serverErrorCode {
            return code
        }
        // 2) 폴백 — message 안에 JSON 또는 raw code 가 박혀 있는 경우.
        guard let apiError = error as? APIError, case .server(_, let message, _) = apiError else {
            return nil
        }
        if let data = message.data(using: .utf8) {
            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            if let decoded = try? decoder.decode(ServerError.self, from: data),
               let code = decoded.errorCode {
                return code
            }
        }
        for code in Self.knownErrorCodes where message.contains(code) {
            return code
        }
        return nil
    }

    nonisolated static let knownErrorCodes: [String] = [
        "VOICE_SLOT_EXHAUSTED",
        "VOICE_FEATURE_REQUIRES_PAID_PLAN",
        "VOICE_CLONE_AUDIO_TOO_SHORT",
        "VOICE_CLONE_AUDIO_TOO_LONG",
        "VOICE_LIMIT_REACHED",
        "AUDIO_DURATION_TOO_SHORT",
        "VOICE_PROFILE_NOT_FOUND",
        "INVALID_VOICE_PROFILE_ID",
        "NAME_TOO_LONG",
        "AUDIO_AND_NAME_REQUIRED",
    ]
}
