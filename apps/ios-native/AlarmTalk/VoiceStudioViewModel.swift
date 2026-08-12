import Combine
import Foundation
import UIKit

struct PreparedAlarmTalk {
    var messageID: String
    var voiceProfileID: String
    var localAudioFileName: String
    var audioCacheKey: String
    var rawAudioURL: String?
    var text: String
    var language: String
    var listenerTitle: String?
}

/// AlarmTalk 의 목소리 슬롯 / 길이 정책 상수.
///
/// Android 의 `VoiceProfileAudioLimits` 와 `MAX_VOICE_PROFILES` 를 그대로 옮긴다.
/// 본 상수는 ViewModel 과 View 가 동일한 기준으로 다이얼로그/에러 메시지를 만들기 위해
/// 존재한다.
enum VoiceProfileLimits {
    /// 사용자당 최대 목소리 프로필 수. Android `MAX_VOICE_PROFILES`(=1) 및
    /// 백엔드 voice-profile.ts `MAX_VOICE_PROFILES`(=1) 와 동일해야 한다.
    /// (5 였을 때 UI 는 5칸을 보여줬으나 서버가 2번째부터 거부해 불일치였음.)
    static let maxProfiles = 1
    /// 클로닝에 허용되는 최소 음성 길이 (ms).
    /// 클론 최소 녹음 길이. ⚠ **60초가 아니다.** 안드로이드(`AlarmAudioStore.kt:33`)와
    /// 서버 게이트(`voice-profile.ts:50 MIN_CLONE_DURATION_MS`) 모두 12초다. 60초는
    /// `POST /voice/upload` 전용 상수(`voice-upload.ts:19`)지 클론 값이 아니다 —
    /// 이걸 60초로 두면 서버가 받아 줄 녹음을 앱이 먼저 거절한다.
    static let minDurationMs = 12_000
    /// 클로닝에 허용되는 최대 음성 길이 (ms).
    static let maxDurationMs = 120_000
    /// 길이 측정 반올림을 흡수하는 상단 허용 오차 (ms). Android
    /// `AlarmAudioStore.MAX_DURATION_TOLERANCE_MILLIS`(=5_000) 와 동일 — 120s + 5s 까지
    /// 받아들여 120.x~125s 파일/녹음이 측정 오차로 거부되지 않게 한다.
    static let maxDurationToleranceMs = 5_000
}

@MainActor
final class VoiceStudioViewModel: ObservableObject {
    @Published var profiles: [VoiceProfile] = {
        #if DEBUG
        if UIPreviewSeed.isEnabled { return UIPreviewSeed.makeVoiceProfiles() }
        #endif
        return []
    }()
    @Published var familyVoices: [FamilyVoiceProfile] = []
    /// 기본 제공(스톡) 알람 클립 카탈로그. 무료 등급 + 시스템 보이스 선택 시
    /// 에디터의 StockClipPicker 가 사용. 세션당 1회 로드한다.
    @Published var stockClips: [StockClip] = []
    @Published var selectedProfileID: String?
    /// 사용자가 고른 기본 목소리 id(시스템 스톡 보이스). 로그인 후 기기 설정에서 로드.
    /// 새 알람 에디터 미리선택 + 에디터 시스템음성 노출 제한 + 목소리 탭 표시에 사용.
    @Published var defaultVoiceId: String?
    /// 기본(시스템) 목소리가 사용자를 부를 호칭. 시스템 음성 알람 TTS 의 listenerTitle 로 사용.
    @Published var defaultListenerTitle: String?
    /// 온보딩/목소리 탭에서 "들어보기"(greeting) 재생 중인 시스템 음성 id. nil 이면 정지 상태.
    @Published var previewingGreetingVoiceId: String?

    /// 방금 만든 **초안**. 목록 새로고침이 아직 안 끝났어도 확인 스텝이 이걸로 그린다.
    /// 승격하거나 지우면 nil 로 되돌린다.
    @Published var pendingDraft: VoiceProfile?
    @Published var ttsText = "좋은 아침이에요! 일어나세요! 오늘 하루도 힘내봐요!"
    @Published var ttsCategory = "morning"
    @Published var ttsLanguage = "ko"
    @Published var randomPrompt = false
    /// 랜덤 프롬프트 컨텍스트. Android `TtsApi.kt` randomContext 와 동일.
    /// 허용 값: preset / wake_weather / wake_fortune / love / medication (`RandomPromptContext` 참조).
    /// meal/sleep/exercise 는 제품에서 사라졌고 서버가 400 으로 거절한다.
    /// randomPrompt 가 true 일 때만 의미가 있다.
    @Published var randomContext: String = RandomPromptContext.defaultContext.rawValue
    @Published var weatherCountry = ""
    @Published var weatherCity = ""
    @Published var fortuneGender = ""
    @Published var fortuneBirthDate = ""
    @Published var fortuneBirthTime = ""
    @Published var cloneName = "내 목소리"
    /// **사용자가 시작한 쓰기**(등록·삭제·이름변경·공유 토글…) 전용. 화면이 버튼을 잠근다.
    @Published var isBusy = false

    /// **자동 새로고침 전용**(화면 진입·전경 복귀·푸시). 버튼을 잠그지 않는다.
    /// 이유는 `SocialFeatureViewModel.isRefreshing` 주석 참조 —
    /// 하나로 합치면 목록을 불러오는 사이에 누른 버튼이 조용히 무시된다.
    @Published private(set) var isRefreshing = false

    @Published var statusMessage: String?
    @Published var preparedAlarm: PreparedAlarmTalk?
    /// 이번 달 목소리 쿼터. 조회 실패면 nil — 화면은 숫자를 감추고 평소대로 그린다
    /// (못 물어본 것이 버튼을 끄는 이유가 되면 안 된다).
    @Published private(set) var draftQuota: VoiceDraftQuotaResponse?

    let recorder = VoiceRecorder()
    let previewPlayer = AudioPreviewPlayer()

    private let api: AlarmTalkAPI
    private let defaultVoiceStore = DefaultVoicePreferenceStore()
    private var cancellables = Set<AnyCancellable>()
    private var activeUserID: String?
    private var greetingPreviewRequestId = 0

    init(api: AlarmTalkAPI = .shared) {
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
        previewPlayer.onFinish = { [weak self] in
            self?.previewingGreetingVoiceId = nil
        }
    }

    var selectedProfile: VoiceProfile? {
        guard let selectedProfileID else { return nil }
        return profiles.first { $0.id == selectedProfileID }
    }

    var selectedFamilyVoice: FamilyVoiceProfile? {
        guard let selectedProfileID else { return nil }
        return familyVoices.first { $0.id == selectedProfileID }
    }

    func clearUserScopedRemoteState() {
        // 화면 확인 모드에서는 시드를 지우지 않는다 — 세션 변화마다 목록이 비워진다.
        if UIPreviewSeed.isEnabled { return }
        activeUserID = nil
        greetingPreviewRequestId += 1
        previewPlayer.stop()
        recorder.clearLatest()
        profiles = []
        familyVoices = []
        stockClips = []
        selectedProfileID = nil
        defaultVoiceId = nil
        defaultListenerTitle = nil
        previewingGreetingVoiceId = nil
        statusMessage = nil
        preparedAlarm = nil
        draftQuota = nil
    }

    func clearPaidVoiceState() {
        greetingPreviewRequestId += 1
        previewPlayer.stop()
        // 시스템(스톡) 목소리는 무료에서도 쓰는 "기본 목소리" — 유료 음성만 제거하고 시스템 음성은 남긴다.
        // 온보딩 "기본 목소리 고르기"가 빈 목록으로 멈추는 것 방지(Android applyFreePlanVoiceLock 미러, Codex P2).
        profiles = profiles.filter { isSystemVoice($0) }
        familyVoices = []
        stockClips = []
        selectedProfileID = nil
        preparedAlarm = nil
    }

    // MARK: - 기본 목소리 + 호칭 (Android MainViewModel.setDefaultVoice / setDefaultListenerTitle / completeVoiceSetup 미러)

    /// 기본 목소리를 설정/변경한다(온보딩·목소리 탭 공용). 기기 설정 + 상태를 함께 갱신.
    func setDefaultVoice(_ voiceId: String?) {
        defaultVoiceStore.setDefaultVoiceId(userID: activeUserID, voiceId: voiceId)
        defaultVoiceId = defaultVoiceStore.defaultVoiceId(userID: activeUserID)
    }

    /// 기본(시스템) 목소리 호칭을 설정/변경한다(온보딩·목소리 탭 공용).
    func setDefaultListenerTitle(_ title: String?) {
        defaultVoiceStore.setListenerTitle(userID: activeUserID, title: title)
        defaultListenerTitle = defaultVoiceStore.listenerTitle(userID: activeUserID)
    }

    /// 이 계정이 **마지막으로 알람 저장에 성공하며 쓴** 목소리 id.
    ///
    /// 로컬(UserDefaults) 읽기라 네트워크와 무관하게 항상 답한다 — `refresh` 의 성공 경로
    /// 안에서만 보면, 조기 반환(다른 refresh 진행 중)이나 네트워크 실패 때 편집기가
    /// 온보딩 기본 목소리로 되돌아간다(CLAUDE.md 「마지막에 쓴 것이 그룹보다 우선」 위반).
    var lastUsedVoiceId: String? {
        defaultVoiceStore.lastUsedVoiceId(userID: activeUserID)
    }

    /// 온보딩 목소리 스텝에서 기본 목소리 + 호칭을 정했을 때.
    func completeVoiceSetup(voiceId: String, listenerTitle: String?) {
        setDefaultVoice(voiceId)
        setDefaultListenerTitle(listenerTitle)
    }

    func skipVoiceSetup() {
        defaultVoiceStore.markSkipped(userID: activeUserID)
    }

    /// 앱 언어 → 스톡 클립 언어(en/ja 외엔 ko). Android `data.appVoiceLanguageOf` 미러.
    nonisolated static func appVoiceLanguage() -> String {
        let code = Locale.preferredLanguages.first
            .flatMap { Locale(identifier: $0).language.languageCode?.identifier }
        switch code {
        case "en": return "en"
        case "ja": return "ja"
        default: return "ko"
        }
    }

    /// 미리듣기용 greeting 스톡 클립 선택의 단일 출처. greeting 은 보이스당 3개 언어(ko/en/ja)가
    /// 있고 서버 /tts/stock-clips 는 language ASC 정렬이라, 무필터 first 는 항상 영어(en)를 잡는다.
    /// 앱 언어 → ko → 아무 greeting → 그 보이스의 아무 클립 순. Android `greetingStockClipFor` 미러.
    func greetingClip(voiceId: String) -> StockClip? {
        let greetings = stockClips.filter { $0.voiceProfileId == voiceId && $0.category == "greeting" }
        let appLanguage = Self.appVoiceLanguage()
        return greetings.first { ($0.language ?? "ko") == appLanguage }
            ?? greetings.first { ($0.language ?? "ko") == "ko" }
            ?? greetings.first
            ?? stockClips.first { $0.voiceProfileId == voiceId }
    }

    /// 온보딩/목소리 탭의 시스템 음성 "들어보기" — greeting 스톡 클립을 받아 미리 재생한다.
    /// 같은 음성을 다시 누르면 정지. (미리듣기 전용 — preparedAlarm 을 건드리지만 알람 흐름이 아니라 무해)
    func previewGreeting(voiceId: String, session: AuthSession?) async {
        if previewingGreetingVoiceId == voiceId {
            greetingPreviewRequestId += 1
            previewPlayer.stop()
            previewingGreetingVoiceId = nil
            return
        }
        // 기본 목소리는 **번들 클립**이 먼저다 — 서버 왕복 없이, 네트워크가 없어도 들린다.
        // (안드로이드 `playGreeting` 의 `bundledSystemGreetingRes` 분기와 같은 순서.)
        if let resource = bundledSystemGreetingResource(
            voiceProfileId: voiceId,
            appLanguage: Self.appVoiceLanguage()
        ), let url = Bundle.main.url(forResource: resource, withExtension: "mp3") {
            greetingPreviewRequestId += 1
            previewPlayer.stop()
            previewPlayer.onFinish = { [weak self] in
                Task { @MainActor in
                    if self?.previewingGreetingVoiceId == voiceId { self?.previewingGreetingVoiceId = nil }
                }
            }
            guard (try? previewPlayer.play(url: url)) != nil else {
                statusMessage = "미리듣기를 재생하지 못했어요."
                return
            }
            previewingGreetingVoiceId = voiceId
            return
        }
        guard let clip = greetingClip(voiceId: voiceId) else {
            // 클론은 사전렌더가 끝나야 인사말 클립이 생긴다 — 조용히 아무 일도 안 하면
            // 버튼이 고장 난 것처럼 보인다.
            statusMessage = "미리듣기를 준비하고 있어요. 잠시 뒤에 다시 눌러 주세요."
            return
        }
        greetingPreviewRequestId += 1
        let requestId = greetingPreviewRequestId
        previewPlayer.stop()
        previewingGreetingVoiceId = voiceId
        if await prepareStockClip(clip, session: session) != nil {
            guard requestId == greetingPreviewRequestId, previewingGreetingVoiceId == voiceId else { return }
            playPreparedAudio()
        } else {
            if requestId == greetingPreviewRequestId {
                previewingGreetingVoiceId = nil
            }
        }
    }

    /// 초안 미리듣기 재생 결과.
    enum DraftPreviewOutcome {
        /// 끝까지 재생하고 서버에 청취를 기록했다. 딸린 값은 실제 합성된 문구.
        case played(String)
        case failed(String)
    }

    /// 등록 확인 스텝의 미리듣기 — 합성 → 끝까지 재생 → 서버에 청취 기록.
    ///
    /// ⚠ **재생이 끝난 뒤에야 `preview-played` 를 부른다.** 시작하자마자 부르면 사용자가
    /// 안 듣고 넘어가도 저장이 열려, 이 스텝을 둔 이유(결과를 듣고 결정하게 하기)가
    /// 사라진다. 안드로이드도 `setOnCompletionListener` 안에서 부른다.
    func playDraftPreview(draft: VoiceProfile, session: AuthSession?) async -> DraftPreviewOutcome {
        guard let token = session?.token else { return .failed("로그인이 필요해요.") }
        do {
            let response = try await api.generateTTS(
                TtsGenerateRequest(
                    voiceProfileId: draft.id,
                    text: "",
                    category: "morning",
                    language: Self.appVoiceLanguage(),
                    translate: false,
                    random: true,
                    listenerTitle: draft.listenerTitle,
                    draftPreview: true
                ),
                token: token
            )
            guard let data = Data(base64Encoded: response.audioBase64), !data.isEmpty else {
                return .failed(String(localized: "미리듣기를 재생하지 못했어요."))
            }
            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent("draft_preview_\(response.messageId)")
                .appendingPathExtension(response.audioFormat.isEmpty ? "mp3" : response.audioFormat)
            try data.write(to: url, options: .atomic)

            // 재생이 끝날 때까지 기다린다.
            await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                previewPlayer.onFinish = { continuation.resume() }
                if (try? previewPlayer.play(url: url)) == nil { continuation.resume() }
            }
            previewPlayer.onFinish = nil

            if let playbackToken = response.previewPlaybackToken {
                _ = try await api.confirmVoicePreviewPlayed(
                    id: draft.id,
                    playbackToken: playbackToken,
                    token: token
                )
            } else if response.previewPlaybackConfirmed != true {
                return .failed("미리듣기 확인에 실패했어요. 다시 들어 주세요.")
            }
            return .played(response.text)
        } catch {
            return .failed(mapVoiceError(error))
        }
    }

    /// 인사말 미리듣기만 정지한다 — 기본 목소리 선택 시트가 닫힐 때 호출.
    /// Android VoiceProfileManagementPanel.stopMediaPreview 의 greeting 부분 미러.
    func stopGreetingPreview() {
        greetingPreviewRequestId += 1
        previewPlayer.stop()
        previewingGreetingVoiceId = nil
    }

    var selectedListenerTitle: String? {
        if let listener = selectedProfile?.listenerTitle, let trimmed = (listener).nilIfBlank {
            return trimmed
        }
        if let listener = selectedFamilyVoice?.listenerTitle, let trimmed = (listener).nilIfBlank {
            return trimmed
        }
        // 시스템(기본) 목소리는 프로필 호칭이 없으니 온보딩/목소리 탭에서 정한 기본 호칭 사용.
        if isSystemVoiceProfile(id: selectedProfileID), let trimmed = defaultListenerTitle?.nilIfBlank {
            return trimmed
        }
        return nil
    }

    var hasWeatherInfo: Bool {
        (weatherCountry).nilIfBlank != nil && (weatherCity).nilIfBlank != nil
    }

    var hasFortuneInfo: Bool {
        (fortuneGender).nilIfBlank != nil &&
            (fortuneBirthDate).nilIfBlank != nil &&
            (fortuneBirthTime).nilIfBlank != nil
    }

    /// 슬롯이 가득 찼는지 — VoiceProfileManagementPanel 의 슬롯 카드/추가 버튼 비활성에 사용.
    var usedProfileSlots: Int {
        profiles.filter { !isSystemVoice($0) }.count
    }

    func isSystemVoiceProfile(id: String?) -> Bool {
        guard let id else { return false }
        return profiles.first { $0.id == id }.map(isSystemVoice) ?? isSystemVoiceId(id)
    }

    var isProfileLimitReached: Bool { usedProfileSlots >= VoiceProfileLimits.maxProfiles }

    /// 남은 등록 슬롯.
    var remainingProfileSlots: Int {
        max(0, VoiceProfileLimits.maxProfiles - usedProfileSlots)
    }

    private func normalizedUserID(_ userID: String?) -> String? {
        let normalized = userID?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return normalized.isEmpty ? nil : normalized
    }

    func refresh(
        session: AuthSession?,
        force: Bool = false,
        // ⚠ **기본값은 nil 이다 — 성공을 알리지 않는다.** 이 새로고침은 사용자가 누른
        // 것이 아니라 화면 진입에서 자동으로 돈다. 성공은 목록이 이미 보여 주므로,
        // 문구를 세우면 목소리 탭에 들어갈 때마다 "불러왔어요" 가 떠 있게 된다.
        // (알릴 값이 있는 호출부가 생기면 그때 명시적으로 넘긴다.)
        successMessage: String? = nil
    ) async {
        // 화면 확인 모드는 서버가 없다 — 실패 메시지로 목록을 덮지 않는다.
        if UIPreviewSeed.isEnabled { return }
        guard let token = session?.token,
              let userID = normalizedUserID(session?.user.id) else {
            clearUserScopedRemoteState()
            return
        }
        activeUserID = userID
        // 기본 목소리/호칭은 기기 클라 설정(유저별). 프로필 로드와 무관하게 바로 채운다.
        defaultVoiceId = defaultVoiceStore.defaultVoiceId(userID: userID)
        defaultListenerTitle = defaultVoiceStore.listenerTitle(userID: userID)
        // 읽기 전용이라 `isRefreshing` 만 본다 — 사용자의 쓰기 액션을 막지 않는다.
        guard force || !isRefreshing else { return }
        let shouldManageBusy = !isRefreshing
        if shouldManageBusy {
            isRefreshing = true
        }
        defer {
            if shouldManageBusy {
                isRefreshing = false
            }
        }

        do {
            async let nextProfiles = api.listVoiceProfiles(token: token)
            // 가족 목소리는 plan 에 따라 403 이 날 수 있으므로 실패해도 무시.
            let familyResult: [FamilyVoiceProfile]
            do {
                familyResult = try await api.listFamilyVoiceProfiles(token: token)
            } catch {
                familyResult = []
            }
            // 쿼터도 실패해도 무시한다 — 숫자를 못 보여줄 뿐 목소리 목록은 정상이어야 한다.
            let quotaResult = try? await api.voiceDraftQuota(token: token)
            let resolvedProfiles = try await nextProfiles
            guard activeUserID == userID else { return }
            profiles = resolvedProfiles
            familyVoices = familyResult
            // ⚠ **조회 실패로 기존 한도를 지우지 말 것.** `try?` 라 실패하면 nil 이
            // 오는데, 그대로 대입하면 이미 이번 달을 다 쓴 사용자에게 '추가' 버튼이
            // 다시 켜진다(한도 표시도 사라진다). 실패는 "모른다" 이지 "0 이다" 가 아니다.
            if let quotaResult { draftQuota = quotaResult }
            if let selectedProfileID,
               !profiles.contains(where: { $0.id == selectedProfileID }),
               !familyVoices.contains(where: { $0.id == selectedProfileID }) {
                self.selectedProfileID = nil
            }
            if selectedProfileID == nil {
                // **마지막에 쓴 목소리가 그룹·기본보다 우선한다.**
                // 그룹(내 클론 → 공유받은 → 기본) 순서를 먼저 보면, 클론을 가진 사람이
                // 기본 목소리를 골라 저장해도 매번 클론으로 되돌아간다
                // (CLAUDE.md 「목소리 프리셀렉트는 마지막에 쓴 것이 그룹보다 우선」).
                let lastUsedID = defaultVoiceStore.lastUsedVoiceId(userID: activeUserID)
                let preferredLastUsed = lastUsedID.flatMap { id in
                    profiles.first(where: { $0.id == id })?.id
                        ?? familyVoices.first(where: { $0.id == id })?.id
                }
                // 그 다음이 온보딩에서 고른 기본 목소리(목록에 있으면).
                let preferredDefault = defaultVoiceId.flatMap { id in
                    profiles.first(where: { $0.id == id })?.id
                }
                selectedProfileID = preferredLastUsed ??
                    preferredDefault ??
                    profiles.first(where: { $0.status == "ready" })?.id ??
                    profiles.first?.id ??
                    familyVoices.first(where: { $0.status == "ready" })?.id ??
                    familyVoices.first?.id
            }
            if let successMessage {
                guard activeUserID == userID else { return }
                statusMessage = successMessage
            }
        } catch {
            guard activeUserID == userID else { return }
            statusMessage = mapVoiceError(error)
        }
    }

    /// 기본 제공(스톡) 알람 클립 카탈로그를 1회 로드한다. Android
    /// `MainViewModelVoiceActions.loadStockClips` 미러: 세션 없으면 무시,
    /// 이미 채워져 있으면 재로딩하지 않고, 실패는 조용히 로그만 남긴다(비차단).
    /// `isBusy` 와 독립적으로 동작해 refresh/generate 와 나란히 실행될 수 있다.
    func loadStockClips(session: AuthSession?) async {
        guard let token = session?.token else { return }
        guard stockClips.isEmpty else { return }
        do {
            stockClips = try await api.getStockClips(token: token)
        } catch {
            // 비차단 — 카탈로그가 비면 picker 가 그냥 렌더되지 않는다.
        }
    }

    /// 선택한 스톡 클립의 음원을 받아 캐싱하고, 알람 저장 경로가 그대로 쓸 수 있는
    /// `PreparedAlarmTalk` 을 만든다. 생성 TTS 와 동일하게 `preparedAlarm` 에 실어
    /// 저장 흐름(AlarmEditorSheet saveFlow)이 server_tts 로 병합하게 한다.
    /// Android `selectStockClip` 의 다운로드 → base64 decode → 캐시 → setStockClipAudio
    /// 경로 미러. cacheKey 는 `stock_<messageId>`.
    func prepareStockClip(_ clip: StockClip, session: AuthSession?) async -> PreparedAlarmTalk? {
        guard let token = session?.token else {
            statusMessage = "로그인이 필요해요."
            return nil
        }
        let stockKey = AudioCacheStore.stockCacheKey(messageId: clip.messageId)
        do {
            // 4-reuse: 미리듣기가 같은 음원을 stock_preview_<id> 로 이미 받아 캐싱했다면
            // 재다운로드하지 않고 그 바이트를 stock_<id> 로 재키잉한다(Android 미러).
            if let cached = try? reuseStockPreviewCache(for: clip, stockKey: stockKey) {
                let prepared = makeStockPrepared(clip: clip, cached: cached, rawAudioURL: nil)
                preparedAlarm = prepared
                return prepared
            }
            let response = try await api.getTTSMessageAudio(id: clip.messageId, token: token)
            let cached = try await AudioCacheStore.cacheStockClipOffMain(
                audio: response,
                messageId: clip.messageId,
                cacheKey: stockKey
            )
            let prepared = makeStockPrepared(clip: clip, cached: cached, rawAudioURL: response.audioUrl)
            preparedAlarm = prepared
            return prepared
        } catch {
            statusMessage = mapVoiceError(error)
            return nil
        }
    }

    /// 미리듣기가 캐싱해 둔 `stock_preview_<id>` 파일을 `stock_<id>` 자리로 복사해
    /// 선택용 캐시를 만든다. 미리듣기 캐시가 없으면 nil 을 던져 정상 다운로드 경로로 보낸다.
    private func reuseStockPreviewCache(for clip: StockClip, stockKey: String) throws -> CachedVoiceAudio {
        let store = AudioCacheStore.shared
        let previewKey = AudioCacheStore.stockPreviewCacheKey(messageId: clip.messageId)
        guard let previewURL = store.cachedURL(for: previewKey) else {
            throw LocalAlarmAudioError.missingSource
        }
        let data = try Data(contentsOf: previewURL)
        let meta = store.readMetadata(cacheKey: previewKey)
        let mimeType = meta?.mimeType ?? AudioCacheStore.mimeType(
            forFormat: AudioCacheStore.normalizedFormat(previewURL.pathExtension)
        )
        // 저장 경로가 prepared.localAudioFileName 을 legacy URL 로 해석하므로 legacy
        // 사본(<messageId>.<ext>)도 보장해야 한다 — cacheStockClip 와 동일.
        let format = AudioCacheStore.fileExtension(forMimeType: mimeType)
        let legacyName = "\(clip.messageId).\(format)"
        let legacyURL = try AudioCacheStore.legacyAudioDirectory().appendingPathComponent(legacyName)
        try data.write(to: legacyURL, options: [.atomic])
        _ = try store.cacheBytes(
            data,
            cacheKey: stockKey,
            mimeType: mimeType,
            source: "tts",
            messageId: clip.messageId,
            rawAudioUri: meta?.rawAudioUri,
            durationOverrideMs: meta?.durationMs,
            enforceMaxDuration: false
        )
        return CachedVoiceAudio(url: legacyURL, fileName: legacyName, format: format, cacheKey: stockKey)
    }

    private func makeStockPrepared(clip: StockClip, cached: CachedVoiceAudio, rawAudioURL: String?) -> PreparedAlarmTalk {
        PreparedAlarmTalk(
            messageID: clip.messageId,
            voiceProfileID: clip.voiceProfileId,
            localAudioFileName: cached.fileName,
            audioCacheKey: cached.cacheKey,
            rawAudioURL: rawAudioURL,
            text: clip.text,
            language: clip.language ?? "ko",
            listenerTitle: nil
        )
    }

    func startRecording() async {
        do {
            try await recorder.start()
            statusMessage = "녹음 중이에요. 12초 이상 2분 이하로 녹음해 주세요."
        } catch {
            statusMessage = mapVoiceError(error)
        }
    }

    func stopRecording() {
        recorder.stop()
        statusMessage = "녹음을 저장했어요. \(recordingDurationLabel)"
    }

    /// 녹음본으로 목소리를 등록한다.
    ///
    /// ⚠ **성공 여부는 반환값으로만 알린다.** 호출부가 `statusMessage` 를 읽어 성공을
    /// 판정하면 안 된다 — 실패 문구 "2분 이하 음성으로 **등록**할 수 있어요." 에도 '등록' 이
    /// 들어 있어 부분 문자열 판정이 실패를 성공으로 읽는다(실제로 그랬다).
    /// 형제 메서드(`cloneWithNoiseRemoval`/`cloneAudioForProfile`)와 시그니처를 맞춘다.
    @discardableResult
    func uploadRecordingForClone(
        session: AuthSession?,
        isShared: Bool = false,
        relationshipLabel: String? = nil,
        listenerTitle: String? = nil
    ) async -> VoiceProfile? {
        guard let token = session?.token else {
            statusMessage = "로그인이 필요해요."
            return nil
        }
        guard let fields = requiredVoiceProfileFields(
            name: cloneName,
            fallbackName: "내 목소리",
            relationshipLabel: relationshipLabel,
            listenerTitle: listenerTitle
        ) else {
            return nil
        }
        cloneName = fields.name
        guard let url = recorder.latestRecordingURL, let durationMs = recorder.latestDurationMs else {
            statusMessage = "먼저 목소리를 녹음해 주세요."
            return nil
        }
        guard durationMs >= VoiceProfileLimits.minDurationMs && durationMs <= VoiceProfileLimits.maxDurationMs + VoiceProfileLimits.maxDurationToleranceMs else {
            statusMessage = durationMs < VoiceProfileLimits.minDurationMs
                ? "12초 이상 녹음해 주세요."
                : "2분 이하 음성으로 등록할 수 있어요."
            return nil
        }
        guard !isBusy else { return nil }
        isBusy = true
        defer { isBusy = false }

        do {
            let profile = try await api.cloneVoice(
                audioFileURL: url,
                name: cloneName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "내 목소리" : cloneName,
                isShared: isShared,
                durationMs: durationMs,
                token: token,
                relationshipLabel: fields.relationshipLabel,
                listenerTitle: fields.listenerTitle
            )
            selectedProfileID = profile.id
            statusMessage = "목소리 학습을 등록했어요."
            await refresh(session: session, force: true, successMessage: nil)
            return profile
        } catch {
            statusMessage = mapVoiceError(error)
            return nil
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
        guard let fields = requiredVoiceProfileFields(
            name: name,
            relationshipLabel: relationshipLabel,
            listenerTitle: listenerTitle
        ) else {
            return nil
        }
        guard !isBusy else { return nil }
        isBusy = true
        defer { isBusy = false }
        do {
            let profile = try await api.cloneVoice(
                audioFileURL: audioFileURL,
                name: fields.name,
                isShared: isShared,
                durationMs: durationMs,
                token: token,
                noiseRemoval: true,
                relationshipLabel: fields.relationshipLabel,
                listenerTitle: fields.listenerTitle
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

    /// 녹음 외 파일 업로드/자르기 결과처럼 임의 URL을 곧바로 목소리 프로필로 등록한다.
    func cloneAudioForProfile(
        audioFileURL: URL,
        name: String,
        durationMs: Int,
        isShared: Bool,
        session: AuthSession?,
        noiseRemoval: Bool = false,
        uploadFileName: String? = nil,
        relationshipLabel: String? = nil,
        listenerTitle: String? = nil
    ) async -> VoiceProfile? {
        guard let token = session?.token else {
            statusMessage = "로그인이 필요해요."
            return nil
        }
        guard let fields = requiredVoiceProfileFields(
            name: name,
            relationshipLabel: relationshipLabel,
            listenerTitle: listenerTitle
        ) else {
            return nil
        }
        guard durationMs >= VoiceProfileLimits.minDurationMs && durationMs <= VoiceProfileLimits.maxDurationMs + VoiceProfileLimits.maxDurationToleranceMs else {
            statusMessage = durationMs < VoiceProfileLimits.minDurationMs
                ? "12초 이상 준비해 주세요."
                : "2분 이하 음성으로 등록할 수 있어요."
            return nil
        }
        guard !isBusy else { return nil }
        isBusy = true
        defer { isBusy = false }
        do {
            let profile = try await api.cloneVoice(
                audioFileURL: audioFileURL,
                name: fields.name,
                isShared: isShared,
                durationMs: durationMs,
                token: token,
                noiseRemoval: noiseRemoval,
                uploadFileName: uploadFileName,
                relationshipLabel: fields.relationshipLabel,
                listenerTitle: fields.listenerTitle
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
        guard let fields = requiredVoiceRelationshipFields(
            relationshipLabel: relationshipLabel,
            listenerTitle: listenerTitle
        ) else {
            return
        }
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }
        do {
            _ = try await api.updateVoiceProfileRelationship(
                profileId: profileId,
                relationshipLabel: fields.relationshipLabel,
                listenerTitle: fields.listenerTitle,
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

        // 네트워크 합성이 끝날 때까지 미리듣기 버튼에 스피너를 띄운다(change 2).
        previewPlayer.setPreparing(true)
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
            let cacheKey = AudioCacheStore.ttsCacheKey(
                profileId: profileId,
                text: response.text,
                category: "custom",
                language: "ko",
                serverCacheKey: response.cacheKey
            )
            let cached = try await AudioCacheStore.cacheOffMain(tts: response, cacheKey: cacheKey)
            // play(...) 가 isPreparing 을 false 로 내린다.
            try previewPlayer.play(url: AudioCacheStore.url(for: cached.fileName))
        } catch {
            previewPlayer.setPreparing(false)
            statusMessage = mapVoiceError(error)
        }
    }


    /// - Parameter triggerSuccessHaptic: 생성 성공 시 `.success` 햅틱을 울릴지 여부.
    ///   저장 흐름(AlarmEditorSheet)에서 인라인 생성으로 호출될 때는 false 를 넘긴다 —
    ///   이어지는 finishScheduling 이 동일한 `.success` 햅틱을 울려 두 번 진동하기 때문.
    ///   단독 생성(음성 탭 미리듣기 등) 호출은 기본값(true)을 유지한다.
    func generateTTS(
        session: AuthSession?,
        alarmHour: Int? = nil,
        alarmMinute: Int? = nil,
        targetUserId: String? = nil,
        targetDynamicPromptState: DynamicPromptSettingsState? = nil,
        listenerTitleOverride: String? = nil,
        useListenerTitleOverride: Bool = false,
        triggerSuccessHaptic: Bool = true
    ) async -> PreparedAlarmTalk? {
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
            statusMessage = "깨워줄 말을 입력하거나 '랜덤 문구 사용'을 켜 주세요."
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
            // ⚠ **번역은 없앴다**(2026-08-12). 직접 입력한 문구는 **그대로** 읽는다 —
            // 예전에는 앱 언어가 ko 가 아니면 서버가 옮겨 읽어서, 친 글자와 들리는 말이
            // 갈라졌다. 안드로이드 `shouldTranslateVoiceText` 도 같이 껐다.
            // (스톡 클립을 고르는 언어 축은 그대로다 — 그건 번역이 아니다.)
            let shouldTranslate = false
            let activeLanguage = randomPrompt || shouldTranslate ? ttsLanguage : "ko"
            let activeCategory = randomPrompt ? promptContext.ttsCategory : "custom"
            // 고정 문구는 trim 한 채로 전송한다. canReuseExistingTtsAudio(AlarmEditDraft:214)
            // 와 위 검증 가드(681)가 trim 한 문구로 비교하므로, 여기서도 같은 문구를 보내야
            // 로컬 ttsCacheKey 가 재사용 검사와 어긋나 불필요한 재생성을 유발하지 않는다.
            // Android 는 editor.ttsTextForSave() 로 trim 한다.
            let trimmedText = ttsText.trimmingCharacters(in: .whitespacesAndNewlines)
            let requestListenerTitle = useListenerTitleOverride
                ? (listenerTitleOverride).nilIfBlank
                : selectedListenerTitle
            let response = try await api.generateTTS(
                TtsGenerateRequest(
                    voiceProfileId: profileID,
                    text: randomPrompt ? "" : trimmedText,
                    category: activeCategory,
                    language: activeLanguage,
                    translate: shouldTranslate,
                    random: randomPrompt,
                    randomContext: randomPrompt ? promptContext.rawValue : nil,
                    alarmHour: randomPrompt ? alarmHour : nil,
                    alarmMinute: randomPrompt ? alarmMinute : nil,
                    weatherCountry: targetUserId == nil && randomPrompt && promptContext.usesWeather ? (weatherCountry).nilIfBlank : nil,
                    weatherCity: targetUserId == nil && randomPrompt && promptContext.usesWeather ? (weatherCity).nilIfBlank : nil,
                    fortuneGender: targetUserId == nil && randomPrompt && promptContext.usesFortune ? (fortuneGender).nilIfBlank : nil,
                    fortuneBirthDate: targetUserId == nil && randomPrompt && promptContext.usesFortune ? (fortuneBirthDate).nilIfBlank : nil,
                    fortuneBirthTime: targetUserId == nil && randomPrompt && promptContext.usesFortune ? (fortuneBirthTime).nilIfBlank : nil,
                    listenerTitle: requestListenerTitle,
                    targetUserId: targetUserId
                ),
                token: token
            )
            let cacheKey = AudioCacheStore.ttsCacheKey(
                profileId: profileID,
                text: response.text,
                category: activeCategory,
                language: activeLanguage,
                serverCacheKey: response.cacheKey
            )
            let cached = try await AudioCacheStore.cacheOffMain(tts: response, cacheKey: cacheKey)
            let prepared = PreparedAlarmTalk(
                messageID: response.messageId,
                voiceProfileID: response.voiceProfileId,
                localAudioFileName: cached.fileName,
                audioCacheKey: cached.cacheKey,
                rawAudioURL: response.remoteAudioURI,
                text: response.text,
                language: activeLanguage,
                listenerTitle: requestListenerTitle
            )
            preparedAlarm = prepared
            statusMessage = response.cacheHit == true ? "캐시된 음성을 준비했어요." : "새 음성을 생성하고 로컬에 저장했어요."
            if triggerSuccessHaptic {
                UINotificationFeedbackGenerator().notificationOccurred(.success)
            }
            await refresh(session: session, force: true, successMessage: nil)
            return prepared
        } catch {
            statusMessage = mapVoiceError(error)
            UINotificationFeedbackGenerator().notificationOccurred(.error)
            return nil
        }
    }

    /// 준비된(캐시된) 음원을 재생한다. 네트워크/생성 없이 로컬 캐시 파일만 재생한다.
    /// 에디터의 단일 미리듣기 플레이어로 라우팅하기 위해 `player` 를 파라미터화했다 —
    /// 기본값은 VM 소유 previewPlayer (음성 탭/관리 패널 경로 호환). 에디터의 chip 은
    /// editorPreviewPlayer 를 넘긴다(change 1, 절대 generateTTS 를 부르지 않음).
    func playPreparedAudio(using player: AudioPreviewPlayer? = nil) {
        guard let preparedAlarm else {
            statusMessage = "먼저 음성을 생성해 주세요."
            return
        }
        let target = player ?? previewPlayer
        do {
            try target.play(url: AudioCacheStore.url(for: preparedAlarm.localAudioFileName))
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

    /// 목소리 프로필 삭제. force=true 가 기본 — Android 와 마찬가지로 사용 중인 알람이 있어도
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
    ) async -> Bool {
        // ⚠ 조용히 빠지지 말 것 — 사용자는 삭제를 눌렀는데 아무 일도 안 일어난 것으로 본다.
        // 안드로이드는 같은 자리에서 `msg_voice_delete_login_required` 를 띄운다.
        guard let token = session?.token else {
            statusMessage = String(localized: "로그인이 필요해요.")
            return false
        }
        guard !isBusy else { return false }
        isBusy = true
        defer { isBusy = false }

        do {
            try await api.deleteVoiceProfile(id: profile.id, token: token, force: force)
            handleDeletedVoiceProfile(profile, alarmStore: alarmStore, audioCache: audioCache)
            await refresh(session: session, force: true, successMessage: nil)
            return true
        } catch {
            if isNotFoundError(error) {
                handleDeletedVoiceProfile(profile, alarmStore: alarmStore, audioCache: audioCache)
                await refresh(session: session, force: true, successMessage: nil)
                return true
            }
            statusMessage = mapVoiceError(error)
            return false
        }
    }

    private func handleDeletedVoiceProfile(
        _ profile: VoiceProfile,
        alarmStore: LocalAlarmStore?,
        audioCache: AudioCacheStore?
    ) {
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
    }

    /// 생체정보 동의 철회로 사라진 목소리들을 로컬 알람에서 한 번에 끊는다.
    ///
    /// ⚠ **서버 응답을 받은 즉시, 세션 가드보다 먼저 부른다.** 응답을 기다리는 사이
    /// 자동 401 이 세션을 비웠을 수 있는데 그 경로는 로컬 알람 예약을 일부러 그대로
    /// 둔다(알람 전달이 인증 상태에 묶이면 안 되므로). 여기서 안 끊으면 서버에선 이미
    /// 지워진 목소리가 그 기기에서 계속 울린다.
    func degradeAlarms(usingVoiceProfileIDs ids: [String], alarmStore: LocalAlarmStore, audioCache: AudioCacheStore?) {
        for id in ids where !id.isEmpty {
            cascadeAlarmsAfterVoiceDeletion(profileID: id, alarmStore: alarmStore, audioCache: audioCache)
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


    private func isNotFoundError(_ error: Error) -> Bool {
        if case APIError.server(let status, _, _) = error {
            return status == 404
        }
        return false
    }

    private struct RequiredVoiceProfileFields {
        var name: String
        var relationshipLabel: String
        var listenerTitle: String
    }

    private func requiredVoiceProfileFields(
        name: String,
        fallbackName: String? = nil,
        relationshipLabel: String?,
        listenerTitle: String?
    ) -> RequiredVoiceProfileFields? {
        let normalizedName = (name).nilIfBlank ?? fallbackName.flatMap { ($0).nilIfBlank }
        guard let normalizedName else {
            statusMessage = "목소리 이름을 입력해 주세요."
            return nil
        }
        guard let relationship = requiredVoiceRelationshipFields(
            relationshipLabel: relationshipLabel,
            listenerTitle: listenerTitle
        ) else {
            return nil
        }
        return RequiredVoiceProfileFields(
            name: normalizedName,
            relationshipLabel: relationship.relationshipLabel,
            listenerTitle: relationship.listenerTitle
        )
    }

    private func requiredVoiceRelationshipFields(
        relationshipLabel: String?,
        listenerTitle: String?
    ) -> (relationshipLabel: String, listenerTitle: String)? {
        guard let relationshipLabel = (relationshipLabel ?? "").nilIfBlank else {
            statusMessage = "나와의 관계를 입력해 주세요."
            return nil
        }
        guard let listenerTitle = (listenerTitle ?? "").nilIfBlank else {
            statusMessage = "이 목소리가 나를 부를 호칭을 입력해 주세요."
            return nil
        }
        return (relationshipLabel, listenerTitle)
    }

    /// 목소리 **이름 변경**.
    ///
    /// ⚠ **관계·호칭을 함께 보내지 말 것.** 등록이 끝난 프로필에 그 둘을 실으면 서버가
    /// 409 `VOICE_PERSONA_LOCKED` 로 요청 **전체**를 거절해 이름 변경까지 실패한다
    /// (`voice-profile.ts:733-741`). 알람 클립이 등록 시점 페르소나로 이미 전부 렌더돼
    /// 있어 바꿀 수 있는 값이 아니다 — 안드로이드도 이름 하나만 보낸다.
    func renameProfile(_ profile: VoiceProfile, newName: String, session: AuthSession?) async {
        guard let token = session?.token else {
            statusMessage = String(localized: "로그인이 필요해요.")
            return
        }
        let trimmed = InputSanitizer.clampVoiceName(newName)
        guard !trimmed.isEmpty else {
            statusMessage = "이름을 비울 수 없어요."
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
                relationshipLabel: nil,
                listenerTitle: nil,
                token: token
            )
            await refresh(session: session, force: true, successMessage: nil)
        } catch {
            statusMessage = mapVoiceError(error)
        }
    }

    /// 공유 토글 — VoiceProfileManagementPanel 의 공유 스위치가 호출.
    func toggleShare(_ profile: VoiceProfile, isShared: Bool, session: AuthSession?) async {
        guard let token = session?.token else {
            statusMessage = String(localized: "로그인이 필요해요.")
            return
        }
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

