import Foundation

/// 코드 등록 실패를 **사유별 한국어 문구**로 옮긴다.
/// 안드로이드 `ui/main/MainViewModelBillingActions.kt` 의 `codeRegistrationFailureMessage`.
///
/// ⚠ **서버 메시지를 그대로 보여주면 안 된다.** 백엔드는
/// `VoucherRedemptionError(409, 'CODE_EXPIRED', 'Code is expired')` 처럼 **영어**를 던진다
/// (`packages/backend/src/lib/voucher-redemption.ts`). iOS 는 `userFacingErrorMessage` 가
/// "한국어면 서버 메시지, 아니면 폴백" 규칙이라, 이 매핑이 없으면 만료·중복·정원초과·
/// 본인코드·오타가 **전부 "코드 등록에 실패했어요." 한 줄**로 보였다 — 무엇을 고쳐야
/// 하는지 알 수 없어 같은 코드를 계속 다시 넣게 된다.
///
/// 통합 엔드포인트(`POST /code/register`)가 바우처·가족 초대·프로모를 모두 처리하므로
/// 세 갈래의 에러 코드를 한 표에 둔다.
enum CodeRegistrationError {

    /// - Parameters:
    ///   - error: `AlarmTalkAPI` 가 던진 오류. `APIError.server` 가 아니면 폴백.
    ///   - fallback: 표에 없는 코드일 때 보여줄 문구.
    static func message(for error: Error, fallback: String) -> String {
        guard case let APIError.server(_, serverMessage, errorCode) = error else {
            return userFacingErrorMessage(error, fallback: fallback)
        }
        if let errorCode, let known = table[errorCode] {
            return known
        }
        // 표에 없는 코드라도 서버가 한국어를 줬다면 그게 폴백보다 낫다.
        return serverMessage.containsKorean ? serverMessage : fallback
    }

    /// 안드로이드 `msg2_code_fail_*` · `msg2_promo_fail_*` 와 **같은 문구**다.
    /// 한쪽만 고치지 말 것 — 같은 실패를 두 플랫폼이 다르게 설명하게 된다.
    private static let table: [String: String] = [
        // 바우처(선물·초대) 갈래
        "CODE_REQUIRED": "코드를 입력해 주세요",
        "INVALID_FORMAT": "코드 형식을 확인해 주세요",
        "CODE_NOT_FOUND": "잘못된 코드입니다.",
        "CODE_EXPIRED": "만료된 코드예요",
        "CODE_ALREADY_USED": "이미 사용된 코드예요",
        "CODE_ALREADY_REDEEMED_BY_YOU": "이미 등록한 코드예요",
        // 서버가 두 이름을 쓴다(발급자 본인 / 수락자 본인) — 사용자에게는 같은 뜻이다.
        "SELF_ISSUED": "본인이 발급한 코드는 등록할 수 없어요",
        "SELF_ACCEPT": "본인이 발급한 코드는 등록할 수 없어요",
        "GROUP_FULL": "이미 정원이 찬 코드예요",
        "INVALID_GIFT_PLAN": "코드와 이용권 종류가 맞지 않아요",
        "INVALID_INVITE_PLAN": "코드와 이용권 종류가 맞지 않아요",
        "PLAN_NOT_FOUND": "코드의 이용권 정보를 찾지 못했어요",
        "USER_NOT_FOUND": "로그인 정보를 다시 확인해 주세요",

        // 가족 그룹 초대 갈래
        "CODE_REVOKED": "취소된 코드예요",
        "ALREADY_MEMBER": "이미 함께 쓰고 있는 그룹이에요",

        // 프로모 갈래
        "CODE_INACTIVE": "지금은 사용할 수 없는 프로모 코드예요",
        "CODE_NOT_IN_WINDOW": "아직 사용 기간이 아니거나 종료된 프로모 코드예요",
        "CODE_EXHAUSTED": "사용 가능 횟수가 모두 소진된 프로모 코드예요",
        // 리딤 그룹(예: 웰컴 3종) — 같은 계열 코드를 이미 썼으면 다른 코드도 불가.
        "CODE_GROUP_ALREADY_REDEEMED":
            "이미 같은 계열의 프로모 코드를 사용했어요. 이 혜택은 계정당 한 번만 받을 수 있어요",
        "OWNS_ACTIVE_GROUP": "이미 이용 중인 그룹 이용권이 있어 프로모 코드를 적용할 수 없어요",
        "ACTIVE_SUBSCRIPTION_EXISTS": "이용 중인 이용권이 있어요. 해지 후 쿠폰을 등록할 수 있어요",
        "PROMO_REDEEM_FAILED": "프로모 코드를 적용하지 못했어요. 잠시 후 다시 시도해 주세요",
    ]
}
