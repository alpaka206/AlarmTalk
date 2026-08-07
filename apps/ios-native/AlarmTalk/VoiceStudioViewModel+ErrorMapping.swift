import Foundation

// MARK: - errorCode 매핑
//
// Android `MainViewModelVoiceActions.kt:184-190` 의 mapping 을 그대로 옮긴다. 본 매퍼는
// `APIError.server` 응답 body 안의 error_code 를 한국어 메시지로 변환한다. 해당 코드가
// 없거나 모르는 코드인 경우 generic fallback 메시지를 반환한다.
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
        switch code {
        case "MANUAL_TTS_QUOTA_EXCEEDED":
            // 안드로이드 `editor_error_manual_tts_quota` 와 같은 뜻이어야 한다.
            return "이번 달 직접 입력 문구 만들기 횟수를 다 썼어요. 다음 달에 다시 채워져요."
        case "VOICE_SLOT_EXHAUSTED":
            return "지금은 목소리 생성 요청이 많아요. 잠시 후 다시 시도해 주세요."
        case "VOICE_FEATURE_REQUIRES_PAID_PLAN":
            return "유료 이용권에서 사용할 수 있어요."
        case "VOICE_CLONE_AUDIO_TOO_SHORT":
            return "목소리를 만들 음성은 12초 이상이어야 해요."
        case "VOICE_CLONE_AUDIO_TOO_LONG":
            return "목소리를 만들 음성은 2분 이하로 준비해 주세요."
        case "INVALID_DURATION":
            return "음성 길이를 확인하지 못했어요. 파일을 다시 선택해 주세요."
        case "VOICE_LIMIT_REACHED":
            return "이번 달 목소리 생성 한도를 모두 사용했어요."
        case "AUDIO_DURATION_TOO_SHORT":
            return "음성이 너무 짧아요. 다시 녹음해 주세요."
        case "VOICE_PROFILE_NOT_FOUND":
            return "목소리를 찾지 못했어요. 새로고침 후 다시 시도해 주세요."
        case "INVALID_VOICE_PROFILE_ID":
            return "잘못된 목소리 식별자예요."
        case "NAME_TOO_LONG":
            return "이름은 50자 이내로 입력해 주세요."
        case "AUDIO_AND_NAME_REQUIRED":
            return "음성과 이름을 모두 입력해 주세요."
        default:
            return "목소리를 처리하지 못했어요. 잠시 후 다시 시도해 주세요."
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

    nonisolated static let knownErrorCodes: [String] = [
        "VOICE_SLOT_EXHAUSTED",
        "VOICE_FEATURE_REQUIRES_PAID_PLAN",
        "VOICE_CLONE_AUDIO_TOO_SHORT",
        "VOICE_CLONE_AUDIO_TOO_LONG",
        "INVALID_DURATION",
        "VOICE_LIMIT_REACHED",
        "AUDIO_DURATION_TOO_SHORT",
        "VOICE_PROFILE_NOT_FOUND",
        "INVALID_VOICE_PROFILE_ID",
        "NAME_TOO_LONG",
        "AUDIO_AND_NAME_REQUIRED",
    ]
}

