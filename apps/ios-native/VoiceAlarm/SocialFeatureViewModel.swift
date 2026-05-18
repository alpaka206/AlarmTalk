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

    private let api: VoiceAlarmAPI

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

    func checkout(planKey: String, gift: Bool = false, session: AuthSession?) async {
        guard let token = session?.token else {
            statusMessage = "로그인이 필요해요."
            return
        }
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }

        do {
            _ = try await api.checkoutPlan(planKey: planKey, gift: gift, token: token)
            statusMessage = "이용권 상태를 갱신했어요."
            await refreshAll(session: session)
        } catch {
            statusMessage = error.localizedDescription
        }
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
