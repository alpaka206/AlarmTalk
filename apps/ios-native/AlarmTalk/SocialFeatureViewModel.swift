import Foundation

enum CodeRegistrationDestination: Equatable {
    case home
    case sharedPass
}

@MainActor
final class SocialFeatureViewModel: ObservableObject {
    @Published var familyGroup: FamilyGroupCurrentResponse?
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

    /// 마지막 `refreshAll` 이 **권한 판단에 필요한 것을 모두** 받아왔는가
    /// (가족 그룹 + 구독). 하나라도 실패하면 false.
    ///
    /// ⚠ 왜 필요한가 — `refreshAll` 은 갈래마다 따로 실패를 삼킨다. 그래서 "그룹에서
    /// 빠졌다" 는 새 응답과 "구독 없음" 이라는 **옛 값**이 한 스냅샷에 섞일 수 있고,
    /// 그 상태로 강등을 돌리면 **지금 유료인 사용자의 목소리 알람이 톤으로 바뀐다**
    /// (2026-08-18 Codex #697 P1). 파괴적 판단은 이 값이 true 일 때만.
    private(set) var entitlementSnapshotComplete = false

    /// 해지를 App Store 에서 해야 하는가 — 서버가 `STORE_CANCEL_UNSUPPORTED` 로 거절했을 때.
    /// 이용권 화면이 이걸 보고 StoreKit 구독 관리 시트를 연다.
    @Published var needsAppStoreSubscriptionManagement = false

    private let api: AlarmTalkAPI
    private let accessSnapshotStore: AccessSnapshotStore
    private var activeUserID: String?
    /**
     * `/auth/me` 가 굴려 준 토큰을 세션 주인에게 건넨다(2026-09-01 리뷰).
     *
     * ⚠ 배경 `plan_changed` 경로는 `refreshAll` **하나만** 돈다. 여기서 새 토큰을 버리면
     * 그 기기는 전경에서 `AuthViewModel.refreshUser` 를 돌 때까지 옛 토큰을 들고 있다가
     * **수명이 다하는 날 조용히 만료된다** — 그 뒤 푸시 정합화는 401 만 받는다.
     *
     * **토큰만 넘긴다.** 프로필까지 넘기면 그 사이 전경에서 바꾼 닉네임을 옛 값으로
     * 되돌린다(안드로이드 `PlanChangeSyncWorker` 가 같은 이유로 토큰만 쓴다).
     * 계정이 바뀌었을 수 있으므로 **누구의 토큰인지**, 그리고 **어느 토큰에서 굴러왔는지**
     * (`from`)를 함께 넘겨 받는 쪽이 대조한다. 같은 계정으로 로그아웃→재로그인하면 토큰
     * 세대가 바뀌는데, 계정 id 만 보면 **그 사이 발급된 새 로그인 토큰을 옛 것으로 덮는다.**
     */
    var onRolledToken: ((_ userID: String, _ from: String, _ to: String) -> Void)?

    /**
     * `/auth/me` 가 준 **지금 plan** 을 세션 주인에게 건넨다(2026-09-01 리뷰).
     *
     * ⚠ 이 갱신은 plan 을 `AccessSnapshotStore` 에만 적었는데, 화면 게이트들은
     * `auth.session.user.plan` 을 본다. 그래서 무료 사용자가 `INV-`/`GIFT-` 코드를 등록해
     * 서버가 구독을 만들고 `users.plan` 을 올려도, **세션은 free 그대로**라 판정기의
     * '아는 free 우선' 규칙이 방금 받은 활성 구독을 덮어 목소리·편집기가 잠긴 채 남는다.
     * (그 규칙 자체는 보류를 잡기 위해 필요하다 — 고칠 것은 **plan 의 신선도**다.)
     *
     * **plan 만 넘긴다.** 프로필 전체를 넘기면 전경에서 방금 바꾼 닉네임이 되돌아간다.
     */
    var onFreshPlan: ((_ userID: String, _ from: String, _ plan: String) -> Void)?

    /**
     * **이 토큰이 아직 지금 세션의 것인가**(2026-09-01 리뷰).
     *
     * ⚠ 세대·계정 가드만으로는 부족하다. 같은 계정으로 로그아웃→재로그인하면 `activeUserID`
     * 도 `refreshGeneration` 도 그대로라, 옛 갱신이 둘을 통과해 **옛 plan·구독을 새 세션의
     * 스냅샷에 직접 쓴다** — `applyFreshPlan` 은 토큰 에폭으로 거절하는데 스냅샷 쓰기는
     * 아무도 막지 않았다. 그 스냅샷을 예약·울림 게이트가 읽는다.
     */
    var isCurrentSessionToken: ((_ userID: String, _ token: String) -> Bool)?

    private func sessionStillCurrent(_ userID: String, _ token: String) -> Bool {
        isCurrentSessionToken?(userID, token) ?? true
    }
    /// 갱신 세대. **같은 계정 안에서도 나중에 시작한 갱신이 이긴다**(2026-09-01 리뷰).
    ///
    /// ⚠ `force: true`(plan_changed) 는 `isRefreshing` 을 건너뛰므로 평소 갱신과 **동시에**
    /// 돈다. 계정 가드만으로는 둘 다 통과하니, 먼저 시작해 옛 유료 plan 을 들고 있던 쪽이
    /// 늦게 끝나면 방금 쓴 `free` 를 덮고 스냅샷을 '확정' 으로까지 표시한다 — 강등 정합화가
    /// 그 한 번의 경합으로 무효가 된다.
    private var refreshGeneration = 0

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
        // 권한 스냅샷의 완결성도 함께 내린다 — 빈 상태를 근거로 강등하면 안 된다.
        entitlementSnapshotComplete = false
        activeUserID = nil
        familyGroup = nil
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
        // ⚠ **세대는 통과한 뒤에 올린다**(2026-09-01 리뷰 2차 정정). 위 가드 **앞**에서
        // 올리면, 곧바로 돌아갈 화면 갱신이 진행 중인 `force`(plan_changed) 갱신의 세대를
        // 무효로 만들어 놓고 **대체를 시작하지도 않는다** — 강등 정합화가 통째로 사라지고
        // `entitlementSnapshotComplete` 는 옛 true 로 남아 클론 오디오가 예약된 채 있는다.
        refreshGeneration &+= 1
        let generation = refreshGeneration
        // ⚠ **새 갱신을 받아들이는 순간 '확정' 을 내린다**(2026-09-01 리뷰). 안 내리면 앞
        // 세대가 남긴 true 가 그대로 서 있어, 밀려난 갱신을 기다리던 푸시 콜백이 그 값을
        // 보고 **부분만 갱신된 스냅샷으로 AlarmKit 정합화를 돌린다.** 이 갱신이 끝나면
        // 아래에서 다시 세운다.
        entitlementSnapshotComplete = false
        if !isRefreshing { isRefreshing = true }
        // ⚠ **내린는 것은 '지금 세대' 뿐이다**(2026-09-01 리뷰 3차 정정). 세운 사람이
        // 내리게 하면, 밀려난 갱신이 세대 가드에서 돌아가면서 **진행 중인 `force` 갱신의
        // 깃발을 대신 내린다** — 그 틈에 들어온 화면 갱신이 admission 을 통과해 세대를 또
        // 올리고 `force` 를 무효로 만든다. 반대로 '세운 사람만' 으로 두면 이번엔 아무도
        // 못 내려 깃발이 영영 켜진 채 남는다(밀려난 쪽은 소유자인데 내리지 않으므로).
        // 그래서 **소유권을 세대로** 본다: 마지막에 시작한 갱신이 끝날 때 내린다.
        defer {
            if generation == refreshGeneration { isRefreshing = false }
        }

        var messages: [String] = []
        // 이 갱신이 인정하는 '지금 토큰' — rolling refresh 로 굴러가면 함께 옮겨 간다.
        var effectiveToken = token

        var familyGroupOK = false
        var entitlementOK = false
        do {
            let nextFamilyGroup = try await api.getFamilyGroup(token: token)
            guard activeUserID == userID, generation == refreshGeneration,
                  sessionStillCurrent(userID, token) else { return }
            familyGroup = nextFamilyGroup
            accessSnapshotStore.updateFamilyGroup(userID: userID, response: nextFamilyGroup)
            familyGroupOK = true
        } catch {
            messages.append(Self.scopedRefreshErrorMessage(
                label: "가족 그룹",
                error: error,
                fallback: "공유 이용권 정보를 불러오지 못했어요"
            ))
        }

        do {
            async let nextSubscription = api.getSubscription(token: token)
            async let nextVouchers = api.listVouchers(token: token)
            let resolvedSubscription = try await nextSubscription
            let resolvedVouchers = try await nextVouchers
            guard activeUserID == userID, generation == refreshGeneration else { return }
            // 그룹보다 먼저 보는 값이라 구독과 **같이** 적어 둔다(보류 판정의 근거).
            //
            // ⚠ **요청 전에 잡아 둔 세션의 plan 을 쓰지 말 것**(2026-08-31 리뷰).
            // 배경 `onPlanChanged` 경로는 `refreshAll` 만 부르고 사용자를 다시 읽지 않는다 —
            // 소유자가 결제 보류에 들어가면 그룹은 남는데, 여기에 **옛 유료 plan** 이 적히면
            // 판정기가 유료라고 답해 클론 오디오가 계속 예약된다. 서버에서 지금 값을 받아 적는다.
            //
            // ⚠ **그러니 실패도 `try?` 로 삼키면 안 된다**(2026-09-01 리뷰). 삼키고 옛
            // `session.user.plan` 로 때우면 보류 직전의 **유료** 값이 스냅샷에 다시 박히는데,
            // 아래에서 `entitlementSnapshotComplete` 까지 true 가 되어 그 값이 '확정' 으로
            // 읽힌다 — 정합화가 하필 그 한 번의 네트워크 실패 때문에 클론 오디오를 그대로
            // 예약된 채 남긴다. 못 받았으면 **적지 않고**(마지막으로 확인된 값을 남긴다)
            // 스냅샷을 미완으로 표시해 다음 갱신을 기다린다.
            var freshPlan: String?
            var planOK = false
            var rolledToken: String?
            do {
                let me = try await AlarmTalkAPI.shared.me(token: token)
                freshPlan = me.user.plan
                planOK = true
                rolledToken = me.token?.nilIfBlank
            } catch {
                messages.append(Self.scopedRefreshErrorMessage(
                    label: "이용권",
                    error: error,
                    fallback: "이용권 정보를 불러오지 못했어요"
                ))
            }
            // ⚠ **await 뒤에는 다시 본다**(2026-08-31 리뷰 2차). 위 가드를 통과한 뒤 이
            // 요청에서 멈춰 있는 사이 로그아웃·계정 전환이 일어날 수 있다 — 그대로 쓰면
            // A 의 태스크가 **지워진 A 의 스냅샷을 되살리고** A 의 공유 코드를 B 의 화면에
            // 올린다(B 의 새로고침은 A 가 `isRefreshing` 을 쥐고 있어 일찍 반환했을 수도 있다).
            guard activeUserID == userID, generation == refreshGeneration,
                  sessionStillCurrent(userID, token) else { return }
            // rolling refresh — **세대 가드를 통과한 뒤에** 넘긴다(2026-09-01 리뷰).
            // 앞에서 넘기면 밀려난 갱신이 굴린 토큰까지 세션에 박힌다.
            // ⚠ **plan 을 토큰 회전보다 먼저 적용한다**(2026-09-01 리뷰). 둘 다 출처 토큰을
            // 에폭 가드로 쓰는데, 토큰을 먼저 굴리면 그 뒤 `applyFreshPlan` 의
            // `current.token == previous` 가 **항상 거짓**이 되어 plan 이 영영 반영되지 않는다
            // (27차에 넣은 에폭 가드가 26차 수정을 통째로 무력화하고 있었다).
            if let freshPlan { onFreshPlan?(userID, token, freshPlan) }
            if let rolledToken, rolledToken != token {
                onRolledToken?(userID, token, rolledToken)
                // ⚠ **굴린 뒤에는 기준 토큰도 갱신한다**(2026-09-01 리뷰). 이 값으로 아래
                // 마지막 가드를 보는데, 옛 토큰 그대로 두면 **방금 내가 굴린 것 때문에**
                // 그 가드가 항상 실패해 `entitlementSnapshotComplete` 가 서지 않는다 —
                // 그러면 `plan_changed` 핸들러가 정합화를 건너뛰어, 필드를 다 갱신하고도
                // 이미 예약된 클론 오디오가 그대로 남는다.
                effectiveToken = rolledToken
            }
            subscription = resolvedSubscription
            accessSnapshotStore.updateSubscription(userID: userID, response: resolvedSubscription)
            if let freshPlan {
                accessSnapshotStore.updateUserPlan(userID: userID, plan: freshPlan)
                // ⚠ **서버가 무료를 확정하면 캐시된 StoreKit 신호도 끊는다**(2026-09-01 리뷰,
                // 안드로이드 `PlanChangeSyncWorker` 와 같은 규칙). 기간 중 환불·회수는
                // `plan_changed` 로 오는데 배경 경로는 이 갱신 하나만 돈다 — 캐시에 남은
                // **원래 만료 시각**이 판정 1단이라, 그걸 안 끊으면 그 시각까지 클론 오디오가
                // 계속 예약된다. 판정은 **스토어 신호를 빼고**(빼지 않으면 지우려는 그
                // 상황에서만 조건이 거짓이 된다) 서버가 준 값만으로 한다.
                var serverOnly = AccessSnapshot.empty
                serverOnly.subscriptionResponse = resolvedSubscription
                serverOnly.familyGroup = familyGroup
                serverOnly.userPlan = freshPlan
                // ⚠ **권위 있는 갱신에서만 끊는다**(2026-09-01 리뷰 2차 정정). 이 함수는
                // 앱 시작·탭 진입에서도 도는데, 그때 서버 스냅샷이 아직 옛 free 이고 StoreKit
                // 은 이미 갱신을 확인했을 수 있다 — 무조건 끊으면 **살아 있는 스토어 신호를
                // 지워 돈 내는 사용자의 클론을 강등한다.** `force` 는 `plan_changed` 푸시와
                // 사용자 쓰기(해지·그룹 나가기) 뒤에만 참이라, 서버가 방금 확정한 회차다.
                // (안드로이드는 이 로직이 `PlanChangeSyncWorker` 안에 있어 원래 그 조건이었다.)
                if force, PaidVoiceGate.resolve(snapshot: serverOnly) == .notEntitled {
                    accessSnapshotStore.updateStorePlanKey(userID: userID, planKey: nil, untilMillis: nil)
                }
            }
            vouchers = resolvedVouchers
            entitlementOK = planOK
        } catch {
            messages.append(Self.scopedRefreshErrorMessage(
                label: "이용권",
                error: error,
                fallback: "공유 코드 정보를 불러오지 못했어요"
            ))
        }

        guard activeUserID == userID, generation == refreshGeneration,
              sessionStillCurrent(userID, effectiveToken) else { return }
        entitlementSnapshotComplete = familyGroupOK && entitlementOK
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
        // ⚠ **여기서는 세대를 올리지 않는다 — 잡아 두기만 한다.** 이 갱신은 구독 하나만
        // 쓰는 좁은 경로라, 올리면 더 넓은 `refreshAll`(plan·그룹·확정 표시까지 쓴다)이
        // 진행 중일 때 그걸 무효로 만든다. 잡아 두기만 하면 방향이 하나로 정리된다 —
        // 나중에 시작한 `refreshAll` 은 이 결과를 버리게 하고, 그 반대는 하지 않는다.
        let generation = refreshGeneration
        do {
            let nextSubscription = try await api.getSubscription(token: token)
            // 여기도 같은 경합을 탄다 — 늦게 끝난 옛 응답이 방금 받은 것을 덮는다.
            guard activeUserID == userID, generation == refreshGeneration,
                  sessionStillCurrent(userID, token) else { return }
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

    /// 코드를 등록하고 **실패 사유를 돌려준다**(성공이면 `nil`).
    ///
    /// 유료 게이트의 쿠폰 시트(`RedeemCodeSheet`)가 오류를 **입력창 바로 밑**에 그리려면
    /// 결과를 문자열로 받아야 한다. `registerCode` 는 실패를 `statusMessage` 로만 알리는데,
    /// 그걸 그대로 읽으면 **직전 성공 문구**("코드를 등록했어요.")가 남아 있을 수 있어
    /// 먼저 비운다 — `isBusy` 로 조용히 빠지는 갈래도 그때 폴백 문구를 받는다.
    func registerCodeReportingFailure(_ code: String, session: AuthSession?) async -> String? {
        statusMessage = nil
        let destination = await registerCode(code, session: session)
        guard destination == nil else { return nil }
        return statusMessage ?? "코드 등록에 실패했어요."
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

        // ⚠ **자격을 잃은 잠금은 여기서 되돌린다**(안드로이드 `lockPaidAlarmTalks` 에는
        // 처음부터 있던 갈래인데 iOS 에만 없었다). 판정이 고쳐지면 예전 기준으로 잠긴 행이
        // 남는데, 그 행은 더 이상 잠글 축이 없어 **풀어 줄 다른 경로가 없다** — 복원
        // (`restorePaidVoiceAlarms`)은 유료가 됐을 때만 돌기 때문이다. 그대로 두면 무료
        // 사용자의 목소리 알람이 영영 알람음으로 남는다(2026-08-18 판정 수정과 한 쌍).
        let staleLocks = alarmStore.alarms.filter { record in
            record.preLockPlayMode != nil
                && record.originEnum == .localOwned
                && !record.isPaidVoiceForDowngrade
                && (expectedOwnerUserId == nil || record.ownerUserId == nil
                    || record.ownerUserId == expectedOwnerUserId)
        }
        for record in staleLocks {
            // ⚠ **밀려났으면 즉시 멈춘다**(2026-09-01 리뷰 — 아래 잠금 루프의 주석과 같은 이유).
            if Task.isCancelled { return 0 }
            var restored = record
            restored.playMode = record.preLockPlayMode ?? record.playMode
            restored.preLockPlayMode = nil
            _ = alarmStore.upsert(restored)
            if await alarmKit.schedule(record: restored, store: alarmStore),
               record.alarmKitID != nil {
                await alarmKit.cancelScheduledAlarm(record: record)
            }
        }

        var locked = 0
        for record in targets {
            // ⚠ **밀려난 잠금은 여기서 멈춘다**(2026-09-01 리뷰). 이 함수는 `.task(id:)` 에서
            // 도는데, 도는 도중 StoreKit 이 유료를 알려 오면 그 태스크가 **취소되고 복원
            // 태스크가 시작된다.** 취소를 안 보면 옛 루프가 복원이 대상 목록을 읽은 **뒤에**
            // 남은 알람들을 계속 잠근다 — 돈 내는 사용자의 알람이 알람음으로 남는다.
            // `AlarmKitViewModel.schedule` 은 행을 이미 고친 **뒤에야** 취소를 알아챈다.
            if Task.isCancelled { return locked }
            var updated = record
            // 이미 잠긴 알람을 다시 잠그면 원래 값을 잃는다 — 처음 한 번만 적는다.
            let needsLock = updated.preLockPlayMode == nil
            if needsLock {
                updated.preLockPlayMode = updated.playMode
            }
            updated.playMode = AlarmPlayMode.alarmOnly.rawValue
            // ⚠ **쓰기 직전에 한 번 더 본다**(2026-09-01 리뷰). 위 검사와 이 쓰기 사이에
            // StoreKit 이 유료를 알려 오면 반대 태스크가 시작돼 대상 목록을 잡는데, 그
            // 뒤에 이 행을 고치면 `schedule` 이 취소를 알아채고 물러나도 **행은 이미 바뀐
            // 채로 남는다** — 방금 결제한 사용자의 알람이 alarm_only 로 굳는다.
            if Task.isCancelled { return locked }
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
            // ⚠ **밀려난 복원도 멈춘다**(2026-09-01 리뷰). 반대 방향(잠금 → 복원)만 막으면
            // 반쪽이다 — 복원 도중 `users.plan` 이 free 로 돌아오면 이 태스크가 취소되고
            // 잠금이 시작되는데, 취소를 안 보면 옛 복원 루프가 잠금이 대상 목록을 잡은
            // **뒤에** 남은 알람을 되살려 **무료 계정에 클론 오디오가 예약된 채로 남는다.**
            if Task.isCancelled { return restored }
            var updated = record
            updated.playMode = updated.preLockPlayMode ?? updated.playMode
            updated.preLockPlayMode = nil
            // 위 잠금 루프와 같은 이유 — 쓰기 직전에 한 번 더 본다.
            if Task.isCancelled { return restored }
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
        if lockedAlarmCount > 0 {
            // '삭제했어요' 라고 하지 않는다 — 지우지 않았고, 알람은 알람음으로 계속 울린다.
            statusMessage = "무료 이용권으로 전환되어 목소리 알람을 알람음으로 바꿨어요. 3일 안에 다시 등록하면 목소리가 돌아오고, 지나면 영구 삭제돼요."
        }
    }
}
