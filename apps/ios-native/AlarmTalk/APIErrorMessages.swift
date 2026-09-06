import Foundation

/// **에러 코드 → 사용자에게 보여 줄 문구.**
///
/// 서버는 4xx/5xx 에서 `error_code` 를 함께 내려준다(목록은
/// `packages/shared/src/schemas/error-codes.ts`). 그 코드로 문구를 고르는 이유는 두 가지다:
///
/// 1. **서버 문장은 우리 말이 아니다.** 상당수가 영어이고("Voice profile not found") 번역도
///    없다. 예전에는 `containsKorean` 휴리스틱으로 걸러 냈는데, 그건 서버가 한국어를 쓰는
///    동안만 맞는 이야기다.
/// 2. **같은 실패에 늘 같은 말을 하려면** 문구가 화면이 아니라 코드에 붙어야 한다.
///
/// ⚠ **화면별 문구가 우선이다.** 이 표는 **마지막에서 두 번째** 층이다 — 목소리 화면처럼
/// 자기 맥락에 맞는 말을 가진 곳(`VoiceStudioViewModel+ErrorMapping`)이 이기고, 여기는
/// **아무도 안 맡은 코드**를 받는다. 층은 셋: 화면별 매핑 → 이 표 → 일반 폴백 문장.
///
/// ⚠ **안드로이드 `network/ApiErrorMessages.kt` 와 같은 표다.** 한쪽에만 코드를 더하면
/// 같은 실패가 두 앱에서 다르게 읽힌다 — 「iOS 는 안드로이드를 원본으로 삼는다」.
enum APIErrorMessages {
    /// 이 코드에 정해 둔 문구. 없으면 nil — 부르는 쪽이 자기 폴백을 쓴다.
    ///
    /// ⚠ **모든 코드에 문구를 둘 필요는 없다.** `INVALID_JSON` 처럼 사용자가 할 수 있는 게
    /// 없는 것은 비워 두고 폴백에 맡긴다 — 억지로 채우면 알아들을 수 없는 말이 늘어난다.
    static func message(for code: String?) -> String? {
        guard let code else { return nil }
        switch code {
        // ── 공통 ──────────────────────────────────────────────────────────
        case "RATE_LIMITED":
            return String(localized: "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.")
        case "REQUEST_BODY_TOO_LARGE":
            return String(localized: "보내려는 파일이 너무 커요. 더 짧게 녹음해 주세요.")
        case "INTERNAL_ERROR":
            return String(localized: "잠시 문제가 생겼어요. 잠시 후 다시 시도해 주세요.")
        case "ALARM_SCHEMA_UPGRADING":
            return String(localized: "서버를 업데이트하고 있어요. 잠시 후 다시 시도해 주세요.")

        // ── 로그인·계정 ───────────────────────────────────────────────────
        case "AUTH_INVALID_CREDENTIALS":
            return String(localized: "이메일 또는 비밀번호를 확인해 주세요.")
        case "AUTH_EMAIL_CODE_INVALID":
            return String(localized: "인증 코드가 맞지 않아요. 다시 확인해 주세요.")
        case "AUTH_EMAIL_CODE_EXPIRED":
            return String(localized: "인증 코드가 만료됐어요. 다시 받아 주세요.")
        case "AUTH_EMAIL_CODE_ATTEMPTS_EXCEEDED":
            return String(localized: "인증 코드를 너무 많이 틀렸어요. 다시 받아 주세요.")
        case "ACCOUNT_PENDING_DELETION":
            return String(localized: "탈퇴 신청 중인 계정이에요. 탈퇴를 취소하면 다시 쓸 수 있어요.")
        // 세션이 끊긴 셋. 앱은 자동 로그아웃으로도 처리하지만, 그 사이 문구가 뜨면
        // "다시 로그인" 이라고 말해야 사용자가 무슨 일인지 안다.
        case "TOKEN_REVOKED", "AUTH_TOKEN_EXPIRED", "AUTH_USER_NOT_FOUND":
            return String(localized: "로그인이 만료됐어요. 다시 로그인해 주세요.")

        // ── 이용권 게이트 ─────────────────────────────────────────────────
        case "VOICE_FEATURE_REQUIRES_PAID_PLAN":
            return PaidGateCopy.message
        case "VOICE_LOCKED_FREE_PLAN":
            return String(localized: "무료 이용권으로 바뀌어 이 목소리를 쓸 수 없어요. 이용권을 다시 등록하면 돌아와요.")
        case "FREE_PLAN_PRESET_ONLY", "BASIC_VOICE_PRESET_ONLY":
            return String(localized: "기본 목소리는 준비된 문구로만 말할 수 있어요. 직접 입력한 문구로 깨우려면 내 목소리를 골라 주세요.")
        case "MANUAL_TTS_QUOTA_EXCEEDED":
            return String(localized: "이번 달 직접 입력 문구 만들기 횟수를 다 썼어요. 다음 달에 다시 채워져요.")

        // ── 목소리 ────────────────────────────────────────────────────────
        case "VOICE_CLONE_AUDIO_TOO_SHORT":
            return String(localized: "목소리를 만들 음성은 12초 이상이어야 해요.")
        case "VOICE_CLONE_AUDIO_TOO_LONG":
            return String(localized: "목소리를 만들 음성은 2분 이하로 준비해 주세요.")
        case "INVALID_DURATION":
            return String(localized: "음성 길이를 확인하지 못했어요. 파일을 다시 선택해 주세요.")
        case "INVALID_AUDIO_MIME_TYPE":
            return String(localized: "지원하지 않는 오디오 형식이에요. 다시 녹음해 주세요.")
        case "VOICE_SLOT_EXHAUSTED", "VOICE_CAPACITY_EXHAUSTED":
            return String(localized: "지금은 목소리 생성 요청이 많아요. 잠시 후 다시 시도해 주세요.")
        case "VOICE_LIMIT_REACHED":
            return String(localized: "등록할 수 있는 목소리를 다 채웠어요. 쓰지 않는 목소리를 지워 주세요.")
        case "VOICE_NOT_READY":
            return String(localized: "목소리를 아직 만들고 있어요. 잠시 후 다시 시도해 주세요.")
        case "VOICE_CLONING_FAILED":
            return String(localized: "목소리를 만들지 못했어요. 조용한 곳에서 다시 녹음해 주세요.")
        case "VOICE_MONTHLY_CHANGE_LIMIT_REACHED":
            return String(localized: "목소리는 한 달에 1번만 바꿀 수 있어요. 다음 달에 다시 시도해 주세요.")
        case "VOICE_PREVIEW_REQUIRED":
            return String(localized: "문구가 바뀌었어요. 새 문구를 끝까지 들어본 뒤 저장해 주세요.")
        case "CONSENT_REQUIRED":
            return String(localized: "목소리를 만들려면 음성 정보 활용 동의가 필요해요. 더보기 → 약관 및 동의에서 다시 동의해 주세요.")

        // ── 알람·문구 ─────────────────────────────────────────────────────
        case "ALARM_NOT_FOUND":
            return String(localized: "이미 사라진 알람이에요.")
        case "TTS_GENERATION_FAILED":
            return String(localized: "음성을 만들지 못했어요. 잠시 후 다시 시도해 주세요.")

        default:
            return nil
        }
    }
}
