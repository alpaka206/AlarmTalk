import Foundation
import StoreKit

/// 앱이 사용자에게 보여주려고 만든 오류 문구. 일반 LocalizedError는 개발자 진단일 수도 있다.
protocol AppUserFacingError: LocalizedError {
    var userFacingDescription: String? { get }
}

extension AppUserFacingError {
    var userFacingDescription: String? { errorDescription }
}

extension LocalAlarmValidationError: AppUserFacingError {}
extension AudioCacheError: AppUserFacingError {}
extension VoiceRecorderError: AppUserFacingError {}
extension AudioCropper.CropperError: AppUserFacingError {}
extension LocalAlarmAudioError: AppUserFacingError {}
extension SubscriptionManager.SubscriptionError: AppUserFacingError {}
extension RemoteAlarmPushSync.PushError: AppUserFacingError {
    var userFacingDescription: String? {
        self == .noSession ? nil : errorDescription
    }
}

/// 화면의 코드 매핑을 거친 뒤 쓰는 공통 폴백. 언어가 아니라 문구의 출처로 판단한다.
func userFacingErrorMessage(_ error: Error, fallback: String) -> String {
    if isCancellation(error) { return fallback }
    if error is APIError { return fallback }
    if let appError = error as? AppUserFacingError {
        return appError.userFacingDescription ?? fallback
    }
    if let purchaseError = error as? Product.PurchaseError {
        return purchaseError.errorDescription ?? fallback
    }
    if let storeError = error as? StoreKitError {
        if case .networkError = storeError {
            return String(localized: "네트워크가 불안정해요. 잠시 후 다시 시도해 주세요.")
        }
        return fallback
    }
    let nsError = error as NSError
    if nsError.domain == NSURLErrorDomain,
       let description = nsError.userInfo[NSLocalizedDescriptionKey] as? String,
       !description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        return description
    }
    return fallback
}

/// 이 오류가 **취소**인가. `Task` 취소와 URLSession 취소를 함께 본다.
///
/// ⚠ 둘 다 봐야 한다. `Task.isCancelled` 를 호출부에서 검사해도, 이미 날아간
/// URLSession 요청은 `NSURLErrorCancelled` 로 돌아오지 취소 예외로 돌아오지 않는다.
func isCancellation(_ error: Error) -> Bool {
    if error is CancellationError { return true }
    let nsError = error as NSError
    return nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled
}
