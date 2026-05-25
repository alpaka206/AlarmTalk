import Foundation

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
    private let notePreviewPlayer = AudioPreviewPlayer()

    init(api: VoiceAlarmAPI = .shared) {
        self.api = api
    }

    var selectableMembers: [FamilyGroupMember] {
        familyGroup?.members ?? []
    }

    var unreadNoteCount: Int {
        receivedNotes.filter { $0.readAt == nil }.count
    }

    func refreshAll(session: AuthSession?) async {
        guard let token = session?.token else { return }
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }

        var messages: [String] = []

        do {
            familyGroup = try await api.getFamilyGroup(token: token)
            let currentUserID = session?.user.id
            if selectedReceiverID == nil {
                selectedReceiverID = familyGroup?.members.first { $0.userId != currentUserID }?.userId
            }
        } catch {
            messages.append("가족 그룹: \(error.localizedDescription)")
        }

        do {
            familyVoices = try await api.listFamilyVoiceProfiles(token: token)
        } catch {
            messages.append("가족 목소리: \(error.localizedDescription)")
        }

        do {
            receivedNotes = try await api.listReceivedNotes(token: token)
            let activeIDs = Set(receivedNotes.map(\.id))
            unavailableAudioNoteIDs = unavailableAudioNoteIDs.intersection(activeIDs)
            revealedNoteIDs = revealedNoteIDs.intersection(activeIDs)
        } catch {
            messages.append("메시지: \(error.localizedDescription)")
        }

        do {
            character = try await api.getCharacter(token: token)
        } catch {
            messages.append("캐릭터: \(error.localizedDescription)")
        }

        do {
            async let nextSubscription = api.getSubscription(token: token)
            async let nextVouchers = api.listVouchers(token: token)
            subscription = try await nextSubscription
            vouchers = try await nextVouchers
        } catch {
            messages.append("이용권: \(error.localizedDescription)")
        }

        statusMessage = messages.isEmpty ? "소셜/이용권 정보를 불러왔어요." : messages.joined(separator: "\n")
    }

    func registerCode(session: AuthSession?) async {
        guard let token = session?.token else {
            statusMessage = "로그인이 필요해요."
            return
        }
        let code = inviteCode.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !code.isEmpty else {
            statusMessage = "코드를 입력해 주세요."
            return
        }
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }

        do {
            _ = try await api.registerCode(code, token: token)
            inviteCode = ""
            statusMessage = "코드를 등록했어요."
            await refreshAll(session: session)
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    func sendNote(session: AuthSession?) async {
        guard let token = session?.token else {
            statusMessage = "로그인이 필요해요."
            return
        }
        guard let receiverID = selectedReceiverID else {
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
            _ = try await api.sendNote(receiverId: receiverID, text: text, token: token)
            noteText = ""
            statusMessage = "메시지를 보냈어요."
            await refreshAll(session: session)
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    func markRead(_ note: ReceivedNote, session: AuthSession?) async {
        guard let token = session?.token else { return }
        do {
            _ = try await api.markNoteRead(id: note.id, token: token)
            await refreshAll(session: session)
        } catch {
            statusMessage = error.localizedDescription
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
            await refreshAll(session: session)
        } catch {
            if isMissingNoteAudio(error) {
                unavailableAudioNoteIDs.insert(note.id)
            }
            statusMessage = error.localizedDescription
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
            let voucher = try await api.ensureFamilyShareCode(token: token)
            if !vouchers.contains(where: { $0.id == voucher.id }) {
                vouchers.insert(voucher, at: 0)
            }
            statusMessage = "가족 공유 코드를 준비했어요."
        } catch {
            statusMessage = error.localizedDescription
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
            statusMessage = "이용권 상태를 갱신했어요."
            await refreshAll(session: session)
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    /// `api.checkoutPlan` 의 deprecation 경고를 메서드 경계에 격리.
    /// 본 helper 만 silence 하면 호출 사이트가 깨끗하다.
    @available(*, deprecated)
    private func callDeprecatedCheckout(planKey: String, gift: Bool, token: String) async throws -> CheckoutResponse {
        try await api.checkoutPlan(planKey: planKey, gift: gift, token: token)
    }

    func cancelSubscription(session: AuthSession?) async {
        guard let token = session?.token else {
            statusMessage = "로그인이 필요해요."
            return
        }
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }

        do {
            _ = try await api.cancelSubscription(mode: "at_period_end", token: token)
            statusMessage = "구독 해지를 예약했어요."
            await refreshAll(session: session)
        } catch {
            statusMessage = error.localizedDescription
        }
    }

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
            statusMessage = "그룹에서 나왔어요."
            await refreshAll(session: session)
        } catch {
            statusMessage = error.localizedDescription
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
            statusMessage = "멤버를 내보냈어요."
            await refreshAll(session: session)
        } catch {
            statusMessage = error.localizedDescription
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
            statusMessage = "소유권을 이양했어요."
            await refreshAll(session: session)
        } catch {
            statusMessage = error.localizedDescription
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
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            statusMessage = "메시지 내용을 입력해 주세요."
            return
        }
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }

        do {
            let tts = try await api.generateTTS(
                TtsGenerateRequest(
                    voiceProfileId: voiceProfileId,
                    text: trimmed,
                    category: "note",
                    language: "ko",
                    translate: false,
                    random: false
                ),
                token: token
            )
            _ = try await api.sendNote(
                receiverId: recipientId,
                text: trimmed,
                audioUrl: tts.audioUrl,
                token: token
            )
            statusMessage = "음성 메시지를 보냈어요."
            await refreshAll(session: session)
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    /// Free 플랜 다운그레이드 시 paid 자산들을 잠그는 cascade 트리거.
    ///
    /// Android `MainViewModelGrowthBillingActions.applyFreePlanVoiceLock` 와 동등.
    /// 백엔드가 한 endpoint 로 처리 (소유한 voice profile / family share 등을
    /// free 사용자가 사용 불가 상태로 마킹) 한다. 현재 단계에서는 별도 dedicated
    /// endpoint 없이 `redeemVoucher` 또는 `changePlan` 흐름이 호출하므로, 여기서
    /// 는 SwiftUI 클라이언트가 다운그레이드 직후 `refreshAll` 만 다시 돌려 최신
    /// 상태로 화면을 동기화한다.
    func applyFreePlanVoiceLock(session: AuthSession?) async {
        await refreshAll(session: session)
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
            statusMessage = "코드를 적용했어요."
            await refreshAll(session: session)
        } catch {
            statusMessage = error.localizedDescription
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
            statusMessage = error.localizedDescription
        }
    }
}
