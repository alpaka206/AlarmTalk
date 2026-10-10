import Foundation

/// 코드 등록 실패를 사유별로 현재 앱 언어에 맞춰 표시한다.
/// 안드로이드 `codeRegistrationFailureMessage`와 같은 코드·문구를 쓴다.
/// 서버 원문 대신 화면 전용 표 또는 호출부의 고정 폴백을 쓴다.
/// 통합 엔드포인트의 바우처·가족 초대·프로모 세 갈래를 한 표에 둔다.
enum CodeRegistrationError {

    /// - Parameters:
    ///   - error: `AlarmTalkAPI` 가 던진 오류. `APIError.server` 가 아니면 폴백.
    ///   - fallback: 표에 없는 코드일 때 보여줄 문구.
    static func message(for error: Error, fallback: String) -> String {
        if case let APIError.server(_, _, errorCode?) = error, let known = table[errorCode] {
            return known
        }
        // 화면 표에 없는 코드는 일반 오류 헬퍼와 호출부 폴백으로 처리한다. 서버 원문은 노출하지 않는다.
        return userFacingErrorMessage(error, fallback: fallback)
    }

    /// 안드로이드 `msg2_code_fail_*` · `msg2_promo_fail_*` 와 **같은 문구**다.
    /// 한쪽만 고치지 말 것 — 같은 실패를 두 플랫폼이 다르게 설명하게 된다.
    private static var table: [String: String] { [
        // 바우처(선물·초대) 갈래
        "CODE_REQUIRED": String(localized: "코드를 입력해 주세요"),
        "INVALID_FORMAT": String(localized: "코드 형식을 확인해 주세요"),
        "CODE_NOT_FOUND": String(localized: "잘못된 코드입니다."),
        "CODE_EXPIRED": String(localized: "만료된 코드예요"),
        "CODE_ALREADY_USED": String(localized: "이미 사용된 코드예요"),
        "CODE_ALREADY_REDEEMED_BY_YOU": String(localized: "이미 등록한 코드예요"),
        // 서버가 두 이름을 쓴다(발급자 본인 / 수락자 본인) — 사용자에게는 같은 뜻이다.
        "SELF_ISSUED": String(localized: "본인이 발급한 코드는 등록할 수 없어요"),
        "SELF_ACCEPT": String(localized: "본인이 발급한 코드는 등록할 수 없어요"),
        "GROUP_FULL": String(localized: "이미 정원이 찬 코드예요"),
        "INVALID_GIFT_PLAN": String(localized: "코드와 이용권 종류가 맞지 않아요"),
        "INVALID_INVITE_PLAN": String(localized: "코드와 이용권 종류가 맞지 않아요"),
        "PLAN_NOT_FOUND": String(localized: "코드의 이용권 정보를 찾지 못했어요"),
        "USER_NOT_FOUND": String(localized: "로그인 정보를 다시 확인해 주세요"),

        // 가족 그룹 초대 갈래
        "CODE_REVOKED": String(localized: "취소된 코드예요"),
        "ALREADY_MEMBER": String(localized: "이미 함께 쓰고 있는 그룹이에요"),

        // 프로모 갈래
        "CODE_INACTIVE": String(localized: "지금은 사용할 수 없는 프로모 코드예요"),
        "CODE_NOT_IN_WINDOW": String(localized: "아직 사용 기간이 아니거나 종료된 프로모 코드예요"),
        "CODE_EXHAUSTED": String(localized: "사용 가능 횟수가 모두 소진된 프로모 코드예요"),
        // 리딤 그룹(운영자가 `redemption_group` 으로 묶은 코드들) — 같은 계열 코드를 이미
        // 썼으면 다른 코드도 불가. 코드 이름을 바꾸지 말 것 — 계약이다.
        "CODE_GROUP_ALREADY_REDEEMED":
            String(localized: "이미 같은 계열의 프로모 코드를 사용했어요. 이 혜택은 계정당 한 번만 받을 수 있어요"),
        "OWNS_ACTIVE_GROUP": String(localized: "이미 이용 중인 그룹 이용권이 있어 프로모 코드를 적용할 수 없어요"),
        "ACTIVE_SUBSCRIPTION_EXISTS": String(localized: "이용 중인 이용권이 있어요. 해지 후 쿠폰을 등록할 수 있어요"),
        "PROMO_REDEEM_FAILED": String(localized: "프로모 코드를 적용하지 못했어요. 잠시 후 다시 시도해 주세요"),
    ] }
}
