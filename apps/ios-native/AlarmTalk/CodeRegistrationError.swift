import Foundation

/// 코드 등록 실패를 사유별로 현재 앱 언어에 맞춰 표시한다.
/// 안드로이드 `codeRegistrationFailureMessage`와 같은 코드·문구를 쓴다.
/// 서버 원문 대신 화면 전용 표 또는 호출부의 고정 폴백을 쓴다.
/// 바우처(선물·초대)와 가족 초대 갈래를 한 표에 둔다. 프로모 코드 갈래는 2026-10-12 에 없앴다
/// (App Store 지침 3.1.1 — 서버가 더는 받지 않는다).
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

    /// 안드로이드 `msg2_code_fail_*` 와 **같은 문구**다.
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

        // 그룹 이용권 주인은 다른 사람이 함께 쓰는 동안 새 코드를 등록할 수 없다(`lib/voucher-redemption.ts`).
        "OWNS_ACTIVE_GROUP": String(localized: "이미 이용 중인 그룹 이용권이 있어 이 코드를 등록할 수 없어요"),
    ] }
}
