import Foundation

enum CodeRegistrationDestination: Equatable {
    case home
    case sharedPass
}

struct ReceivedNoteRefreshState: Equatable {
    var notes: [ReceivedNote]
    var unavailableAudioNoteIDs: Set<String>
    var revealedNoteIDs: Set<String>
    var playingNoteID: String?
}

@MainActor
final class SocialFeatureViewModel: ObservableObject {
    @Published var familyGroup: FamilyGroupCurrentResponse?
    @Published var familyVoices: [FamilyVoiceProfile] = []
    @Published var receivedNotes: [ReceivedNote] = []
    @Published var character: CharacterResponse?
    @Published var subscription: BillingSubscriptionResponse?
    @Published var vouchers: [VoucherItem] = []
    @Published var selectedReceiverID: String?
    @Published var inviteCode = ""
    @Published var noteText = "오늘도 좋은 아침이에요. 잘 일어나길 바라요."
    @Published var isBusy = false
    @Published var statusMessage: String?
    @Published var loadingNoteID: String?
    @Published var playingNoteID: String?
    @Published var unavailableAudioNoteIDs: Set<String> = []
    @Published var revealedNoteIDs: Set<String> = []

    private let api: VoiceAlarmAPI
    private let accessSnapshotStore: AccessSnapshotStore
    private let notePreviewPlayer = AudioPreviewPlayer()
    private var activeUserID: String?

    init(
        api: VoiceAlarmAPI = .shared,
        accessSnapshotStore: AccessSnapshotStore = AccessSnapshotStore()
    ) {
        self.api = api
        self.accessSnapshotStore = accessSnapshotStore
        notePreviewPlayer.onFinish = { [weak self] in
            self?.playingNoteID = nil
        }
    }

    var selectableMembers: [FamilyGroupMember] {
        familyGroup?.members ?? []
    }

    var unreadNoteCount: Int {
        receivedNotes.filter { $0.readAt == nil }.count
    }

    func restoreAccessSnapshot(session: AuthSession?) {
        guard let userID = normalizedUserID(session?.user.id) else {
            clearUserScopedRemoteState()
            return
        }
        let snapshot = accessSnapshotStore.read(userID: userID)
        clearUserScopedRemoteState()
        activeUserID = userID
        subscription = snapshot.subscriptionResponse
        familyGroup = snapshot.familyGroup
    }

    func clearUserScopedRemoteState() {
        activeUserID = nil
        notePreviewPlayer.stop()
        familyGroup = nil
        familyVoices = []
        receivedNotes = []
        character = nil
        subscription = nil
        vouchers = []
        selectedReceiverID = nil
        inviteCode = ""
        statusMessage = nil
        loadingNoteID = nil
        playingNoteID = nil
        unavailableAudioNoteIDs = []
        revealedNoteIDs = []
    }

    func refreshAll(session: AuthSession?, force: Bool = false) async {
        guard let token = session?.token,
              let userID = normalizedUserID(session?.user.id) else {
            clearUserScopedRemoteState()
            return
        }
        activeUserID = userID
        guard force || !isBusy else { return }
        let shouldSetBusy = !isBusy
        if shouldSetBusy { isBusy = true }
        defer {
            if shouldSetBusy { isBusy = false }
        }

        var messages: [String] = []

        do {
            let nextFamilyGroup = try await api.getFamilyGroup(token: token)
            guard activeUserID == userID else { return }
            familyGroup = nextFamilyGroup
            accessSnapshotStore.updateFamilyGroup(userID: userID, response: nextFamilyGroup)
            selectedReceiverID = Self.normalizedMessageReceiverID(
                selected: selectedReceiverID,
                members: nextFamilyGroup.members,
                currentUserID: userID,
                currentUserEmail: session?.user.email ?? ""
            )
        } catch {
            messages.append(Self.scopedRefreshErrorMessage(
                label: "가족 그룹",
                error: error,
                fallback: "공유 이용권 정보를 불러오지 못했어요"
            ))
        }

        do {
            let nextFamilyVoices = try await api.listFamilyVoiceProfiles(token: token)
            guard activeUserID == userID else { return }
            familyVoices = nextFamilyVoices
        } catch {
            messages.append(Self.scopedRefreshErrorMessage(
                label: "가족 목소리",
                error: error,
                fallback: "목소리를 불러오지 못했어요"
            ))
        }

        do {
            let nextReceivedNotes = try await api.listReceivedNotes(token: token)
            guard activeUserID == userID else { return }
            await SocialNotificationTracker.notifyNewNotes(notes: nextReceivedNotes, userID: userID)
            applyReceivedNotes(nextReceivedNotes)
        } catch {
            messages.append(Self.scopedRefreshErrorMessage(
                label: "메시지",
                error: error,
                fallback: "음성 메시지를 불러오지 못했어요"
            ))
        }

        do {
            let nextCharacter = try await api.getCharacter(token: token)
            guard activeUserID == userID else { return }
            character = nextCharacter
        } catch {
            messages.append(Self.scopedRefreshErrorMessage(
                label: "캐릭터",
                error: error,
                fallback: "성장 정보를 불러오지 못했어요"
            ))
        }

        do {
            async let nextSubscription = api.getSubscription(token: token)
            async let nextVouchers = api.listVouchers(token: token)
            let resolvedSubscription = try await nextSubscription
            let resolvedVouchers = try await nextVouchers
            guard activeUserID == userID else { return }
            subscription = resolvedSubscription
            accessSnapshotStore.updateSubscription(userID: userID, response: resolvedSubscription)
            vouchers = resolvedVouchers
        } catch {
            messages.append(Self.scopedRefreshErrorMessage(
                label: "이용권",
                error: error,
                fallback: "공유 코드 정보를 불러오지 못했어요"
            ))
        }

        guard activeUserID == userID else { return }
        statusMessage = messages.isEmpty ? "소셜/이용권 정보를 불러왔어요." : messages.joined(separator: "\n")
    }

    func refreshNotesSilently(session: AuthSession?) async {
        guard let token = session?.token,
              let userID = normalizedUserID(session?.user.id) else {
            return
        }
        activeUserID = userID
        do {
            let nextReceivedNotes = try await api.listReceivedNotes(token: token)
            guard activeUserID == userID else { return }
            await SocialNotificationTracker.notifyNewNotes(notes: nextReceivedNotes, userID: userID)
            applyReceivedNotes(nextReceivedNotes)
        } catch {
            // Android `refreshNotesSilently()` keeps background/message refresh failures quiet.
        }
    }

    private func refreshAllAfterMutation(session: AuthSession?, successMessage: String) async {
        await refreshAll(session: session, force: true)
        statusMessage = successMessage
    }

    private func applyReceivedNotes(_ notes: [ReceivedNote]) {
        let state = Self.receivedNoteRefreshState(
            notes: notes,
            unavailableAudioNoteIDs: unavailableAudioNoteIDs,
            revealedNoteIDs: revealedNoteIDs,
            playingNoteID: playingNoteID
        )
        receivedNotes = state.notes
        unavailableAudioNoteIDs = state.unavailableAudioNoteIDs
        revealedNoteIDs = state.revealedNoteIDs
        if playingNoteID != nil, state.playingNoteID == nil {
            notePreviewPlayer.stop()
        }
        playingNoteID = state.playingNoteID
    }

    static func receivedNoteRefreshState(
        notes: [ReceivedNote],
        unavailableAudioNoteIDs: Set<String>,
        revealedNoteIDs: Set<String>,
        playingNoteID: String?
    ) -> ReceivedNoteRefreshState {
        let serverUnavailableAudioIDs = Set(notes.compactMap { note in
            note.audioUrl != nil && note.audioAvailable == false ? note.id : nil
        })
        let playableAudioIDs = Set(notes.compactMap { note in
            note.audioUrl != nil && note.audioAvailable != false ? note.id : nil
        })
        let activeIDs = Set(notes.map(\.id))
        return ReceivedNoteRefreshState(
            notes: notes,
            unavailableAudioNoteIDs: unavailableAudioNoteIDs.intersection(serverUnavailableAudioIDs),
            revealedNoteIDs: revealedNoteIDs.intersection(activeIDs),
            playingNoteID: playingNoteID.flatMap { playableAudioIDs.contains($0) ? $0 : nil }
        )
    }

    private func normalizedUserID(_ userID: String?) -> String? {
        let normalized = userID?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return normalized.isEmpty ? nil : normalized
    }

    static func normalizedMessageReceiverID(
        selected: String?,
        members: [FamilyGroupMember],
        currentUserID: String,
        currentUserEmail: String
    ) -> String? {
        let currentID = currentUserID.trimmingCharacters(in: .whitespacesAndNewlines)
        let currentEmail = currentUserEmail.trimmingCharacters(in: .whitespacesAndNewlines)
        let recipientIDs = members.compactMap { member -> String? in
            let memberID = member.userId.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !memberID.isEmpty, memberID != currentID else { return nil }
            let memberEmail = member.email?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if !currentEmail.isEmpty && memberEmail == currentEmail {
                return nil
            }
            return memberID
        }
        let selectedID = selected?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !selectedID.isEmpty, recipientIDs.contains(selectedID) {
            return selectedID
        }
        return recipientIDs.first
    }

    func registerCode(_ codeOverride: String? = nil, session: AuthSession?) async -> CodeRegistrationDestination? {
        guard let token = session?.token else {
            statusMessage = "로그인이 필요해요."
            return nil
        }
        let code = (codeOverride ?? inviteCode).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !code.isEmpty else {
            statusMessage = "코드를 입력해 주세요."
            return nil
        }
        guard !isBusy else { return nil }
        isBusy = true
        defer { isBusy = false }

        do {
            let response = try await api.registerCode(code, token: token)
            if codeOverride == nil || inviteCode.trimmingCharacters(in: .whitespacesAndNewlines) == code {
                inviteCode = ""
            }
            await refreshAllAfterMutation(session: session, successMessage: "코드를 등록했어요.")
            return Self.codeRegistrationDestination(responseType: response.type, code: code)
        } catch {
            statusMessage = Self.userFacingErrorMessage(error, fallback: "코드 등록에 실패했어요.")
            return nil
        }
    }

    func sendNote(session: AuthSession?) async {
        guard let token = session?.token else {
            statusMessage = "로그인이 필요해요."
            return
        }
        let normalizedReceiverID = selectedReceiverID?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !normalizedReceiverID.isEmpty else {
            statusMessage = "메시지를 받을 가족 멤버를 선택해 주세요."
            return
        }
        let text = noteText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            statusMessage = "메시지 내용을 입력해 주세요."
            return
        }
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }

        do {
            _ = try await api.sendNote(receiverId: normalizedReceiverID, text: text, token: token)
            noteText = ""
            await refreshAllAfterMutation(session: session, successMessage: "메시지를 보냈어요.")
        } catch {
            statusMessage = Self.userFacingErrorMessage(error, fallback: "메시지 전송에 실패했어요")
        }
    }

    func markRead(_ note: ReceivedNote, session: AuthSession?) async {
        guard let token = session?.token else { return }
        do {
            _ = try await api.markNoteRead(id: note.id, token: token)
            await refreshAll(session: session, force: true)
        } catch {
            statusMessage = Self.userFacingErrorMessage(error, fallback: "메시지를 읽음 처리하지 못했어요")
        }
    }

    func hasPlayableAudio(_ note: ReceivedNote) -> Bool {
        note.audioUrl != nil &&
            note.audioAvailable != false &&
            !unavailableAudioNoteIDs.contains(note.id)
    }

    func shouldRevealText(_ note: ReceivedNote) -> Bool {
        !hasPlayableAudio(note) || note.readAt != nil || revealedNoteIDs.contains(note.id)
    }

    func playNoteAudio(_ note: ReceivedNote, session: AuthSession?) async {
        guard let token = session?.token else {
            statusMessage = "로그인이 필요해요."
            return
        }
        if playingNoteID == note.id {
            notePreviewPlayer.stop()
            playingNoteID = nil
            return
        }
        guard hasPlayableAudio(note) else { return }
        guard loadingNoteID == nil else { return }

        loadingNoteID = note.id
        defer { loadingNoteID = nil }

        do {
            let response = try await api.getNoteAudio(id: note.id, token: token)
            let url = try cacheNoteAudio(response)
            try notePreviewPlayer.play(url: url)
            playingNoteID = note.id
            revealedNoteIDs.insert(note.id)
            _ = try? await api.markNoteRead(id: note.id, token: token)
            await refreshAll(session: session, force: true)
        } catch {
            if isMissingNoteAudio(error) {
                unavailableAudioNoteIDs.insert(note.id)
            }
            statusMessage = Self.userFacingErrorMessage(error, fallback: "음성 메시지를 재생하지 못했어요")
        }
    }

    private func cacheNoteAudio(_ response: NoteAudioResponse) throws -> URL {
        guard let data = Data(base64Encoded: response.audioBase64) else {
            throw AudioCacheError.invalidBase64
        }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("note-audio", isDirectory: true)
        if !FileManager.default.fileExists(atPath: directory.path) {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        }
        let ext: String
        switch response.audioFormat.lowercased() {
        case "wav":
            ext = "wav"
        case "m4a", "aac", "mp4":
            ext = "m4a"
        default:
            ext = "mp3"
        }
        let url = directory.appendingPathComponent("\(response.noteId).\(ext)")
        try data.write(to: url, options: [.atomic])
        return url
    }

    private func isMissingNoteAudio(_ error: Error) -> Bool {
        let text = String(describing: error)
        return text.contains("NOTE_AUDIO_MISSING") || text.contains("NOTE_AUDIO_NOT_FOUND")
    }

    func ensureFamilyShareCode(session: AuthSession?) async {
        guard let token = session?.token else {
            statusMessage = "로그인이 필요해요."
            return
        }
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }

        do {
            let planLabel = Self.shareCodePlanLabel(subscription)
            let voucher = try await api.ensureFamilyShareCode(token: token)
            vouchers = Self.upsertingVoucher(voucher, into: vouchers)
            await refreshAllAfterMutation(
                session: session,
                successMessage: "\(planLabel) 공유 코드를 준비했어요."
            )
        } catch {
            let planLabel = Self.shareCodePlanLabel(subscription)
            statusMessage = Self.billingErrorMessage(
                error,
                fallback: "\(planLabel) 공유 코드를 불러오지 못했어요"
            )
        }
    }

    /// **Phase 4-D1 이후 deprecated** — App Store 심사 통과를 위해 일반 사용자
    /// 구독 결제는 `SubscriptionManager.purchase(_:)` 가 권위. 본 메서드는 비-IAP
    /// gift voucher 발급 등 백엔드 stub 흐름에만 사용해야 하며, BillingPanel UI 의
    /// 카드 "선택" 버튼은 본 메서드를 호출하지 않는다.
    ///
    /// 본 메서드는 호환성 유지를 위해 남겨두며, 향후 dead code 정리 시 제거 가능.
    @available(*, deprecated, message: "Apple IAP 로 통합. SubscriptionManager.purchase 사용.")
    func checkout(planKey: String, gift: Bool = false, session: AuthSession?) async {
        guard let token = session?.token else {
            statusMessage = "로그인이 필요해요."
            return
        }
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }

        do {
            // deprecated 호출이라 Swift 가 경고를 띄우지만, 본 메서드 자체가 deprecated
            // 라 호출은 정당하다. 메서드 단위 silence.
            #if compiler(>=5.6)
            _ = try await callDeprecatedCheckout(planKey: planKey, gift: gift, token: token)
            #else
            _ = try await api.checkoutPlan(planKey: planKey, gift: gift, token: token)
            #endif
            await refreshAllAfterMutation(session: session, successMessage: "이용권 상태를 갱신했어요.")
        } catch {
            let fallback = gift ? "선물하기에 실패했어요" : "이용권 적용에 실패했어요"
            statusMessage = Self.billingErrorMessage(error, fallback: fallback)
        }
    }

    /// `api.checkoutPlan` 의 deprecation 경고를 메서드 경계에 격리.
    /// 본 helper 만 silence 하면 호출 사이트가 깨끗하다.
    @available(*, deprecated)
    private func callDeprecatedCheckout(planKey: String, gift: Bool, token: String) async throws -> CheckoutResponse {
        try await api.checkoutPlan(planKey: planKey, gift: gift, token: token)
    }

    func cancelSubscription(mode: String = "at_period_end", session: AuthSession?) async {
        guard let token = session?.token else {
            statusMessage = "로그인이 필요해요."
            return
        }
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }

        do {
            let normalizedMode = Self.normalizedCancellationMode(mode)
            _ = try await api.cancelSubscription(mode: normalizedMode, token: token)
            let successMessage = normalizedMode == "immediate" ? "이용권을 해지했어요." : "구독 해지를 예약했어요."
            await refreshAllAfterMutation(session: session, successMessage: successMessage)
        } catch {
            statusMessage = Self.billingErrorMessage(error, fallback: "해지에 실패했어요")
        }
    }

    static func normalizedCancellationMode(_ mode: String) -> String {
        let normalized = mode.trimmingCharacters(in: .whitespacesAndNewlines)
        if normalized == "at_period_end" { return "at_period_end" }
        return "immediate"
    }

    static func shareCodePlanLabel(_ response: BillingSubscriptionResponse?) -> String {
        switch response?.plan?.key {
        case "couple":
            return "커플"
        case "family":
            return "가족"
        default:
            switch response?.plan?.planType {
            case "couple":
                return "커플"
            case "family":
                return "가족"
            default:
                return "공유"
            }
        }
    }

    static func upsertingVoucher(_ voucher: VoucherItem, into vouchers: [VoucherItem]) -> [VoucherItem] {
        [voucher] + vouchers.filter { $0.id != voucher.id }
    }

    static func codeRegistrationDestination(responseType: String?, code: String) -> CodeRegistrationDestination {
        let normalizedType = responseType?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let normalizedCode = code.trimmingCharacters(in: .whitespacesAndNewlines)
        if normalizedType == "invite" || normalizedCode.range(of: "INV-", options: [.anchored, .caseInsensitive]) != nil {
            return .sharedPass
        }
        return .home
    }

    static func billingErrorMessage(_ error: Error, fallback: String) -> String {
        billingFailureMessage(
            errorCode: extractServerErrorCode(from: error),
            fallback: userFacingErrorMessage(error, fallback: fallback)
        )
    }

    static func billingFailureMessage(errorCode: String?, fallback: String) -> String {
        switch errorCode {
        case "SAME_PLAN":
            return "이미 사용 중인 이용권이에요"
        case "NO_ACTIVE_SUBSCRIPTION":
            return "현재 적용된 이용권이 없어 새 이용권으로 적용할게요"
        case "PLAN_NOT_FOUND":
            return "이용권 정보를 찾지 못했어요"
        case "PLAN_INACTIVE":
            return "지금은 선택할 수 없는 이용권이에요"
        case "FREE_NOT_BILLABLE":
            return "무료 이용권은 여기에서 적용할 수 없어요"
        case "GIFT_PERSONAL_ONLY":
            return "선물하기는 개인 이용권에서만 사용할 수 있어요"
        case "USER_NOT_FOUND":
            return "로그인 정보를 다시 확인해 주세요"
        default:
            return fallback
        }
    }

    static func userFacingErrorMessage(_ error: Error, fallback: String) -> String {
        guard let apiError = error as? APIError else {
            let message = error.localizedDescription
            return message.containsKorean ? message : fallback
        }
        switch apiError {
        case .invalidResponse:
            return fallback
        case .server(_, let message, _):
            return message.containsKorean ? message : fallback
        }
    }

    static func scopedRefreshErrorMessage(label: String, error: Error, fallback: String) -> String {
        "\(label): \(userFacingErrorMessage(error, fallback: fallback))"
    }

    private static func extractServerErrorCode(from error: Error) -> String? {
        if let apiError = error as? APIError, let code = apiError.serverErrorCode {
            return code
        }
        guard let apiError = error as? APIError,
              case .server(_, let message, _) = apiError else {
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
        for code in knownBillingErrorCodes where message.contains(code) {
            return code
        }
        return nil
    }

    private static let knownBillingErrorCodes = [
        "SAME_PLAN",
        "NO_ACTIVE_SUBSCRIPTION",
        "PLAN_NOT_FOUND",
        "PLAN_INACTIVE",
        "FREE_NOT_BILLABLE",
        "GIFT_PERSONAL_ONLY",
        "USER_NOT_FOUND"
    ]

    // MARK: - Phase 3-C3: 멤버 액션, family alarm, 바우처 redeem, plan downgrade cascade

    /// 내가 가족/커플 그룹에서 나간다. Android `MainViewModelSocialActions.leaveFamilyGroup` 와 동등.
    func leaveFamilyGroup(groupId: String, session: AuthSession?) async {
        guard let token = session?.token else {
            statusMessage = "로그인이 필요해요."
            return
        }
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }

        do {
            _ = try await api.leaveFamilyGroup(groupId: groupId, token: token)
            await refreshAllAfterMutation(
                session: session,
                successMessage: "이용권에서 나갔어요. 무료 이용권으로 전환됐어요."
            )
        } catch {
            statusMessage = Self.userFacingErrorMessage(error, fallback: "이용권에서 나가지 못했어요")
        }
    }

    /// 소유자가 다른 멤버를 내보낸다. MemberManagementView 에서 alert 확인 후 호출.
    func removeMember(groupId: String, userId: String, session: AuthSession?) async {
        guard let token = session?.token else {
            statusMessage = "로그인이 필요해요."
            return
        }
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }

        do {
            _ = try await api.removeFamilyMember(groupId: groupId, userId: userId, token: token)
            await refreshAllAfterMutation(session: session, successMessage: "멤버를 내보냈어요.")
        } catch {
            statusMessage = Self.userFacingErrorMessage(error, fallback: "멤버를 내보내지 못했어요")
        }
    }

    /// 소유권 이양. 본인은 일반 멤버로 강등됨.
    func transferOwnership(groupId: String, newOwnerId: String, session: AuthSession?) async {
        guard let token = session?.token else {
            statusMessage = "로그인이 필요해요."
            return
        }
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }

        do {
            _ = try await api.transferFamilyOwnership(groupId: groupId, newOwnerId: newOwnerId, token: token)
            await refreshAllAfterMutation(session: session, successMessage: "소유권을 이양했어요.")
        } catch {
            statusMessage = Self.userFacingErrorMessage(error, fallback: "소유권을 이양하지 못했어요")
        }
    }

    /// 음성 노트(TTS 메시지) 보내기. Android
    /// `MainViewModelGrowthBillingActions.kt:275` `sendTtsNote` 와 동등.
    ///
    /// 1) `TtsGenerateRequest` 로 음원을 만들고
    /// 2) 그 결과 URL 또는 messageId 와 함께 `sendNote` 호출.
    /// 실패 시 statusMessage 에 사유 전달.
    func sendTtsNote(
        recipientId: String,
        voiceProfileId: String,
        text: String,
        session: AuthSession?
    ) async {
        guard let token = session?.token else {
            statusMessage = "로그인이 필요해요."
            return
        }
        let normalizedRecipientID = recipientId.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedVoiceProfileID = voiceProfileId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedRecipientID.isEmpty else {
            statusMessage = "메시지를 받을 가족 멤버를 선택해 주세요."
            return
        }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            statusMessage = "메시지 내용을 입력해 주세요."
            return
        }
        guard trimmed.count <= 200 else {
            statusMessage = "음성 메시지는 200자까지 보낼 수 있어요."
            return
        }
        guard !normalizedVoiceProfileID.isEmpty else {
            statusMessage = "목소리를 선택해 주세요."
            return
        }
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }

        do {
            let tts = try await api.generateTTS(
                    TtsGenerateRequest(
                        voiceProfileId: normalizedVoiceProfileID,
                        text: trimmed,
                        category: "custom",
                        language: "ko",
                        translate: false,
                        random: false
                ),
                token: token
            )
            guard let remoteAudioURI = tts.remoteAudioURI else {
                statusMessage = "생성된 음성 파일을 저장하지 못했어요."
                return
            }
            _ = try await api.sendNote(
                receiverId: normalizedRecipientID,
                text: trimmed,
                audioUrl: remoteAudioURI,
                token: token
            )
            await refreshAllAfterMutation(session: session, successMessage: "음성 메시지를 보냈어요.")
        } catch {
            statusMessage = Self.userFacingErrorMessage(error, fallback: "음성 메시지 전송에 실패했어요")
        }
    }

    /// Android `MainViewModelGrowthBillingActions.applyFreePlanVoiceLock` equivalent.
    /// When paid voice access is gone, remove local voice alarms and clear paid voice state.
    @discardableResult
    func applyFreePlanVoiceLock(
        alarmStore: LocalAlarmStore,
        alarmKit: AlarmKitViewModel,
        voiceStudio: VoiceStudioViewModel
    ) async -> Int {
        let targets = alarmStore.paidVoiceAlarms()
        for record in targets {
            await alarmKit.cancel(record: record, store: alarmStore)
        }

        voiceStudio.clearPaidVoiceState()
        clearPaidVoiceState(deletedAlarmCount: targets.count)
        return targets.count
    }

    func clearPaidVoiceState(deletedAlarmCount: Int = 0) {
        notePreviewPlayer.stop()
        familyVoices = []
        receivedNotes = []
        selectedReceiverID = nil
        loadingNoteID = nil
        playingNoteID = nil
        unavailableAudioNoteIDs = []
        revealedNoteIDs = []
        if deletedAlarmCount > 0 {
            statusMessage = "무료 이용권으로 전환되어 목소리 알람을 삭제했어요."
        }
    }

    /// 일반 코드(=plan voucher) 사용. Android `BillingApi.redeem`.
    /// 가족 초대 코드(INV-) 는 `registerCode` 로 처리해야 한다.
    func redeemVoucher(code: String, session: AuthSession?) async {
        guard let token = session?.token else {
            statusMessage = "로그인이 필요해요."
            return
        }
        let trimmed = code.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            statusMessage = "코드를 입력해 주세요."
            return
        }
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }

        do {
            _ = try await api.redeemVoucher(code: trimmed, token: token)
            await refreshAllAfterMutation(session: session, successMessage: "코드를 적용했어요.")
        } catch {
            statusMessage = Self.billingErrorMessage(error, fallback: "코드 적용에 실패했어요")
        }
    }

    func grantWakeupXP(session: AuthSession?) async {
        guard let token = session?.token else { return }
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }

        do {
            let response = try await api.grantCharacterXP(event: "wake_success", token: token)
            character = CharacterResponse(
                character: response.character,
                progress: response.progress,
                streak: response.streak,
                stats: response.stats,
                achievements: response.achievements
            )
            statusMessage = "캐릭터 경험치를 반영했어요."
        } catch {
            statusMessage = Self.userFacingErrorMessage(error, fallback: "성장 기록을 반영하지 못했어요")
        }
    }
}

private extension String {
    var containsKorean: Bool {
        contains { character in
            character.unicodeScalars.contains { scalar in
                (0xAC00...0xD7A3).contains(Int(scalar.value))
            }
        }
    }
}
