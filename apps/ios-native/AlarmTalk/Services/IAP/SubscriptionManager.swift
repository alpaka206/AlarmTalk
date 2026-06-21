import Foundation
import StoreKit

/// StoreKit2 기반 인앱 구독 관리자.
///
/// Apple App Store 심사 차단 항목 ("디지털 구독은 IAP 필수") 을 해소하기 위한
/// 단일 진입점. 다음을 책임진다.
///
///   - App Store 로부터 `Product` 3종 (personal/couple/family, 월간) fetch.
///   - 사용자 구매 트리거 + 결과 처리 (success/cancelled/pending/failure).
///   - 복원 (Restore Purchases) 흐름.
///   - `Transaction.updates` 비동기 시퀀스 listener — 가족 공유, 환불, 자동 갱신
///     등 외부 트랜잭션이 들어와도 currentTier 가 안전하게 재계산되도록.
///   - 백엔드 entitlement 동기화 (`POST /api/billing/apple/confirm`).
///
/// 백엔드 라우트가 아직 배포되지 않았더라도 클라이언트는 graceful degradation
/// 한다 — Apple StoreKit 영수증이 권위(authoritative) 이고, 백엔드 sync 실패는
/// `lastError` 메시지만 남긴 뒤 다음 foreground 진입 시 자동 재시도된다.
///
/// Race-safety:
///   - listener task 는 `Task.detached` 로 떠 있고 `for await` 안에서 매 트랜잭션을
///     검증 → 백엔드 sync → `transaction.finish()` 순으로 순차 처리한다. 동시에
///     `purchase()` 가 직접 호출돼도 `purchase()` 가 받은 트랜잭션은 자체적으로
///     finish 하므로 listener 가 같은 트랜잭션을 두 번 보더라도 idempotent.
///   - `currentEntitlements` 재읽기는 `refreshPurchasedProducts()` 안에서 항상
///     fresh set 을 구성한 뒤 atomic 하게 published 프로퍼티에 대입한다.
@MainActor
final class SubscriptionManager: ObservableObject {
    @Published private(set) var products: [Product] = []
    @Published private(set) var purchasedProductIDs: Set<String> = []
    @Published private(set) var currentTier: PlanTier = .free
    @Published private(set) var hasLoadedEntitlements: Bool = false
    @Published private(set) var isLoadingProducts: Bool = false
    @Published private(set) var isPurchasing: Bool = false
    @Published private(set) var lastError: String? = nil

    /// 최소 1회 이상 제품 fetch 가 끝났는지. UI 가 "로딩 중 스켈레톤" 과
    /// "정말로 제품이 없음(준비중/실패)" 을 구분하는 데 쓴다.
    /// 첫 진입의 일시적 빈 상태가 망가진 화면처럼 보이지 않도록 게이팅.
    @Published private(set) var hasAttemptedProductFetch: Bool = false

    /// 마지막 제품 fetch 가 (네트워크/StoreKit) 오류로 실패했는지.
    /// 일시적 blip 으로 products 가 비어버린 경우, UI 가 영구 비활성 대신
    /// "다시 시도" 재요청 버튼을 보여줄 수 있게 한다.
    @Published private(set) var productFetchFailed: Bool = false

    private var transactionListenerTask: Task<Void, Never>? = nil
    private let api: AlarmTalkAPI
    private let authProvider: () -> AuthSession?

    /// 백엔드 confirm 이 `success: true` 로 응답한 직후 호출되는 훅.
    /// AlarmTalkApp 이 기존 구독 fetch 경로(`SocialFeatureViewModel` 의
    /// `GET /api/billing/subscription`)를 연결해 서버 구독 상태를 새로고침한다.
    var onServerEntitlementUpdated: (@MainActor () async -> Void)?

    init(api: AlarmTalkAPI, authProvider: @escaping () -> AuthSession?) {
        self.api = api
        self.authProvider = authProvider
        startListeningForTransactions()
    }

    deinit {
        transactionListenerTask?.cancel()
    }

    // MARK: - Public API

    /// 앱 시작 시 1회 호출 — 제품 + 현재 entitlement 상태 동기화.
    func bootstrap() async {
        await fetchProducts()
        await refreshPurchasedProducts()
    }

    /// App Store 로부터 6개 제품 정보 fetch.
    /// 실패해도 fatal 이 아니다 — UI 는 "제품 정보가 없어요" 카드를 보여주고
    /// 다음 진입 시 재시도된다.
    func fetchProducts() async {
        isLoadingProducts = true
        defer {
            isLoadingProducts = false
            hasAttemptedProductFetch = true
        }
        do {
            let allIDs = SubscriptionProduct.allCases.map(\.rawValue)
            let fetched = try await Product.products(for: allIDs)
            self.products = fetched
            self.lastError = nil
            self.productFetchFailed = false
        } catch {
            self.lastError = "제품 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요."
            self.productFetchFailed = true
        }
    }

    /// productID 로 제품 lookup.
    func product(for plan: SubscriptionProduct) -> Product? {
        products.first { $0.id == plan.rawValue }
    }

    /// 사용자가 결제 트리거. UIKit/SwiftUI 어디서든 호출 가능.
    /// 반환값으로 호출자가 UI 토스트/배너를 띄우면 된다.
    func purchase(_ plan: SubscriptionProduct) async -> PurchaseResult {
        guard let product = product(for: plan) else {
            return .failure(reason: "제품 정보가 아직 준비되지 않았어요.")
        }
        guard !isPurchasing else {
            return .failure(reason: "결제가 진행 중이에요.")
        }
        isPurchasing = true
        defer { isPurchasing = false }
        do {
            let result = try await product.purchase()
            switch result {
            case .success(let verificationResult):
                let transaction = try checkVerified(verificationResult)
                await syncWithBackend(
                    transaction: transaction,
                    jwsRepresentation: verificationResult.jwsRepresentation
                )
                await transaction.finish()
                await refreshPurchasedProducts()
                return .success(productID: plan.rawValue)
            case .userCancelled:
                return .userCancelled
            case .pending:
                // SCA / 부모 승인 / 약관 변경 등으로 보류된 상태.
                // 결제는 나중에 `Transaction.updates` listener 로 들어온다.
                return .pending
            @unknown default:
                return .failure(reason: "결제 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.")
            }
        } catch {
            return .failure(
                reason: Self.userFacingPurchaseError(
                    error,
                    fallback: "결제에 실패했어요. 잠시 후 다시 시도해 주세요."
                )
            )
        }
    }

    /// 다른 기기에서 구매한 구독을 현재 기기로 가져온다.
    /// `AppStore.sync()` 는 사용자에게 Apple ID 비밀번호 입력을 강제할 수 있다.
    ///
    /// 호출자가 "복원됨 N건 / 복원할 구매 없음 / 오류" 를 구분해 안내할 수 있도록
    /// `RestoreResult` 를 돌려준다. (이전에는 성공/실패와 무관하게 항상 동일한
    /// "이전 구매를 확인했어요." 토스트만 떠 사용자를 오도하고 심사 리스크가 있었다.)
    @discardableResult
    func restorePurchases() async -> RestoreResult {
        guard !isPurchasing else {
            return .failure(reason: "결제가 진행 중이에요. 잠시 후 다시 시도해 주세요.")
        }
        isPurchasing = true
        defer { isPurchasing = false }
        do {
            try await AppStore.sync()
            // sync 직후 fresh entitlement 를 다시 읽어 활성 구독 수를 센다.
            let restoredCount = await countActiveEntitlements()
            await refreshPurchasedProducts()
            self.lastError = nil
            return restoredCount > 0 ? .restored(count: restoredCount) : .nothingToRestore
        } catch {
            // 에러 메시지는 RestoreResult 로만 노출한다(호출자가 토스트로 안내).
            // lastError 까지 세팅하면 동일 메시지가 화면에 중복 표시되므로 두지 않는다.
            return .failure(
                reason: Self.userFacingPurchaseError(
                    error,
                    fallback: "이전 구매를 복원하지 못했어요. 잠시 후 다시 시도해 주세요."
                )
            )
        }
    }

    /// 현재 verified 활성 entitlement 개수. 복원 결과 안내용.
    private func countActiveEntitlements() async -> Int {
        var count = 0
        for await result in Transaction.currentEntitlements {
            guard (try? checkVerified(result)) != nil else { continue }
            count += 1
        }
        return count
    }

    /// `Transaction.currentEntitlements` 를 다시 읽어 `purchasedProductIDs` 와
    /// `currentTier` 를 atomic 하게 갱신.
    ///
    /// Apple 의 보장:
    ///   - 만료된 자동갱신 구독은 `currentEntitlements` 에서 제외된다.
    ///   - 따라서 별도 만료 체크 로직이 없어도 currentTier 가 자동으로 free 로
    ///     떨어진다.
    func refreshPurchasedProducts() async {
        var newSet: Set<String> = []
        var maxTier: PlanTier = .free
        for await result in Transaction.currentEntitlements {
            guard let transaction = try? checkVerified(result) else { continue }
            newSet.insert(transaction.productID)
            if let plan = SubscriptionProduct.from(productID: transaction.productID) {
                if plan.planTier.tierOrder > maxTier.tierOrder {
                    maxTier = plan.planTier
                }
            }
        }
        self.purchasedProductIDs = newSet
        self.currentTier = maxTier
        self.hasLoadedEntitlements = true
    }

    /// 결제 동기화 재시도 — 백엔드가 일시적으로 다운돼 sync 가 실패한 직후,
    /// 사용자가 BillingPanel 의 "동기화 재시도" 를 누르면 호출.
    /// `currentEntitlements` 의 모든 verified 트랜잭션을 다시 백엔드로 보낸다.
    func resyncEntitlements() async {
        for await result in Transaction.currentEntitlements {
            guard let transaction = try? checkVerified(result) else { continue }
            await syncWithBackend(
                transaction: transaction,
                jwsRepresentation: result.jwsRepresentation
            )
        }
    }

    // MARK: - Private

    /// `Transaction.updates` listener task — 앱 lifetime 내내 떠 있다.
    ///
    /// 진입 케이스:
    ///   - 가족 공유로 다른 가족이 구입한 구독이 이 기기에 propagate.
    ///   - 자동 갱신 (월간/연간 만료 후 다음 사이클 진입).
    ///   - 환불/취소 (`revocationDate` 가 채워진 트랜잭션) — currentEntitlements
    ///     에서 자동 제외되므로 `refreshPurchasedProducts()` 가 알아서 처리.
    ///   - 부모 승인 (Ask to Buy) 가 뒤늦게 승인된 보류 결제.
    ///
    /// 본 task 는 자체적으로 `transaction.finish()` 를 호출해 같은 트랜잭션이
    /// 영원히 큐에 남지 않도록 한다. `purchase()` 가 직접 finish 한 트랜잭션이
    /// 다시 listener 로 들어오는 시나리오는 Apple 이 보장하지 않는다 — 그러나
    /// finish 가 중복 호출돼도 idempotent 하므로 안전.
    private func startListeningForTransactions() {
        transactionListenerTask = Task.detached { [weak self] in
            for await result in Transaction.updates {
                guard let self else { return }
                do {
                    let transaction = try await self.verifyInIsolated(result)
                    await self.syncWithBackend(
                        transaction: transaction,
                        jwsRepresentation: result.jwsRepresentation
                    )
                    await transaction.finish()
                    await self.refreshPurchasedProducts()
                } catch {
                    // 검증 실패 — Apple JWS 서명이 무효한 트랜잭션. 무시.
                }
            }
        }
    }

    /// MainActor isolated 외부에서 호출되는 검증 헬퍼.
    /// `Task.detached` 안에서 self 의 MainActor 메서드를 호출하기 위해 분리.
    nonisolated private func verifyInIsolated<T>(
        _ result: VerificationResult<T>
    ) async throws -> T {
        switch result {
        case .unverified(_, let error):
            throw error
        case .verified(let signed):
            return signed
        }
    }

    private func checkVerified<T>(_ result: VerificationResult<T>) throws -> T {
        switch result {
        case .unverified(_, let error):
            throw error
        case .verified(let signed):
            return signed
        }
    }

    /// 백엔드에 Apple transaction ID 를 전송해 서버 측 entitlement 를 동기화한다.
    ///
    /// 실패 시:
    ///   - StoreKit 영수증이 권위이므로 클라이언트 currentTier 는 이미 정확.
    ///   - 백엔드의 plan/subscription row 가 갱신되지 않을 뿐. 사용자에게는
    ///     "결제 확인 동기화 실패 — 자동 재시도됩니다" 메시지만 노출.
    ///   - 다음 foreground 진입 또는 `resyncEntitlements()` 호출 시 재시도.
    ///
    /// 백엔드 라우트가 아직 구현되지 않은 경우 (404/501) 나 점검 중(503):
    ///   - 동일한 graceful degradation. 사용자는 IAP 결제 완료 자체는 영수증으로
    ///     보장되며, 백엔드 동기화는 라우트 배포 후 자동으로 catch-up 된다.
    ///
    /// 페이로드에는 transaction id 들과 함께 `jws_representation`
    /// (`VerificationResult.jwsRepresentation` — Apple 이 서명한 raw JWS) 을 동봉해
    /// 서버가 서명 검증만으로 트랜잭션 진위를 확인할 수 있게 한다.
    private func syncWithBackend(transaction: Transaction, jwsRepresentation: String?) async {
        guard let session = authProvider() else {
            // 로그아웃 상태에서 가족공유 등으로 들어온 트랜잭션. 재로그인 후
            // resyncEntitlements 로 catch-up 한다.
            return
        }
        do {
            let response = try await api.confirmAppleSubscription(
                transactionID: String(transaction.id),
                originalTransactionID: String(transaction.originalID),
                productID: transaction.productID,
                jwsRepresentation: jwsRepresentation,
                token: session.token
            )
            self.lastError = nil
            if response.success {
                // 서버가 entitlement 를 갱신했으므로 기존 구독 fetch 경로로
                // 클라이언트 측 서버 구독 상태도 새로고침한다.
                await onServerEntitlementUpdated?()
            }
        } catch APIError.server(let status, _, _) where status == 501 || status == 503 {
            // 라우트 미구현(501) / 일시 점검(503) — 비파괴 처리. StoreKit 영수증이
            // 권위이므로 로컬 entitlement(currentTier) 는 그대로 유지하고, 사용자
            // 노출 에러 없이 다음 foreground 사이클의 resyncEntitlements 가
            // 자동 catch-up 한다.
        } catch {
            self.lastError = "결제 확인 동기화에 실패했어요. 잠시 후 자동 재시도됩니다."
        }
    }

    private static func userFacingPurchaseError(_ error: Error, fallback: String) -> String {
        let message = error.localizedDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        return message.containsKorean ? message : fallback
    }
}

/// `SubscriptionManager.purchase(_:)` 가 호출자에게 돌려주는 결과 종류.
///
/// `failure` 는 일반적 에러. `pending` 은 Ask-to-Buy / SCA / 약관 동의 대기.
/// `userCancelled` 는 사용자가 결제 시트에서 취소.
enum PurchaseResult: Equatable {
    case success(productID: String)
    case userCancelled
    case pending
    case failure(reason: String)

    var isSuccess: Bool {
        if case .success = self { return true }
        return false
    }

    /// UI 토스트 메시지.
    var userMessage: String {
        switch self {
        case .success:        return "결제가 완료되었어요."
        case .userCancelled:  return "결제를 취소했어요."
        case .pending:        return "결제 승인 대기 중이에요."
        case .failure(let r): return r
        }
    }
}

/// `SubscriptionManager.restorePurchases()` 결과.
///
/// - `restored`: 복원된 활성 구독이 N건 있었음.
/// - `nothingToRestore`: sync 는 성공했지만 이 Apple ID 로 복원할 구매가 없음.
/// - `failure`: sync 자체가 실패(네트워크/취소 등).
enum RestoreResult: Equatable {
    case restored(count: Int)
    case nothingToRestore
    case failure(reason: String)

    var isSuccess: Bool {
        switch self {
        case .restored, .nothingToRestore: return true
        case .failure:                     return false
        }
    }

    /// UI 토스트 메시지 — 세 가지 결과를 명확히 구분해 안내한다.
    var userMessage: String {
        switch self {
        case .restored(let count): return "이전 구매 \(count)건을 복원했어요."
        case .nothingToRestore:    return "복원할 구매 내역이 없어요."
        case .failure(let r):      return r
        }
    }
}

