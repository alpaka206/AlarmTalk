import AuthenticationServices
import Foundation
import XCTest
@testable import AlarmTalk

/// Phase 4-D2 — `AuthViewModel` 의 에러 분기 + Apple credentialState 점검.
///
/// 검증 대상
///   1. `refreshUser` 의 status code 별 분기
///      - 401 → signOut + statusMessage 설정
///      - 403 → 세션 유지 + `lastNetworkError`
///      - 5xx → 세션 유지 + `lastNetworkError`
///      - URLError(네트워크 단절) → 세션 유지 + `lastNetworkError`
///      - APIError.invalidResponse → 세션 유지 + `lastNetworkError`
///   2. `verifyAppleCredentialStateIfNeeded`
///      - .authorized → no-op (세션 유지, lastNetworkError 변화 없음)
///      - .revoked → signOut
///      - .notFound → signOut
///      - .transferred → 세션 유지 + 안내 메시지
///      - appleUserId nil(이메일/Google) → 즉시 return, credentialState 호출 안 함
@MainActor
final class AuthViewModelTests: XCTestCase {

    // MARK: - Helpers

    private func makeAppleSession(appleUserId: String? = "apple-sub-12345") -> AuthSession {
        AuthSession(
            token: "test-jwt",
            user: AuthUser(
                id: "user-1",
                email: "tester@example.com",
                name: "Tester",
                plan: "free",
                allowFamilyAlarms: false,
                familyAlarmQuietDays: nil,
                familyAlarmQuietStart: nil,
                familyAlarmQuietEnd: nil,
                familyAlarmQuietWindows: nil,
                appleUserId: appleUserId
            )
        )
    }

    private func makeEmailSession() -> AuthSession {
        AuthSession(
            token: "test-jwt",
            user: AuthUser(
                id: "user-1",
                email: "tester@example.com",
                name: "Tester",
                plan: "free",
                allowFamilyAlarms: false,
                familyAlarmQuietDays: nil,
                familyAlarmQuietStart: nil,
                familyAlarmQuietEnd: nil,
                familyAlarmQuietWindows: nil,
                appleUserId: nil
            )
        )
    }

    private func subscription(planKey: String) -> BillingSubscriptionResponse {
        BillingSubscriptionResponse(
            subscription: BillingSubscription(
                id: "subscription-\(planKey)",
                planId: "plan-\(planKey)",
                planGroupId: nil,
                status: "active",
                startsAt: "2026-01-01T00:00:00Z",
                expiresAt: "2026-02-01T00:00:00Z",
                cancelAtPeriodEnd: false,
                canceledAt: nil,
                nextPlanId: nil
            ),
            plan: BillingPlan(
                id: "plan-\(planKey)",
                key: planKey,
                name: planKey,
                planType: planKey,
                periodDays: 30,
                maxMembers: planKey == "family" ? 4 : 2,
                priceKrw: 9_900
            ),
            nextPlan: nil
        )
    }

    // MARK: - refreshUser status code branches

    func test_refreshUser_with401_signsOutAndSetsStatusMessage() async {
        let api = MockAuthAPI()
        api.meResult = .failure(.server(status: 401, message: "expired", errorCode: nil))
        let vm = AuthViewModel(api: api, appleCredentialProvider: MockAppleCredentialProvider())
        vm._setSessionForTesting(makeEmailSession())

        await vm.refreshUser()

        XCTAssertNil(vm.session, "401 은 세션 만료로 처리되어 signOut 되어야 한다")
        XCTAssertEqual(vm.statusMessage, "세션이 만료됐어요. 다시 로그인해 주세요.")
        XCTAssertNil(vm.lastNetworkError, "signOut 후 lastNetworkError 는 nil 로 초기화된다")
    }

    func test_refreshUser_with403_keepsSessionAndSetsLastNetworkError() async {
        let api = MockAuthAPI()
        api.meResult = .failure(.server(status: 403, message: "forbidden", errorCode: nil))
        let vm = AuthViewModel(api: api, appleCredentialProvider: MockAppleCredentialProvider())
        vm._setSessionForTesting(makeEmailSession())

        await vm.refreshUser()

        XCTAssertNotNil(vm.session, "403 은 세션을 유지해야 한다")
        XCTAssertEqual(vm.lastNetworkError, "이 계정으로는 접근할 수 없는 기능이 있어요.")
    }

    func test_refreshUser_with500_keepsSessionAndUsesKoreanFallbackForEnglishServerMessage() async {
        let api = MockAuthAPI()
        api.meResult = .failure(.server(status: 500, message: "internal", errorCode: nil))
        let vm = AuthViewModel(api: api, appleCredentialProvider: MockAppleCredentialProvider())
        vm._setSessionForTesting(makeEmailSession())

        await vm.refreshUser()

        XCTAssertNotNil(vm.session, "5xx 일시 오류는 세션을 유지해야 한다")
        XCTAssertEqual(vm.lastNetworkError, "서버에 일시적으로 연결할 수 없어요.")
    }

    func test_refreshUser_with500_blankMessage_fallsBackToGenericCopy() async {
        let api = MockAuthAPI()
        api.meResult = .failure(.server(status: 503, message: "   ", errorCode: nil))
        let vm = AuthViewModel(api: api, appleCredentialProvider: MockAppleCredentialProvider())
        vm._setSessionForTesting(makeEmailSession())

        await vm.refreshUser()

        XCTAssertNotNil(vm.session)
        XCTAssertEqual(vm.lastNetworkError, "서버에 일시적으로 연결할 수 없어요.")
    }

    func test_refreshUser_withURLError_keepsSession() async {
        let api = MockAuthAPI()
        api.meResult = .failureRaw(URLError(.notConnectedToInternet))
        let vm = AuthViewModel(api: api, appleCredentialProvider: MockAppleCredentialProvider())
        vm._setSessionForTesting(makeEmailSession())

        await vm.refreshUser()

        XCTAssertNotNil(vm.session, "URLError 는 일시 네트워크 단절로 보고 세션 유지")
        XCTAssertEqual(vm.lastNetworkError, "네트워크 연결을 확인해 주세요.")
    }

    func test_refreshUser_withInvalidResponse_keepsSession() async {
        let api = MockAuthAPI()
        api.meResult = .failure(.invalidResponse)
        let vm = AuthViewModel(api: api, appleCredentialProvider: MockAppleCredentialProvider())
        vm._setSessionForTesting(makeEmailSession())

        await vm.refreshUser()

        XCTAssertNotNil(vm.session)
        XCTAssertEqual(vm.lastNetworkError, "서버 응답을 해석하지 못했어요.")
    }

    func test_userFacingErrorMessage_hidesEnglishServerMessageLikeAndroid() {
        let error = APIError.server(status: 500, message: "Internal Server Error", errorCode: nil)

        XCTAssertEqual(
            userFacingErrorMessage(error, fallback: "로그인에 실패했어요"),
            "로그인에 실패했어요"
        )
    }

    func test_userFacingErrorMessage_keepsKoreanServerMessageLikeAndroid() {
        let error = APIError.server(status: 400, message: "이미 가입된 이메일이에요", errorCode: nil)

        XCTAssertEqual(
            userFacingErrorMessage(error, fallback: "회원가입에 실패했어요"),
            "이미 가입된 이메일이에요"
        )
    }

    func test_refreshUser_success_clearsLastNetworkError_andPreservesAppleUserId() async {
        let api = MockAuthAPI()
        // 서버 응답이 appleUserId 를 누락해도 기존 세션의 값이 유지되어야 한다.
        api.meResult = .success(AuthUser(
            id: "user-1",
            email: "tester@example.com",
            name: "Tester (renamed)",
            plan: "personal",
            allowFamilyAlarms: nil,
            familyAlarmQuietDays: nil,
            familyAlarmQuietStart: nil,
            familyAlarmQuietEnd: nil,
            familyAlarmQuietWindows: nil,
            appleUserId: nil
        ))
        let vm = AuthViewModel(api: api, appleCredentialProvider: MockAppleCredentialProvider())
        vm._setSessionForTesting(makeAppleSession(appleUserId: "preserved-sub"))

        await vm.refreshUser()

        XCTAssertNotNil(vm.session)
        XCTAssertEqual(vm.session?.user.name, "Tester (renamed)")
        XCTAssertEqual(
            vm.session?.user.appleUserId, "preserved-sub",
            "백엔드 응답이 appleUserId 누락 시 이전 세션 값이 보존되어야 한다"
        )
        XCTAssertNil(vm.lastNetworkError)
    }

    // MARK: - verifyAppleCredentialStateIfNeeded

    func test_verifyAppleCredentialState_emailUser_isNoOp() async {
        let api = MockAuthAPI()
        let credentialProvider = MockAppleCredentialProvider()
        credentialProvider.stubState = .revoked  // 호출되면 안 됨
        let vm = AuthViewModel(api: api, appleCredentialProvider: credentialProvider)
        vm._setSessionForTesting(makeEmailSession())

        await vm.verifyAppleCredentialStateIfNeeded()

        XCTAssertEqual(credentialProvider.callCount, 0, "이메일 사용자는 credentialState 조회 자체를 건너뛴다")
        XCTAssertNotNil(vm.session, "이메일 사용자는 세션 유지")
    }

    func test_verifyAppleCredentialState_appleUserButBlankId_isNoOp() async {
        let api = MockAuthAPI()
        let credentialProvider = MockAppleCredentialProvider()
        credentialProvider.stubState = .revoked
        let vm = AuthViewModel(api: api, appleCredentialProvider: credentialProvider)
        // appleUserId 가 빈 문자열이면 조회 불가 — no-op.
        vm._setSessionForTesting(makeAppleSession(appleUserId: ""))

        await vm.verifyAppleCredentialStateIfNeeded()

        XCTAssertEqual(credentialProvider.callCount, 0)
        XCTAssertNotNil(vm.session)
    }

    func test_verifyAppleCredentialState_authorized_isNoOp() async {
        let api = MockAuthAPI()
        let credentialProvider = MockAppleCredentialProvider()
        credentialProvider.stubState = .authorized
        let vm = AuthViewModel(api: api, appleCredentialProvider: credentialProvider)
        vm._setSessionForTesting(makeAppleSession())

        await vm.verifyAppleCredentialStateIfNeeded()

        XCTAssertEqual(credentialProvider.callCount, 1)
        XCTAssertNotNil(vm.session, ".authorized 면 세션 유지")
        XCTAssertNil(vm.lastNetworkError, ".authorized 면 lastNetworkError 변화 없음")
    }

    func test_verifyAppleCredentialState_revoked_signsOut() async {
        let api = MockAuthAPI()
        let credentialProvider = MockAppleCredentialProvider()
        credentialProvider.stubState = .revoked
        let vm = AuthViewModel(api: api, appleCredentialProvider: credentialProvider)
        vm._setSessionForTesting(makeAppleSession())

        await vm.verifyAppleCredentialStateIfNeeded()

        XCTAssertNil(vm.session, ".revoked 는 강제 signOut")
        XCTAssertEqual(vm.statusMessage, "Apple ID 로그인이 더 이상 유효하지 않아요. 다시 로그인해 주세요.")
    }

    func test_verifyAppleCredentialState_notFound_signsOut() async {
        let api = MockAuthAPI()
        let credentialProvider = MockAppleCredentialProvider()
        credentialProvider.stubState = .notFound
        let vm = AuthViewModel(api: api, appleCredentialProvider: credentialProvider)
        vm._setSessionForTesting(makeAppleSession())

        await vm.verifyAppleCredentialStateIfNeeded()

        XCTAssertNil(vm.session, ".notFound 는 강제 signOut")
    }

    func test_verifyAppleCredentialState_transferred_keepsSessionWithMessage() async {
        let api = MockAuthAPI()
        let credentialProvider = MockAppleCredentialProvider()
        credentialProvider.stubState = .transferred
        let vm = AuthViewModel(api: api, appleCredentialProvider: credentialProvider)
        vm._setSessionForTesting(makeAppleSession())

        await vm.verifyAppleCredentialStateIfNeeded()

        XCTAssertNotNil(vm.session, ".transferred 는 세션을 유지하고 사용자에게 안내만 한다")
        XCTAssertEqual(vm.lastNetworkError, "다른 기기로 이전된 Apple ID 입니다. 다시 로그인해 주세요.")
    }

    func test_verifyAppleCredentialState_providerThrows_keepsSession() async {
        let api = MockAuthAPI()
        let credentialProvider = MockAppleCredentialProvider()
        credentialProvider.shouldThrow = true
        let vm = AuthViewModel(api: api, appleCredentialProvider: credentialProvider)
        vm._setSessionForTesting(makeAppleSession())

        await vm.verifyAppleCredentialStateIfNeeded()

        XCTAssertNotNil(vm.session, "credentialState 조회 자체가 실패해도 세션 유지")
        XCTAssertEqual(vm.lastNetworkError, "Apple 로그인 상태를 확인하지 못했어요.")
    }

    // MARK: - profile update payloads

    func test_updateProfile_withQuietWindows_sendsAndroidCompatiblePayload() async {
        let api = MockAuthAPI()
        api.meResult = .success(makeEmailSession().user)
        let vm = AuthViewModel(api: api, appleCredentialProvider: MockAppleCredentialProvider())
        vm._setSessionForTesting(makeEmailSession())

        await vm.updateProfile(
            allowFamilyAlarms: true,
            quietWindows: [
                FamilyAlarmQuietWindow(days: [3, 1, 9, 1], start: "22:00", end: "08:30"),
                FamilyAlarmQuietWindow(days: [], start: "10:00", end: "11:00")
            ]
        )

        let request = api.lastUpdateProfileRequest
        XCTAssertEqual(api.updateProfileCallCount, 1)
        XCTAssertEqual(request?.allowFamilyAlarms, true)
        XCTAssertEqual(request?.familyAlarmQuietDays, [1, 3])
        XCTAssertEqual(request?.familyAlarmQuietStart, "22:00")
        XCTAssertEqual(request?.familyAlarmQuietEnd, "08:30")
        XCTAssertEqual(
            request?.familyAlarmQuietWindows ?? [],
            [FamilyAlarmQuietWindow(days: [1, 3], start: "22:00", end: "08:30")]
        )
    }

    func test_updateProfile_withEmptyQuietWindows_sendsDefaultLegacyWindow() async {
        let api = MockAuthAPI()
        api.meResult = .success(makeEmailSession().user)
        let vm = AuthViewModel(api: api, appleCredentialProvider: MockAppleCredentialProvider())
        vm._setSessionForTesting(makeEmailSession())

        await vm.updateProfile(allowFamilyAlarms: false, quietWindows: [])

        let request = api.lastUpdateProfileRequest
        XCTAssertEqual(api.updateProfileCallCount, 1)
        XCTAssertEqual(request?.allowFamilyAlarms, false)
        XCTAssertEqual(request?.familyAlarmQuietDays, [1, 2, 3, 4, 5])
        XCTAssertEqual(request?.familyAlarmQuietStart, "09:00")
        XCTAssertEqual(request?.familyAlarmQuietEnd, "18:30")
        XCTAssertEqual(request?.familyAlarmQuietWindows ?? [], [])
    }

    func test_updateProfile_withInvalidQuietTime_doesNotCallApi() async {
        let api = MockAuthAPI()
        api.meResult = .success(makeEmailSession().user)
        let vm = AuthViewModel(api: api, appleCredentialProvider: MockAppleCredentialProvider())
        vm._setSessionForTesting(makeEmailSession())

        await vm.updateProfile(
            allowFamilyAlarms: true,
            quietWindows: [
                FamilyAlarmQuietWindow(days: [1], start: "9:00", end: "18:30")
            ]
        )

        XCTAssertEqual(api.updateProfileCallCount, 0)
        XCTAssertEqual(vm.statusMessage, "시간은 HH:mm 형식으로 입력해 주세요.")
    }

    // MARK: - signOut clears state

    func test_signOut_clearsSessionAndLastNetworkError() {
        let vm = AuthViewModel(api: MockAuthAPI(), appleCredentialProvider: MockAppleCredentialProvider())
        vm._setSessionForTesting(makeEmailSession())

        vm.signOut(message: "bye")

        XCTAssertNil(vm.session)
        XCTAssertEqual(vm.statusMessage, "bye")
        XCTAssertNil(vm.lastNetworkError)
    }

    func test_deleteAccount_clearsOnlyCurrentUserAccessSnapshot() async {
        let suiteName = "AuthViewModelTests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        defer { defaults.removePersistentDomain(forName: suiteName) }

        let snapshotStore = AccessSnapshotStore(defaults: defaults)
        snapshotStore.updateSubscription(userID: "user-1", response: subscription(planKey: "family"))
        snapshotStore.updateSubscription(userID: "user-2", response: subscription(planKey: "personal"))

        let api = MockAuthAPI()
        api.deleteAccountResult = .success(DeleteAccountResponse(success: true))
        let vm = AuthViewModel(
            api: api,
            appleCredentialProvider: MockAppleCredentialProvider(),
            accessSnapshotStore: snapshotStore
        )
        vm._setSessionForTesting(makeEmailSession())

        await vm.deleteAccount()

        XCTAssertNil(vm.session)
        XCTAssertEqual(api.deleteAccountCallCount, 1)
        XCTAssertNil(snapshotStore.read(userID: "user-1").subscriptionResponse)
        XCTAssertEqual(snapshotStore.read(userID: "user-2").subscriptionResponse?.plan?.key, "personal")
    }

    func test_requestAccountDeletion_signsOutAndClearsSnapshot() async {
        let suiteName = "AuthViewModelTests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        defer { defaults.removePersistentDomain(forName: suiteName) }

        let snapshotStore = AccessSnapshotStore(defaults: defaults)
        snapshotStore.updateSubscription(userID: "user-1", response: subscription(planKey: "family"))

        let api = MockAuthAPI()
        api.requestAccountDeletionResult = .success(AccountDeletionResponse(success: true))
        let vm = AuthViewModel(
            api: api,
            appleCredentialProvider: MockAppleCredentialProvider(),
            accessSnapshotStore: snapshotStore
        )
        vm._setSessionForTesting(makeEmailSession())

        await vm.requestAccountDeletion()

        XCTAssertNil(vm.session)
        XCTAssertEqual(api.requestAccountDeletionCallCount, 1)
        XCTAssertFalse(vm.pendingDeletion)
        XCTAssertNil(snapshotStore.read(userID: "user-1").subscriptionResponse)
    }

    func test_cancelAccountDeletion_clearsPendingFlag() async {
        let api = MockAuthAPI()
        api.cancelAccountDeletionResult = .success(CancelDeletionResponse(success: true, status: "active"))
        let vm = AuthViewModel(
            api: api,
            appleCredentialProvider: MockAppleCredentialProvider(),
            accessSnapshotStore: AccessSnapshotStore(defaults: UserDefaults(suiteName: "cancel-\(UUID().uuidString)")!)
        )
        vm._setSessionForTesting(makeEmailSession())

        await vm.cancelAccountDeletion()

        XCTAssertEqual(api.cancelAccountDeletionCallCount, 1)
        XCTAssertFalse(vm.pendingDeletion)
        XCTAssertNotNil(vm.session)
    }

    func test_refreshUser_setsPendingDeletion_whenStatusPending() async {
        let api = MockAuthAPI()
        api.meResult = .success(
            AuthUser(id: "user-1", email: "a@b.com", name: "A", plan: "free", deletionStatus: "pending_deletion")
        )
        let vm = AuthViewModel(
            api: api,
            appleCredentialProvider: MockAppleCredentialProvider(),
            accessSnapshotStore: AccessSnapshotStore(defaults: UserDefaults(suiteName: "pending-\(UUID().uuidString)")!)
        )
        vm._setSessionForTesting(makeEmailSession())

        await vm.refreshUser()

        XCTAssertTrue(vm.pendingDeletion)
    }

    func test_checkConsentStatus_setsNeedsConsent() async {
        let api = MockAuthAPI()
        api.consentStatusResult = .success(ConsentStatusResponse(needsConsent: true, required: ["terms"], missing: ["terms"]))
        let vm = AuthViewModel(
            api: api,
            appleCredentialProvider: MockAppleCredentialProvider(),
            accessSnapshotStore: AccessSnapshotStore(defaults: UserDefaults(suiteName: "consent-\(UUID().uuidString)")!)
        )
        vm._setSessionForTesting(makeEmailSession())

        await vm.checkConsentStatus()

        XCTAssertTrue(vm.needsConsent)
        XCTAssertEqual(api.consentStatusCallCount, 1)
    }

    func test_submitConsents_recordsAllRequiredAndMarketing() async {
        let api = MockAuthAPI()
        api.consentStatusResult = .success(ConsentStatusResponse(needsConsent: true))
        let vm = AuthViewModel(
            api: api,
            appleCredentialProvider: MockAppleCredentialProvider(),
            accessSnapshotStore: AccessSnapshotStore(defaults: UserDefaults(suiteName: "consent2-\(UUID().uuidString)")!)
        )
        vm._setSessionForTesting(makeEmailSession())
        await vm.checkConsentStatus()
        XCTAssertTrue(vm.needsConsent)

        await vm.submitConsents(marketingAgreed: true)

        XCTAssertFalse(vm.needsConsent)
        XCTAssertEqual(api.recordConsentsCallCount, 1)
        let consents = api.lastRecordConsentsRequest?.consents ?? []
        XCTAssertEqual(
            Set(consents.filter { $0.agreed }.map { $0.type }),
            ["terms", "privacy", "age14", "voice_biometric", "overseas_transfer", "marketing"]
        )
        // 모든 항목이 현재 정책 버전("2")을 동봉해야 한다.
        XCTAssertTrue(consents.allSatisfy { $0.version == AuthViewModel.currentPolicyVersion })
    }
}

// MARK: - Mocks

/// `AuthAPIProviding` mock. `me(token:)` 호출에 미리 stub 한 결과를 반환한다.
private final class MockAuthAPI: AuthAPIProviding, @unchecked Sendable {
    enum StubResult {
        case success(AuthUser)
        case failure(APIError)
        /// `APIError` 가 아닌 임의의 Error 를 throw. URLError 등에 사용.
        case failureRaw(Error)
    }

    var meResult: StubResult = .failure(.invalidResponse)
    var updateProfileResult: Result<UpdateProfileResponse, Error> = .success(
        UpdateProfileResponse(
            success: true,
            name: nil,
            allowFamilyAlarms: nil,
            familyAlarmQuietDays: nil,
            familyAlarmQuietStart: nil,
            familyAlarmQuietEnd: nil,
            familyAlarmQuietWindows: nil,
            dynamicPromptSettings: nil
        )
    )
    var deleteAccountResult: Result<DeleteAccountResponse, Error> = .success(DeleteAccountResponse(success: true))
    var requestAccountDeletionResult: Result<AccountDeletionResponse, Error> = .success(AccountDeletionResponse(success: true))
    var cancelAccountDeletionResult: Result<CancelDeletionResponse, Error> = .success(CancelDeletionResponse(success: true))
    var consentStatusResult: Result<ConsentStatusResponse, Error> = .success(ConsentStatusResponse(needsConsent: false))
    var recordConsentsResult: Result<RecordConsentsResponse, Error> = .success(RecordConsentsResponse(success: true, recorded: 4))
    private(set) var meCallCount = 0
    private(set) var updateProfileCallCount = 0
    private(set) var lastUpdateProfileRequest: UpdateProfileRequest?
    private(set) var deleteAccountCallCount = 0
    private(set) var requestAccountDeletionCallCount = 0
    private(set) var cancelAccountDeletionCallCount = 0
    private(set) var consentStatusCallCount = 0
    private(set) var recordConsentsCallCount = 0
    private(set) var lastRecordConsentsRequest: RecordConsentsRequest?

    func me(token: String) async throws -> AuthUser {
        meCallCount += 1
        switch meResult {
        case .success(let user):
            return user
        case .failure(let apiError):
            throw apiError
        case .failureRaw(let err):
            throw err
        }
    }

    func updateProfile(_ requestBody: UpdateProfileRequest, token: String) async throws -> UpdateProfileResponse {
        updateProfileCallCount += 1
        lastUpdateProfileRequest = requestBody
        switch updateProfileResult {
        case .success(let response):
            return response
        case .failure(let error):
            throw error
        }
    }

    func deleteAccount(token: String) async throws -> DeleteAccountResponse {
        deleteAccountCallCount += 1
        switch deleteAccountResult {
        case .success(let response):
            return response
        case .failure(let error):
            throw error
        }
    }

    func requestAccountDeletion(token: String) async throws -> AccountDeletionResponse {
        requestAccountDeletionCallCount += 1
        switch requestAccountDeletionResult {
        case .success(let response):
            return response
        case .failure(let error):
            throw error
        }
    }

    func cancelAccountDeletion(token: String) async throws -> CancelDeletionResponse {
        cancelAccountDeletionCallCount += 1
        switch cancelAccountDeletionResult {
        case .success(let response):
            return response
        case .failure(let error):
            throw error
        }
    }

    func consentStatus(token: String) async throws -> ConsentStatusResponse {
        consentStatusCallCount += 1
        switch consentStatusResult {
        case .success(let response):
            return response
        case .failure(let error):
            throw error
        }
    }

    func recordConsents(_ requestBody: RecordConsentsRequest, token: String) async throws -> RecordConsentsResponse {
        recordConsentsCallCount += 1
        lastRecordConsentsRequest = requestBody
        switch recordConsentsResult {
        case .success(let response):
            return response
        case .failure(let error):
            throw error
        }
    }

    private(set) var logoutCallCount = 0
    private(set) var lastLogoutToken: String?
    var logoutResult: Result<Void, Error> = .success(())

    func logout(token: String) async throws {
        logoutCallCount += 1
        lastLogoutToken = token
        if case .failure(let error) = logoutResult {
            throw error
        }
    }
}

/// `AppleCredentialStateProviding` mock.
private final class MockAppleCredentialProvider: AppleCredentialStateProviding, @unchecked Sendable {
    var stubState: ASAuthorizationAppleIDProvider.CredentialState = .authorized
    var shouldThrow = false
    private(set) var callCount = 0

    func credentialState(forUserID userID: String) async throws -> ASAuthorizationAppleIDProvider.CredentialState {
        callCount += 1
        if shouldThrow {
            throw NSError(domain: "Test", code: -1, userInfo: nil)
        }
        return stubState
    }
}
