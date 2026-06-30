import Foundation

/// API/네트워크 에러를 사용자에게 보여줄 한국어 메시지로 변환한다.
/// 서버 메시지에 한국어가 있으면 그대로, 없으면 `fallback` 을 쓴다.
///
/// AuthViewModel / RemoteAlarmSyncViewModel / SocialFeatureViewModel 에 동일하게
/// 복붙돼 있던 구현을 단일 출처로 통합한 것.
func userFacingErrorMessage(_ error: Error, fallback: String) -> String {
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
