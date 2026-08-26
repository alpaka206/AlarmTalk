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
        return bundledSystemVoiceProfiles()
    }()
    @Published var familyVoices: [FamilyVoiceProfile] = []
    /// 기본 제공(스톡) 알람 클립 카탈로그. 무료 등급 + 시스템 보이스 선택 시
    /// 에디터의 StockClipPicker 가 사용. 세션당 1회 로드한다.
    @Published var stockClips: [StockClip] = []

    /// 목소리를 지워 알람을 톤으로 내렸다 — **예약을 맞춰야 한다**는 신호.
    ///
    /// 이 강등은 sync 경로(`cascadeAlarmsAfterVoiceDeletion`)라 여기서 `await schedule` 을
    /// 부를 수 없다. 그래서 신호만 세우고, 화면 계층이 `AlarmScheduleReconciler` 를 돌린다.
    /// 맞추기 전까지는 **지운 목소리가 예약에 남아 있다** — 늦추지 말 것.
    @Published var needsScheduleReconcile = false

    /// 카테고리별 **완전한 세트의 클립 수**(서버가 내려준다).
    ///
    /// ⚠ **앱에 개수를 박지 않는다.** 운영이 시드를 늘리면 앱 업데이트 없이 따라와야 한다.
    /// 그리고 **기본 목소리와 등록 목소리는 개수가 다르다** — `ExpectedVariantCounts` 참조.
    @Published var expectedVariants: ExpectedVariantCounts?
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

    /// **내가 등록한** 목소리 id 들(시스템·공유받은 것 제외).
    ///
    /// 선다운로드 대상을 정할 때 쓴다 — 내 클론의 사전렌더 프리셋은 미리 받고
    /// (등록은 생성+다운로드가 끝나야 끝난 것이다), 공유받은 목소리는 고를 때 받는다.
    var ownedVoiceProfileIDs: Set<String> {
        Set(profiles.filter { !isSystemVoice($0) }.map { $0.id })
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
        profiles = bundledSystemVoiceProfiles()
        familyVoices = []
        stockClips = []
        // ⚠ **떠 있는 매니페스트 조회의 세대를 죽인다**(Codex #703 P1). 안 죽이면 계정 A 의
        // 응답이 로그아웃 뒤에 돌아와 A 의 **클론 매니페스트**(목소리 이름·문구 포함)를 다시
        // 공개하고, 계정 B 가 오프라인이면 그걸 디스크에서 시드로 읽는다.
        manifestRevision &+= 1
        manifestFetchedThisSession = false
        // ⚠ **권위도 함께 내린다.** 안 내리면 로그아웃 뒤 밀려 들어온
        // `voice_access_revoked` 가 **빈 목록을 근거로** 이 계정의 목소리 알람을 전부
        // 강등한다 — 서버가 아무것도 확인해 주지 않았는데도(2026-08-18 Codex #697 P1).
        accessibleVoicesAreAuthoritative = false
        // 디스크 사본도 같이 지운다 — 매니페스트에는 **그 계정의 클론 클립**이 들어 있어
        // 계정이 바뀌면 남의 목록을 시드하게 된다. 지워도 다음 조회가 다시 채우므로
        // 오프라인 판정은 그때부터 정상으로 돌아온다.
        StockClipManifestStore.clear()
        manifestFetchedThisSession = false
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
            // 목록·가족 목소리와 함께 시작한다. 뒤에서 시작하면 한도 숫자만 한 왕복 늦게 뜬다.
            async let nextQuota: VoiceDraftQuotaResponse? = try? api.voiceDraftQuota(token: token)
            // 가족 목소리는 plan 에 따라 403 이 날 수 있으므로 실패해도 무시.
            let familyResult: [FamilyVoiceProfile]
            // ⚠ **실패와 '없음' 을 구분해 남긴다.** 403 은 "이 플랜엔 공유 목소리가 없다" 는
            // **확정**이지만, 네트워크 오류는 "모른다" 다. 둘을 같이 `[]` 로 두면 아래
            // `reconcileInaccessibleVoiceAlarms` 가 일시적 오류를 접근권 상실로 읽고
            // **공유 목소리 알람을 되돌릴 수 없게 강등한다.**
            var familyAuthoritative = true
            do {
                familyResult = try await api.listFamilyVoiceProfiles(token: token)
            } catch APIError.server(let status, _, _) where status == 403 {
                familyResult = []
            } catch {
                familyResult = []
                familyAuthoritative = false
            }
            // 쿼터도 실패해도 무시한다 — 숫자를 못 보여줄 뿐 목소리 목록은 정상이어야 한다.
            let quotaResult = await nextQuota
            let resolvedProfiles = try await nextProfiles
            guard activeUserID == userID else { return }
            // ⚠ **상태를 쓰기 전에 취소를 확인한다**(2026-08-18 Codex #697 P2).
            // 위쪽 쿼터 조회는 `try?`, 가족 목소리는 자체 `catch` 라 **둘 다 취소를
            // 삼킨다** — 그래서 아래 `catch is CancellationError` 에 걸리지 않고 여기까지
            // 온다. 그대로 진행하면 BGTask 가 "끝났다" 고 통보한 뒤에 목록을 갈아 끼우고
            // `onAuthoritativeRefresh` 가 알람을 강등·재예약한다.
            if Task.isCancelled { return }
            // ⚠ **정리가 끝나지 않은 교체 목소리는 아직 고를 수 없다.** 서버 목록은 이미 새
            // 목소리를 주지만, 이 기기의 직접 입력 알람 정리(강등·예약)가 끝나지 않았으면
            // 그 사이 만든 새 알람을 다음 회차가 함께 지운다 — 강등 대상은 프로필 id 로만
            // 고르기 때문이다. 안드로이드 승격 경로도 같은 자리에서 목록에서 뺀다.
            // ⚠ **가려진 목소리도 '접근 가능' 하고 '판정 대상' 이다.** 아래 강등 판정과
            // 교체 표식 대조는 `authoritativeProfiles`(거르지 않은 서버 목록)를 본다 —
            // 거른 목록으로 판단하면 (a) 그 목소리를 쓰는 프리셋 알람이 '접근권 상실' 로
            // 되돌릴 수 없이 벗겨지고, (b) 미확정 표식을 다시 집을 기회가 사라진다.
            authoritativeProfiles = resolvedProfiles
            // ⚠ **정리 중인 목소리도 목록에 남긴다**(2026-08-25 지시). 감추면 사용자에게는
            // **사라진 것으로 보여 고장으로 읽힌다.** 자리에 두고 `replacementSuppressedProfileIDs`
            // 로 흐리게 그린 뒤 못 고르게 한다(`VoiceSelectionSheet.Option.unavailableReason`).
            profiles = resolvedProfiles
            familyVoices = familyResult
            // 프로필 조회는 여기까지 왔다는 것 자체가 성공이다(실패하면 throw).
            accessibleVoicesAreAuthoritative = familyAuthoritative
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
            // 목록이 확정됐으니 접근권을 잃은 알람을 내린다(훅 주석 참조).
            // 권위가 없는 회차에는 훅 안의 판정이 스스로 물러서므로 여기서 또 가르지 않는다.
            await onAuthoritativeRefresh?()
        } catch {
            // ⚠ **취소를 실패로 그리지 않는다**(2026-08-18 Codex #697 P2). 워치독이 회차를
            // 접은 것뿐인데 "목소리를 불러오지 못했어요" 를 남기면 거짓말이고, 그 뒤로도
            // 계속 진행하면 끝났다고 통보한 사이클이 상태를 더 만진다.
            // ⚠ 권위 플래그는 이미 false 다(성공 경로에서만 세운다) — 강등은 스스로 물러선다.
            if error is CancellationError || Task.isCancelled { return }
            guard activeUserID == userID else { return }
            statusMessage = mapVoiceError(error)
        }
    }

    /// 기본 제공(스톡) 알람 클립 카탈로그를 1회 로드한다. Android
    /// `MainViewModelVoiceActions.loadStockClips` 미러: 세션 없으면 무시,
    /// 이미 채워져 있으면 재로딩하지 않고, 실패는 조용히 로그만 남긴다(비차단).
    /// `isBusy` 와 독립적으로 동작해 refresh/generate 와 나란히 실행될 수 있다.
    /// 스톡 클립 매니페스트를 채운다.
    ///
    /// ⚠ **실패를 조용히 삼키되, 다음 호출이 반드시 다시 시도할 수 있어야 한다.**
    /// 이 함수는 편집기 진입·앱 시작 양쪽에서 불린다. `stockClips` 가 비어 있으면 계속
    /// 재시도하므로(아래 guard) 한 번 실패해도 다음 기회에 채워진다.
    /// 매니페스트가 비면 알람 편집기의 테마 목록이 통째로 비어, 문구 행이
    /// "불러오는 중이에요" 에서 벗어나지 못한다.
    @discardableResult
    func loadStockClips(session: AuthSession?, force: Bool = false) async -> Bool {
        // ⚠ **디스크에서 먼저 채운다.** 매니페스트가 메모리에만 있으면 '모른다' 상태가
        // 생기고, 관문(`needsPreparation`: nil → 막지 않음)과 저장(`hasCompleteBucket`:
        // nil → 불완전)이 **정반대로 답한다** — 고를 수는 있는데 저장은 안 된다.
        // 비행기모드 콜드스타트에서는 클립을 전부 받아 둔 기기도 알람을 못 만든다.
        // 자세한 것은 `StockClipManifestStore` 주석.
        if stockClips.isEmpty, let cached = StockClipManifestStore.load() {
            stockClips = cached.clips
            expectedVariants = cached.expectedVariants
        }
        // ⚠ **반환값은 '이번에 서버에서 새로 받았는가' 다**(Codex #703 P1). 예전에는
        // "매니페스트를 갖고 있는가" 라 디스크·메모리 폴백에도 true 였는데, 교체 확정 게이트가
        // 그걸 '신선함' 으로 읽으면 **교체 이전 스냅샷**(전부 rendered=true)으로 세대를
        // 확정한다 — 완료 푸시를 놓친 기기는 회수된 프리셋을 문 채 남는다.
        guard let token = session?.token else { return false }
        // ⚠ 판정은 `stockClips.isEmpty` 가 아니라 **이번 세션에 받았는가**다. 디스크에서
        // 채웠다는 이유로 건너뛰면 운영이 추가한 프리셋이 영영 안 들어온다.
        // 이번 세션에 이미 받았고 강제도 아니면 **새로 받은 것이 아니다.**
        guard force || !manifestFetchedThisSession else { return false }
        // 이 조회의 세대. 뒤에 시작한 조회가 세대를 올리면 이 응답은 **공개하지도 저장하지도**
        // 않는다 — 옛 매니페스트로 되돌리면 캐시 대조의 기준 자체가 뒤로 가, 서버의 현재
        // 음원이 '지나간 응답' 으로 판정돼 회수된 목소리가 그대로 남는다(Codex #703 P1).
        // 안드로이드 짝은 `MainViewModel.stockClipManifestRevision`.
        manifestRevision &+= 1
        let revision = manifestRevision
        do {
            let manifest = try await api.getStockClipManifest(token: token)
            // 밀려난 응답은 공개하지 않으므로 '새로 받았다' 도 아니다.
            guard revision == manifestRevision else { return false }
            stockClips = manifest.clips
            expectedVariants = manifest.expectedVariants
            manifestFetchedThisSession = true
            StockClipManifestStore.save(manifest)
            return true
        } catch {
            // 비차단 — 다음 호출이 다시 시도한다. 디스크 값이 있으면 화면은 그걸로 계속
            // 가지만, **새로 받은 것은 아니다.**
            return false
        }
    }

    /// 이번 실행에서 서버 매니페스트를 받았는가. 디스크 시드와 구분하기 위한 값이다.
    private var manifestFetchedThisSession = false

    /// 매니페스트 조회의 세대 — 늦게 도착한 앞선 응답을 버린다(`loadStockClips` 주석).
    private var manifestRevision = 0

    /// 제자리 교체가 같은 message ID에 게시한 새 오디오만 다시 받는다.
    /// 반환값이 true면 iOS 예약에 구워 둔 사운드도 다시 맞춰야 한다.
    /// 프리셋 캐시 갱신 결과.
    ///
    /// `settled` 를 따로 두는 이유(Codex #703 P1): 교체 세대를 **확정해도 되는지**는
    /// "뭔가 바꿨는가" 가 아니라 **"낡은 것을 남김없이 갈아 끼웠는가"** 로 갈린다. 남은 것이
    /// 있는데 확정하면 다음 회차부터 '이미 반영함' 이라, 프리셋 알람이 회수된 목소리로
    /// 계속 운다.
    struct StockCacheRefreshOutcome {
        /// 실제로 갈아 끼운 키가 있다 — 재예약이 필요하다.
        let changed: Bool
        /// **아직 끝나지 않은 목소리들.** 서버가 재렌더를 안 끝냈거나, 낡은 키를 다 갈아
        /// 끼우지 못한 프로필 id.
        ///
        /// ⚠ **프로필 단위여야 한다**(Codex #703 P2). 예전에는 전역 Bool 이라, 접근 가능한
        /// **다른** 목소리의 렌더가 멈춰 있으면 멀쩡히 끝난 목소리까지 확정되지 못하고
        /// 계속 가려졌다 — 그 목소리는 무기한 못 고르게 된다.
        let pendingProfileIDs: Set<String>

        /// 이 목소리의 프리셋 작업이 끝났는가.
        func settled(forProfileID profileID: String) -> Bool {
            !pendingProfileIDs.contains(profileID)
        }
    }

    @discardableResult
    func refreshChangedCachedStockClips(session: AuthSession?) async -> StockCacheRefreshOutcome {
        // 토큰이 없으면 아무것도 확인하지 못했다 — 어떤 프로필도 '끝났다' 고 말할 수 없다.
        guard let token = session?.token else {
            return .init(
                changed: false,
                pendingProfileIDs: Set(stockClips.map(\.voiceProfileId))
            )
        }
        let cache = AudioCacheStore.shared
        let stale = stockClips.compactMap { clip -> (StockClip, [String])? in
            let keys = AudioCacheStore.messageCacheKeys(messageId: clip.messageId).filter { key in
                cache.isStale(cacheKey: key, remoteAudioUri: clip.audioUrl)
                    // 세대 표식이 없는 옛 캐시도 **한 번은** 다시 받는다 — 비교할 값이 없어
                    // 낡음 판정을 영영 통과하지 못한다(안드로이드도 같은 자리에서 함께 본다).
                    || cache.needsRevisionRefresh(cacheKey: key, remoteAudioUri: clip.audioUrl)
            }
            return keys.isEmpty ? nil : (clip, keys)
        }
        // ⚠ **낡은 키가 없다고 '끝났다' 가 아니다**(Codex #703 P1). 서버는 교체 세대를 먼저
        // 게시하고 프리셋은 cron 이 나중에 굽는다 — 그 사이 매니페스트는 옛 클립을 그대로
        // 가리키므로, 캐시와 비교하면 당연히 낡은 것이 없다. 그 상태로 확정하면 재렌더가
        // 끝난 뒤에도 다시 받지 않아 회수된 목소리로 계속 운다.
        let prerenderPending = Set(
            stockClips.filter { !$0.isRenderedForCurrentVoice }.map(\.voiceProfileId)
        )
        guard !stale.isEmpty else {
            return .init(changed: false, pendingProfileIDs: prerenderPending)
        }

        // 갈아 끼우지 못한 키가 남은 목소리도 '아직' 이다 — 키를 프로필로 되짚기 위해 적어 둔다.
        var keyOwner: [String: String] = [:]
        for (clip, keys) in stale {
            for key in keys { keyOwner[key] = clip.voiceProfileId }
        }
        var refreshedKeys = Set<String>()
        for batchStart in stride(from: 0, to: stale.count, by: 4) {
            let batch = Array(stale[batchStart..<min(batchStart + 4, stale.count)])
            await withTaskGroup(of: [String].self) { group in
                for (clip, cacheKeys) in batch {
                    group.addTask { [api] in
                        var refreshed: [String] = []
                        do {
                            let response = try await api.getTTSMessageAudio(id: clip.messageId, token: token)
                            for key in cacheKeys {
                                do {
                                    _ = try await AudioCacheStore.cacheStockClipOffMain(
                                        audio: response,
                                        messageId: clip.messageId,
                                        cacheKey: key
                                    )
                                } catch AudioCacheError.legacyAliasFailed {
                                    // 정본은 커밋됐다 — 그 키는 더 이상 stale 이 아니라 다음
                                    // 회차가 다시 받지 않는다. 여기서 접으면 재예약도 안 돌아
                                    // 예약이 옛 사본을 가리킨 채 남으므로 **갱신으로 센다**.
                                } catch {
                                    // ⚠ **실패한 키를 '갱신됨' 으로 세지 말 것**(Codex #703 P1).
                                    // 아래에서 구워 둔 사운드를 버리는데, 캐시 메타는 옛 세대
                                    // 그대로라 지문이 같아 재예약이 오지 않는다 — 예약만 없는
                                    // 이름을 가리킨 채 남는다. 세지 않으면 그 키는 stale 로
                                    // 남아 다음 회차가 다시 집는다. 같은 클립의 다른 키는
                                    // 계속 시도한다.
                                    continue
                                }
                                refreshed.append(key)
                            }
                        } catch {
                            return refreshed
                        }
                        return refreshed
                    }
                }
                for await keys in group {
                    refreshedKeys.formUnion(keys)
                }
            }
        }
        // AlarmKit은 예약 때 Library/Sounds 사본을 고정하므로 새 캐시만 받아서는 부족하다.
        for key in refreshedKeys {
            AlarmSoundStaging.clearStagedSound(forKey: key)
        }
        let unfinished = Set(
            keyOwner.filter { !refreshedKeys.contains($0.key) }.values
        )
        return .init(
            changed: !refreshedKeys.isEmpty,
            pendingProfileIDs: prerenderPending.union(unfinished)
        )
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
            // ⚠ **선다운로드해 둔 캐시를 먼저 본다.** 예전에는 이 확인이 없어서
            // `StockClipPrefetcher` 가 받아 둔 바로 그 키(`stock_<id>`)를 두고도 **매번
            // 네트워크를 쳤다.** 그래서 오프라인·약전파에서 테마가 안 붙었고, 프리페처
            // 주석의 "받아 두니 네트워크 없어도 테마를 고를 수 있다" 는 약속이 거짓이었다.
            // 안드로이드 `bindStockBucketClips` 는 `audioStore.getCachedAudio(cacheKey) ?: 다운로드`
            // 로 캐시 우선이다.
            if let url = AudioCacheStore.shared.cachedURL(for: stockKey),
               !AudioCacheStore.shared.isStale(cacheKey: stockKey, remoteAudioUri: clip.audioUrl) {
                let cached = CachedVoiceAudio(
                    url: url,
                    fileName: url.lastPathComponent,
                    format: url.pathExtension.isEmpty ? "mp3" : url.pathExtension,
                    cacheKey: stockKey
                )
                let prepared = makeStockPrepared(clip: clip, cached: cached, rawAudioURL: nil)
                preparedAlarm = prepared
                return prepared
            }
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
        guard let previewURL = store.cachedURL(for: previewKey),
              !store.isStale(cacheKey: previewKey, remoteAudioUri: clip.audioUrl) else {
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
            // 재생 중인 녹음이 새 마이크 입력에 섞이지 않게 먼저 멈춘다.
            previewPlayer.stop()
            try await recorder.start()
            // 녹음 카드가 상태와 시간을 직접 보여 준다. 별도 안내를 띄우면 Android에는
            // 없는 고정 문구가 카드 아래에 한 줄 더 생긴다.
            statusMessage = nil
        } catch {
            statusMessage = mapVoiceError(error)
        }
    }

    func stopRecording() {
        recorder.stop()
        statusMessage = nil
    }

    /// 녹음본으로 목소리를 등록한다.
    ///
    /// ⚠ **성공 여부는 반환값으로만 알린다.** 호출부가 `statusMessage` 를 읽어 성공을
    /// 판정하면 안 된다 — 실패 문구 "2분 이하 음성으로 **등록**할 수 있어요." 에도 '등록' 이
    /// 들어 있어 부분 문자열 판정이 실패를 성공으로 읽는다(실제로 그랬다).
    /// 형제 메서드(`cloneAudioForProfile`)와 시그니처를 맞춘다.
    @discardableResult
    func uploadRecordingForClone(
        session: AuthSession?,
        isShared: Bool = false,
        relationshipLabel: String? = nil,
        listenerTitle: String? = nil,
        language: String = VoiceStudioViewModel.appVoiceLanguage()
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
                listenerTitle: fields.listenerTitle,
                language: language
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

    /// 녹음 외 파일 업로드/자르기 결과처럼 임의 URL을 곧바로 목소리 프로필로 등록한다.
    func cloneAudioForProfile(
        audioFileURL: URL,
        name: String,
        durationMs: Int,
        isShared: Bool,
        session: AuthSession?,
        uploadFileName: String? = nil,
        relationshipLabel: String? = nil,
        listenerTitle: String? = nil,
        language: String = VoiceStudioViewModel.appVoiceLanguage()
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
                uploadFileName: uploadFileName,
                relationshipLabel: fields.relationshipLabel,
                listenerTitle: fields.listenerTitle,
                language: language
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
        if previewPlayer.isPlaying {
            previewPlayer.stop()
            return
        }
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
    /// **정리가 끝나지 않아 아직 고를 수 없는 교체 목소리.**
    ///
    /// 교체는 프로필 id 를 재사용하므로, 정리(강등·예약)가 실패한 채 **고를 수 있게** 두면
    /// 그 사이 만든 새 목소리 알람까지 다음 회차가 되돌릴 수 없이 벗긴다. 다음 정리가
    /// 확정되면 곧바로 풀린다(메모리 전용 — 재시작 후에는 새로고침이 다시 판단한다).
    ///
    /// ⚠ **목록에서 빼는 것이 아니라 '고를 수 없음' 이다**(2026-08-25 지시). 감추면
    /// 사용자에게는 목소리가 **사라진 것으로 보여 고장으로 읽힌다.** 자리에 두고 흐리게
    /// 그린 뒤 이유를 말한다.
    /// ⚠ **`@Published` 여야 한다**(Codex #703 P2). 이 값은 목록 행의 흐림·저장 게이트·
    /// 배너를 모두 좌우하는데, 푸시 경로의 정리는 새로고침이 끝난 **뒤에** 이 집합만
    /// 바꾼다 — 관측되지 않으면 이미 열려 있는 편집기가 옛 상태(고를 수 있음·배너 없음)를
    /// 계속 그린다. 저장은 탭 시점 판정이 막지만, 화면이 그 이유를 말하지 못한다.
    @Published private(set) var replacementSuppressedProfileIDs: Set<String> = []

    /// 서버가 준 목록 **그대로**(가리기 전). 강등·표식 판정은 언제나 이걸 본다.
    private(set) var authoritativeProfiles: [VoiceProfile] = []

    func suppressReplacedProfile(_ profileID: String) {
        guard !profileID.isEmpty else { return }
        replacementSuppressedProfileIDs.insert(profileID)
        if !authoritativeProfiles.contains(where: { $0.id == profileID }),
           let shown = profiles.first(where: { $0.id == profileID }) {
            // 아직 새로고침 전이면 권위 목록에도 남겨 둔다(판정에서 사라지면 안 된다).
            authoritativeProfiles.append(shown)
        }
    }

    /// 그 목소리를 **지금 고를 수 있는가.** 정리가 끝나지 않았으면 false.
    func isReplacementSettling(_ profileID: String) -> Bool {
        replacementSuppressedProfileIDs.contains(profileID)
    }

    func releaseReplacedProfile(_ profileID: String) {
        replacementSuppressedProfileIDs.remove(profileID)
    }

    /// 마지막 새로고침의 목소리 목록이 **믿을 수 있는가**(= 서버가 확정해 준 값인가).
    /// 실패한 조회로 알람을 강등하지 않기 위한 게이트다.
    private(set) var accessibleVoicesAreAuthoritative = false

    /// **접근권을 잃은 목소리를 쓰는 내 알람을 기본 알람음으로 내린다.**
    ///
    /// 안드로이드 `MainViewModel.reconcileInaccessibleVoiceAlarms` 의 짝이다 — iOS 에는
    /// 이 경로가 아예 없어서, `voice_access_revoked`·`voice_share_changed` 푸시를 받아도
    /// **목록만 갱신하고 알람은 그대로 그 목소리로 울렸다**(2026-08-18 Codex #697 P1).
    ///
    /// ⚠ **`accessibleVoicesAreAuthoritative` 없이 부르지 말 것.** 조회가 실패한 회차의
    /// 빈 목록으로 판단하면 멀쩡한 공유 목소리 알람을 **되돌릴 수 없게** 강등한다.
    /// 안드로이드도 같은 이유로 `familyVoicesLoadedFresh`·`voiceProfilesLoadedFresh` 를 본다.
    ///
    /// - Returns: 강등한 알람 수.
    /// 서버가 확정해 준 목록을 받은 **직후** 부른다. 앱이 여기에 강등 + 재예약을 꽂는다.
    ///
    /// ⚠ **강등을 푸시 핸들러에만 달지 말 것**(2026-08-18 Codex #697 P1). 푸시는
    /// best-effort 라 오프라인·스로틀링·강제종료에서 조용히 버려진다 — 그때 그물은
    /// 시작·탭 진입·백그라운드 주기의 새로고침인데, 강등이 거기 없으면 **철회된 목소리가
    /// 다음 푸시가 올 때까지 계속 예약된 채 울린다.** `refresh` 호출부는 9곳인데 강등은
    /// 두 곳에만 있었다. 새로고침 자체에 매달아 호출부가 잊을 수 없게 한다.
    ///
    /// ⚠ 이 주석이 처음 쓰일 때 "백그라운드 주기" 를 근거로 들었지만 **그때 그 경로는
    /// 목소리를 새로고침하지 않았다** — 확인하지 않고 적은 것이다(2026-08-18 Codex 지적).
    /// 지금은 `BackgroundSyncTask.runAndSchedule` 이 실제로 부른다. 안드로이드의 짝은
    /// 하루 주기 `VoiceAccessSyncWorker` 다 — 셋(푸시·주기·앱 시작)이 서로 폴백이고,
    /// **정확성은 뒤 둘이 보장한다.**
    /// (이 클래스가 알람 저장소를 직접 들면 순환 참조가 된다 — 푸시 코디네이터의
    /// `onFamilyAlarm` 과 같은 방식으로 앱이 꽂는다.)
    var onAuthoritativeRefresh: (() async -> Void)?

#if DEBUG
    /// **테스트 전용 seam** — "서버가 확정해 준 목록을 받은" 상태를 만든다.
    ///
    /// ⚠ 이게 없으면 범위 테스트(소유자·origin·기본목소리)가 전부 **첫 가드에서** 통과해
    /// 아무것도 지키지 못한다 — 필터를 통째로 지워도 초록이다(2026-08-18 Codex #697 P2).
    func __setAccessibleVoicesForTests(
        profileIDs: [String] = [],
        familyVoiceIDs: [String] = []
    ) {
        // 목록 자체는 id 만 쓰므로 여기서는 권위만 세우고, 접근 가능한 id 를 따로 둔다.
        testAccessibleVoiceIDsOverride = Set(profileIDs + familyVoiceIDs)
        accessibleVoicesAreAuthoritative = true
    }

    /// 위 seam 이 세운 접근 가능 id. 릴리스 빌드에는 존재하지 않는다.
    private var testAccessibleVoiceIDsOverride: Set<String>?
#endif

    /// - Parameter ownerUserId: **이 목록을 가져온 계정.** 반드시 넘긴다 —
    ///   한 기기에서 계정을 바꾸면 B 의 목록에는 A 의 목소리 id 가 당연히 없으므로,
    ///   소유자를 안 보면 **A 의 알람을 되돌릴 수 없게 부순다**(저장소의 다른 파괴 경로
    ///   `applyFreePlanVoiceLock`·`restorePaidVoiceAlarms` 와 같은 규칙).
    @discardableResult
    func reconcileInaccessibleVoiceAlarms(
        alarmStore: LocalAlarmStore,
        audioCache: AudioCacheStore?,
        ownerUserId: String?
    ) -> Int {
        guard accessibleVoicesAreAuthoritative, let owner = ownerUserId?.nilIfBlank else { return 0 }
        // 가려진 교체 목소리도 접근 가능하다 — 거른 목록으로 판단하면 그 목소리를 쓰는
        // 프리셋 알람이 '접근권 상실' 로 되돌릴 수 없이 벗겨진다.
        var accessible = Set(authoritativeProfiles.map(\.id) + familyVoices.map(\.id))
        #if DEBUG
        if let testAccessibleVoiceIDsOverride { accessible = testAccessibleVoiceIDsOverride }
        #endif
        // ⚠ **id 가 아니라 '행' 을 고른다.** 예전에는 잃은 profileId 를 모아
        // `degradeAlarms(usingVoiceProfileIDs:)` 에 넘겼는데, 그 경로는 id 로 다시 훑어
        // **모든 origin·모든 소유자**를 잡는다 — 같은 공유 목소리를 쓰는 **받은 알람까지**
        // 벗겨 냈다. 여기서 좁힌 조건이 거기서 도로 넓어지는 셈이었다.
        let targets = alarmStore.alarms.filter { record in
            // 받은 알람은 보낸 사람의 접근권으로 성립한다 — 내 목록으로 판단하지 않는다.
            guard record.originEnum == .localOwned else { return false }
            // 소유자 미기록(옛 행)은 이 계정 것으로 본다(안드로이드·잠금 경로와 같은 관용).
            guard record.ownerUserId == nil || record.ownerUserId == owner else { return false }
            guard let voiceID = record.voiceProfileId?.nilIfBlank else { return false }
            // 시스템(기본) 목소리는 목록에 없어도 언제나 쓸 수 있다.
            return !isSystemVoiceId(voiceID) && !accessible.contains(voiceID)
        }
        guard !targets.isEmpty else { return 0 }
        degrade(records: targets, alarmStore: alarmStore, audioCache: audioCache)
        return targets.count
    }

    /// **제자리 교체된 목소리의 직접 입력 알람만** 기본 알람음으로 내린다.
    ///
    /// 교체는 옛 프로필 **행을 재사용**한다(id 가 그대로다). 그래서
    /// `reconcileInaccessibleVoiceAlarms` 의 '접근 가능 목록 대조' 로는 영원히 안 걸리고,
    /// 본인 소유 알람은 pull 대상도 아니라 서버가 행을 내려도 이 기기에 닿지 않는다 —
    /// 놔두면 **지운 사람의 목소리로 계속 운다**(Codex #703 P1).
    ///
    /// 반대로 넓히면 안 된다: 프리셋(버킷) 알람은 서버가 같은 message id 로 새 목소리를
    /// 다시 만들어 게시하므로 여기서 벗기면 되돌릴 수 없이 잃는다.
    ///
    /// ⚠ `cascadeAlarmsAfterVoiceDeletion` 을 재사용하지 말 것 — 그쪽은 origin·소유자를
    /// 가리지 않아 **받은 알람까지** 벗긴다.
    /// - Returns: 강등한 알람 **id 들**. 호출자가 그 행들의 예약이 실제로 다시 깔렸는지
    ///   확인한 뒤에야 교체 표식을 확정할 수 있다(개수만으로는 어느 행인지 알 수 없다).
    @discardableResult
    func degradeCustomMessageAlarms(
        forProfileID profileID: String,
        alarmStore: LocalAlarmStore,
        audioCache: AudioCacheStore?,
        ownerUserId: String?
    ) -> [String] {
        guard let owner = ownerUserId?.nilIfBlank, !isSystemVoiceId(profileID) else { return [] }
        let targets = alarmStore.alarms.filter { record in
            // 받은 알람은 보낸 사람의 목소리로 성립한다 — 내 교체로 판단하지 않는다.
            guard record.originEnum == .localOwned else { return false }
            // 소유자 미기록(옛 행)은 이 계정 것으로 본다(안드로이드·잠금 경로와 같은 관용).
            guard record.ownerUserId == nil || record.ownerUserId == owner else { return false }
            guard record.voiceProfileId == profileID else { return false }
            return record.usesCustomMessageVoice
        }
        guard !targets.isEmpty else { return [] }
        degrade(records: targets, alarmStore: alarmStore, audioCache: audioCache)
        return targets.map(\.id)
    }

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
        degrade(records: affected, alarmStore: alarmStore, audioCache: audioCache)
    }

    /// 주어진 **행들**을 알람음으로 내리고, 더 이상 참조되지 않는 캐시를 정리한다.
    ///
    /// ⚠ 대상 선정은 **호출자 책임**이다. 여기서 다시 넓히지 말 것 — 예전에는 이 일이
    /// profileId 로 재조회하는 형태라, 좁혀서 부른 호출자의 조건이 무의미해졌다.
    private func degrade(
        records: [LocalAlarmRecord],
        alarmStore: LocalAlarmStore,
        audioCache: AudioCacheStore?
    ) {
        let affected = records
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
                // ⚠ **구워 둔 알람 사운드도 함께 버린다.** `deleteCachedAudio` 는 오디오
                // 캐시 디렉터리만 훑는다 — 예약에 실린 사본은 `Library/Sounds/voice-<키>.caf`
                // 에 따로 있어서, 이걸 안 지우면 **지운 목소리가 다음 알람에 그대로 울린다.**
                // 파기해야 할 생체정보가 디스크와 알람에 남는 셈이라 가장 무거운 누락이었다.
                // (같은 규약이 `AudioCacheStore` 의 캐시 교체 경로에는 이미 있었다.)
                AlarmSoundStaging.clearStagedSound(forKey: key)
            }
        }
        // 행을 톤으로 내렸으니 예약도 따라가야 한다. 예약은 async 라 여기(sync)서 못 부르고,
        // 리컨사일러가 지문 불일치를 보고 다음 관문에서 맞춘다 — 그때까지는 옛 소리가
        // 예약돼 있으므로, **호출자는 되도록 곧바로 reconcile 을 돌린다.**
        needsScheduleReconcile = true
    }


    private func isNotFoundError(_ error: Error) -> Bool {
        if case APIError.server(let status, _, _) = error {
            return status == 404
        }
        return false
    }

    private struct RequiredVoiceProfileFields {
        var name: String
        var relationshipLabel: String?
        var listenerTitle: String?
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
        return RequiredVoiceProfileFields(
            name: normalizedName,
            // 등록에서는 관계·호칭이 선택값이다. 공유받은 목소리의 viewer 정보는 아래
            // `requiredVoiceRelationshipFields` 를 계속 거쳐 둘 다 필수로 받는다.
            relationshipLabel: relationshipLabel?.nilIfBlank,
            listenerTitle: listenerTitle?.nilIfBlank
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
