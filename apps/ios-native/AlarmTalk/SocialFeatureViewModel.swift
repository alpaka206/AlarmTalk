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
    /// **사용자가 시작한 쓰기**(코드 등록·그룹 나가기·내보내기·해지…) 전용.
    /// 화면이 이 값으로 버튼을 잠근다.
    @Published var isBusy = false

    /// **자동 새로고침 전용**(화면 진입·전경 복귀·푸시). 버튼을 잠그지 않는다.
    ///
    /// ⚠ **`isBusy` 하나로 되돌리지 말 것.** 예전에는 읽기 새로고침도 `isBusy` 를 올렸고,
    /// 쓰기 액션은 전부 `guard !isBusy else { return }` 로 **조용히** 물러섰다. 그래서
    /// 패널에 들어가자마자 누른 버튼이 아무 일도 안 하는 것처럼 보였다(2026-08-10 사용자
    /// 보고 "버튼 눌렀는데 바로바로 작동 안 될 때가 있다"). 특히 확인 알럿의 버튼은
    /// `.disabled` 로 막을 수 없어 **알럿만 닫히고 끝났다.**
    /// 안드로이드가 같은 문제를 먼저 겪고 갈라 두었다 —
    /// `ui/main/MainViewModelBillingActions.kt` 의 `billingRefreshing` vs `billingBusy`.
    @Published private(set) var isRefreshing = false

    @Published var statusMessage: String?

    /// 해지를 App Store 에서 해야 하는가 — 서버가 `STORE_CANCEL_UNSUPPORTED` 로 거절했을 때.
    /// 이용권 화면이 이걸 보고 StoreKit 구독 관리 시트를 연다.
    @Published var needsAppStoreSubscriptionManagement = false

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
        // 읽기 전용이라 `isRefreshing` 만 본다 — 사용자의 쓰기 액션을 막지 않는다.
        guard force || !isRefreshing else { return }
        let shouldSetBusy = !isRefreshing
        if shouldSetBusy { isRefreshing = true }
        defer {
            if shouldSetBusy { isRefreshing = false }
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

    /// - Parameter successMessage: nil 이면 아무 말도 하지 않는다. 결과가 **화면에 이미
    ///   드러나는** 변경(예: 이용권에서 나가면 카드가 '무료' 로 바뀐다)은 토스트로 한 번 더
    ///   말할 이유가 없다 — 같은 말을 반복하면서 화면만 가린다.
    private func refreshAllAfterMutation(session: AuthSession?, successMessage: String?) async {
        await refreshAll(session: session, force: true)
        if let successMessage { statusMessage = successMessage }
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
            // ⚠ 서버가 영어로 주는 사유를 한국어로 옮긴다. 이걸 `userFacingErrorMessage`
            // 로 되돌리면 만료·중복·정원초과가 전부 같은 폴백 한 줄이 된다.
            statusMessage = CodeRegistrationError.message(for: error, fallback: "코드 등록에 실패했어요.")
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
            // ⚠ **App Store 구독은 서버가 못 끊는다.** Apple 에는 Play 의
            // `purchases.subscriptions.cancel` 에 해당하는 API 가 없어서, 사용자가 App Store
            // 구독 관리 화면에서 직접 끊어야 한다. 서버가 이 코드로 거절하면(무변경)
            // 여기서 그 화면으로 보낸다 — 안 보내면 "해지에 실패했어요" 만 남고 **해지할
            // 길이 앱 어디에도 없다**(심사 거절 사유이기도 하다).
            if Self.extractServerErrorCode(from: error) == "STORE_CANCEL_UNSUPPORTED" {
                needsAppStoreSubscriptionManagement = true
                statusMessage = nil
                return
            }
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

    // MARK: - 멤버 액션, family alarm, plan downgrade cascade

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
            // ⚠ **성공 문구를 다시 넣지 말 것**(2026-08-15 지시).
            // 나가면 이용권 카드가 곧바로 '무료' 로 바뀐다 — 화면이 이미 그 사실을 말한다.
            // 실패만 알린다(아래 catch) — 그건 화면에 안 나타나는 사실이다.
            await refreshAllAfterMutation(session: session, successMessage: nil)
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

    /// 무료 전환 시 목소리 알람을 **잠근다**(안드로이드 `AlarmRepository.lockPaidAlarmTalks` 미러).
    ///
    /// ⚠ **지우지 않는다.** 예전 iOS 는 `alarmKit.cancel` 로 행과 음원을 함께 **영구
    /// 삭제**했다 — 시각·반복·문구·목소리 선택이 전부 사라지고 재결제해도 돌아오지
    /// 않았다. 알람 앱에서 "내일 아침 알람이 없어졌다" 는 가장 무거운 실패다.
    /// 안드로이드는 원래 `playMode` 를 `preLockPlayMode` 에 보관하고 `alarm_only` 로
    /// 내려 **사운드온리로 계속 울린다**. 다시 유료가 되면 그대로 되살아난다.
    ///
    /// - Parameter expectedOwnerUserId: 이 계정 알람만 건드린다. 같은 기기에서 계정을
    ///   바꿨을 때 앞 계정 알람까지 잠그지 않기 위한 가드(안드로이드와 동일).
    @discardableResult
    func applyFreePlanVoiceLock(
        alarmStore: LocalAlarmStore,
        alarmKit: AlarmKitViewModel,
        voiceStudio: VoiceStudioViewModel,
        expectedOwnerUserId: String? = nil
    ) async -> Int {
        // ⚠ **반환값은 '이번에 새로 잠근 개수' 다 — 대상 개수가 아니다.**
        // 예전에는 이미 잠긴 알람까지 세서, 이 함수가 도는 **앱 시작·전경 복귀마다**
        // 같은 수를 돌려줬다. 그 값이 `DowngradeNoticeStore` 대기표에 다시 찍혀
        // **강등 모달이 매번 떴다**(2026-08-11 실기기 지적 "모달 계속 뜨네").
        // 안드로이드 `lockPaidAlarmTalks` 는 `needsLock` 일 때만 센다.
        let targets = alarmStore.paidAlarmTalks().filter { record in
            // 소유자가 안 적힌 옛 행은 이 계정 것으로 본다(안드로이드와 같은 관용).
            guard let expectedOwnerUserId, let owner = record.ownerUserId else { return true }
            return owner == expectedOwnerUserId
        }

        var locked = 0
        for record in targets {
            var updated = record
            // 이미 잠긴 알람을 다시 잠그면 원래 값을 잃는다 — 처음 한 번만 적는다.
            let needsLock = updated.preLockPlayMode == nil
            if needsLock {
                updated.preLockPlayMode = updated.playMode
            }
            updated.playMode = AlarmPlayMode.alarmOnly.rawValue
            _ = alarmStore.upsert(updated)
            // ⚠ **새로 잠근 것만 다시 예약한다.** 이미 잠긴 알람은 재생 방식이 그대로라
            // 예약을 건드릴 이유가 없다(안드로이드 `lockPaidAlarmTalks` 도 `needsLock` 일 때만 한다).
            if needsLock {
                // 사운드온리로 **다시 예약한다.** 재예약을 빠뜨리면 잠근 게 아니라
                // 조용히 안 울리는 알람이 된다.
                //
                // ⚠ **옛 핸들을 반드시 취소한다.** 예전에는 schedule 만 불러서, 유료
                // 목소리로 걸어 둔 예약이 OS 에 그대로 남았다 — 무료로 떨어진 사용자가
                // 계속 클론 목소리를 듣고 같은 시각에 알람이 둘 울렸다. 게이트가 막았다고
                // 믿는 바로 그 자리에서 샌 것이다.
                let previous = record
                if await alarmKit.schedule(record: updated, store: alarmStore),
                   previous.alarmKitID != nil {
                    await alarmKit.cancelScheduledAlarm(record: previous)
                }
                locked += 1
            }
        }

        voiceStudio.clearPaidVoiceState()
        clearPaidVoiceState(lockedAlarmCount: locked)
        return locked
    }

    /// 유료로 돌아오면 잠가 둔 재생 방식을 되돌린다
    /// (안드로이드 `AlarmRepository.unlockPaidAlarmTalks` 미러).
    @discardableResult
    func restorePaidVoiceAlarms(
        alarmStore: LocalAlarmStore,
        alarmKit: AlarmKitViewModel,
        /// 지금 로그인한 계정. **반드시 넘긴다** — 아래 소유자 게이트의 근거다.
        expectedOwnerUserId: String?
    ) async -> Int {
        // ⚠ **소유자를 반드시 본다.** 예전에는 `preLockPlayMode != nil` 만 보고 전부
        // 복원했는데, 그러면 **한 기기에서 계정을 바꿨을 때 B(유료)가 A 의 잠긴 알람을
        // 복원하고 스케줄까지 건다.** 안드로이드 `unlockPaidAlarmTalks` 는 처음부터
        // `ownerUserId == currentUser` 를 엄격히 요구하고, 그 이유를 주석으로 적어 뒀다.
        //
        // ⚠ **소유자 미기록(레거시 null) 행은 복원하지 않는다.** 잠금 경로가 잠글 때
        // 소유권을 새기므로(`applyFreePlanVoiceLock`), 여기서 null 을 관대하게 받으면
        // 그 크로스계정 창이 그대로 열린다.
        guard let owner = expectedOwnerUserId?.nilIfBlank else { return 0 }
        let locked = alarmStore.alarms.filter { $0.preLockPlayMode != nil && $0.ownerUserId == owner }
        var restored = 0
        for record in locked {
            var updated = record
            updated.playMode = updated.preLockPlayMode ?? updated.playMode
            updated.preLockPlayMode = nil
            _ = alarmStore.upsert(updated)
            // 잠글 때 걸어 둔 톤 예약을 **취소하고** 목소리로 다시 건다. 안 그러면 둘 다
            // 남아 한 알람이 두 번 운다(잠금 경로와 같은 이유).
            let previous = record
            if await alarmKit.schedule(record: updated, store: alarmStore),
               previous.alarmKitID != nil {
                await alarmKit.cancelScheduledAlarm(record: previous)
            }
            restored += 1
        }
        if restored > 0 {
            statusMessage = "이용권이 확인되어 목소리 알람을 다시 켰어요."
        }
        return restored
    }

    func clearPaidVoiceState(lockedAlarmCount: Int = 0) {
        familyVoices = []
        if lockedAlarmCount > 0 {
            // '삭제했어요' 라고 하지 않는다 — 지우지 않았고, 알람은 알람음으로 계속 울린다.
            statusMessage = "무료 이용권으로 전환되어 목소리 알람을 알람음으로 바꿨어요. 3일 안에 다시 등록하면 목소리가 돌아오고, 지나면 영구 삭제돼요."
        }
    }
}

