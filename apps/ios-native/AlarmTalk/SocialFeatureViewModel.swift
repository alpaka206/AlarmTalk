import Foundation

enum CodeRegistrationDestination: Equatable {
    case home
    case sharedPass
}

@MainActor
final class SocialFeatureViewModel: ObservableObject {
    @Published var familyGroup: FamilyGroupCurrentResponse?
    @Published var familyVoices: [FamilyVoiceProfile] = []
    @Published var subscription: BillingSubscriptionResponse?
    @Published var vouchers: [VoucherItem] = []
    @Published var inviteCode = ""
    @Published var isBusy = false
    @Published var statusMessage: String?

    private let api: AlarmTalkAPI
    private let accessSnapshotStore: AccessSnapshotStore
    private var activeUserID: String?

    init(
        api: AlarmTalkAPI = .shared,
        accessSnapshotStore: AccessSnapshotStore = AccessSnapshotStore()
    ) {
        self.api = api
        self.accessSnapshotStore = accessSnapshotStore
    }

    var selectableMembers: [FamilyGroupMember] {
        familyGroup?.members ?? []
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
        familyGroup = nil
        familyVoices = []
        subscription = nil
        vouchers = []
        inviteCode = ""
        statusMessage = nil
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
        // Android 의 social refresh 는 실패 시에만 메시지를 노출한다(스낵바). 성공 토스트는 없음.
        statusMessage = messages.isEmpty ? nil : messages.joined(separator: "\n")
    }

    /// 구독 정보만 조용히 재조회. Apple IAP confirm 이 `success: true` 로 끝난 직후
    /// `SubscriptionManager.onServerEntitlementUpdated` 훅이 호출한다.
    /// 기존 `refreshAll` 의 구독 fetch 경로(`GET /api/billing/subscription`) 를
    /// 그대로 재사용하며, 실패는 조용히 무시 — 다음 refreshAll 에서 catch-up 된다.
    func refreshSubscriptionSilently(session: AuthSession?) async {
        guard let token = session?.token,
              let userID = normalizedUserID(session?.user.id) else {
            return
        }
        activeUserID = userID
        do {
            let nextSubscription = try await api.getSubscription(token: token)
            guard activeUserID == userID else { return }
            subscription = nextSubscription
            accessSnapshotStore.updateSubscription(userID: userID, response: nextSubscription)
        } catch {
            // 백그라운드 새로고침 실패는 사용자에게 노출하지 않는다.
        }
    }

    private func refreshAllAfterMutation(session: AuthSession?, successMessage: String) async {
        await refreshAll(session: session, force: true)
        statusMessage = successMessage
    }

    private func normalizedUserID(_ userID: String?) -> String? {
        let normalized = userID?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return normalized.isEmpty ? nil : normalized
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
            statusMessage = userFacingErrorMessage(error, fallback: "코드 등록에 실패했어요.")
            return nil
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

    /// 유출/소진된 공유 코드를 무효화(expired)하고 새 코드를 발급. Android
    /// `MainViewModelGrowthBillingActions.regenerateFamilyShareCode` 와 동등.
    /// 소유자 전용 보안 액션으로 MemberManagementView 에서 확인 후 호출한다.
    func regenerateFamilyShareCode(session: AuthSession?) async {
        guard let token = session?.token else {
            statusMessage = "로그인이 필요해요."
            return
        }
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }

        do {
            let planLabel = Self.shareCodePlanLabel(subscription)
            let voucher = try await api.regenerateFamilyShareCode(token: token)
            vouchers = Self.upsertingVoucher(voucher, into: vouchers)
            await refreshAllAfterMutation(
                session: session,
                successMessage: "\(planLabel) 공유 코드를 새로 발급했어요. 기존 코드는 더 이상 쓸 수 없어요."
            )
        } catch {
            let planLabel = Self.shareCodePlanLabel(subscription)
            statusMessage = Self.billingErrorMessage(
                error,
                fallback: "\(planLabel) 공유 코드를 불러오지 못했어요"
            )
        }
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

    @discardableResult
    func giftPersonalPass(session: AuthSession?) async -> Bool {
        guard let token = session?.token else {
            statusMessage = "로그인이 필요해요."
            return false
        }
        guard !isBusy else { return false }
        isBusy = true
        defer { isBusy = false }

        do {
            _ = try await api.createGiftVoucher(planKey: "personal", token: token)
            await refreshAllAfterMutation(
                session: session,
                successMessage: "개인 이용권 선물 코드를 준비했어요."
            )
            return true
        } catch {
            statusMessage = Self.billingErrorMessage(error, fallback: "선물하기에 실패했어요")
            return false
        }
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
            statusMessage = userFacingErrorMessage(error, fallback: "이용권에서 나가지 못했어요")
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
            statusMessage = userFacingErrorMessage(error, fallback: "멤버를 내보내지 못했어요")
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
        let targets = alarmStore.paidAlarmTalks()
        for record in targets {
            await alarmKit.cancel(record: record, store: alarmStore)
        }

        voiceStudio.clearPaidVoiceState()
        clearPaidVoiceState(deletedAlarmCount: targets.count)
        return targets.count
    }

    func clearPaidVoiceState(deletedAlarmCount: Int = 0) {
        familyVoices = []
        if deletedAlarmCount > 0 {
            statusMessage = "무료 이용권으로 전환되어 목소리 알람을 삭제했어요."
        }
    }
}

