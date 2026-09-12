import Foundation

// MARK: - errorCode 매핑
//
// `APIError.server` 응답 안의 error_code 를 목소리 화면의 말로 옮긴다. 안드로이드
// `ui/main/MainViewModelVoiceActions.kt` 의 같은 매핑과 짝이다.
//
// ⚠ **여기에는 목소리 화면에서만 다르게 말할 코드만 둔다.** 나머지는 두 앱이 공유하는
// 표(`APIErrorMessages`)가 받는다 — 같은 코드에 두 벌의 문구를 두면 한쪽만 고쳐진다.
extension VoiceStudioViewModel {
    /// 외부에서도 테스트하기 위해 nonisolated.
    nonisolated func mapVoiceError(_ error: Error) -> String {
        // 1) ServerError.errorCode 가 디코드되어 APIError.server 에 실린 경우.
        if let code = extractServerErrorCode(from: error) {
            return Self.localizedVoiceMessage(forCode: code)
        }
        // 2) URLError / VoiceRecorderError / 일반 메시지.
        if let recorderError = error as? VoiceRecorderError {
            return recorderError.errorDescription ?? "녹음 중 오류가 발생했어요."
        }
        if let urlError = error as? URLError {
            switch urlError.code {
            case .notConnectedToInternet, .networkConnectionLost, .timedOut:
                return "네트워크가 불안정해요. 잠시 후 다시 시도해 주세요."
            default:
                return "연결에 실패했어요. 다시 시도해 주세요."
            }
        }
        if let apiError = error as? APIError {
            switch apiError {
            case .invalidResponse:
                return "서버 응답을 해석하지 못했어요."
            case .server(let status, let message, _):
                let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
                if status == 401 { return "권한이 없어요. 로그인 상태를 확인해 주세요." }
                if status == 403 {
                    return trimmed.containsKorean ? trimmed : "권한이 없어요. 로그인 상태를 확인해 주세요."
                }
                if status >= 500 { return "서버가 응답하지 않아요. 잠시 후 다시 시도해 주세요." }
                return trimmed.containsKorean ? trimmed : "처리 중 오류가 발생했어요."
            }
        }
        return "처리 중 오류가 발생했어요."
    }

    /// 코드 -> 한국어 메시지. 테스트가 직접 호출할 수 있게 static.
    nonisolated static func localizedVoiceMessage(forCode code: String) -> String {
        // 목소리 등록·확정 화면에서만 다르게 말해야 하는 코드들. 나머지는 공용 표가 받는다.
        switch code {
        case "AUDIO_DURATION_TOO_SHORT":
            return String(localized: "음성이 너무 짧아요. 다시 녹음해 주세요.")
        case "VOICE_PROFILE_NOT_FOUND":
            return String(localized: "목소리를 찾지 못했어요. 새로고침 후 다시 시도해 주세요.")
        case "INVALID_VOICE_PROFILE_ID":
            return String(localized: "잘못된 목소리 식별자예요.")
        case "NAME_TOO_LONG":
            return String(localized: "이름은 50자 이내로 입력해 주세요.")
        case "AUDIO_AND_NAME_REQUIRED":
            return String(localized: "음성과 이름을 모두 입력해 주세요.")
        default:
            return APIErrorMessages.message(for: code)
                ?? String(localized: "목소리를 처리하지 못했어요. 잠시 후 다시 시도해 주세요.")
        }
    }

    private nonisolated func extractServerErrorCode(from error: Error) -> String? {
        // 1) 정상 경로 — APIError 가 errorCode 를 보존하고 있다.
        if let apiError = error as? APIError, let code = apiError.serverErrorCode {
            return code
        }
        // 2) 폴백 — message 안에 JSON 또는 raw code 가 박혀 있는 경우.
        guard let apiError = error as? APIError, case .server(_, let message, _) = apiError else {
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
        for code in Self.knownErrorCodes where message.contains(code) {
            return code
        }
        return nil
    }

    /// 응답 본문에서 코드를 **문자열로** 찾아야 하는 폴백용 목록.
    ///
    /// 정상 경로는 `APIError.serverErrorCode` 다. 이 목록은 그게 비었을 때(옛 응답 형태,
    /// 프록시가 본문을 감싼 경우) message 안에서 코드를 긁어내는 마지막 수단이다.
    /// ⚠ 새 코드를 `APIErrorMessages` 에 더했으면 여기에도 더한다 — 안 그러면 그 코드는
    /// 폴백 경로에서 **영영 발견되지 않는다.**
    nonisolated static let knownErrorCodes: [String] = [
        // 목소리 화면 고유
        "AUDIO_DURATION_TOO_SHORT",
        "VOICE_PROFILE_NOT_FOUND",
        "INVALID_VOICE_PROFILE_ID",
        "NAME_TOO_LONG",
        "AUDIO_AND_NAME_REQUIRED",
        // 공용 표가 받는 것들
        "RATE_LIMITED",
        "REQUEST_BODY_TOO_LARGE",
        "INTERNAL_ERROR",
        "ALARM_SCHEMA_UPGRADING",
        "AUTH_INVALID_CREDENTIALS",
        "AUTH_EMAIL_CODE_INVALID",
        "AUTH_EMAIL_CODE_EXPIRED",
        "AUTH_EMAIL_CODE_ATTEMPTS_EXCEEDED",
        "ACCOUNT_PENDING_DELETION",
        "TOKEN_REVOKED",
        "AUTH_TOKEN_EXPIRED",
        "AUTH_USER_NOT_FOUND",
        "VOICE_FEATURE_REQUIRES_PAID_PLAN",
        "VOICE_LOCKED_FREE_PLAN",
        "FREE_PLAN_PRESET_ONLY",
        "BASIC_VOICE_PRESET_ONLY",
        "MANUAL_TTS_QUOTA_EXCEEDED",
        "VOICE_CLONE_AUDIO_TOO_SHORT",
        "VOICE_CLONE_AUDIO_TOO_LONG",
        "INVALID_DURATION",
        "INVALID_AUDIO_MIME_TYPE",
        "VOICE_SLOT_EXHAUSTED",
        "VOICE_CAPACITY_EXHAUSTED",
        "VOICE_LIMIT_REACHED",
        "VOICE_NOT_READY",
        "VOICE_CLONING_FAILED",
        "VOICE_MONTHLY_CHANGE_LIMIT_REACHED",
        "VOICE_PREVIEW_REQUIRED",
        "CONSENT_REQUIRED",
        "ALARM_NOT_FOUND",
        "TTS_GENERATION_FAILED",
    ]
}
