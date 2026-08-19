import Foundation

/// 초대 코드·이용권 코드를 남에게 보낼 때의 공유 문구.
///
/// ⚠ **코드만 보내지 말 것.** 예전에는 두 공유 시트가 `voucher.code` 문자열 하나만
/// 넘겼다(`MemberManagementView` / `VoucherShareSelectionSheet`). 받는 사람 화면에는
/// `A1B2C3D4` 같은 여덟 글자만 떠서, 이게 무엇인지·어디에 넣는지·앱을 어디서 받는지
/// 알 방법이 전혀 없었다. 안드로이드는 처음부터 설치 안내까지 함께 보냈다
/// (`values/strings.xml` 의 `share_code_invite_body`·`share_code_gift_body`) —
/// 「iOS 는 안드로이드를 원본으로 삼는다」 규약대로 iOS 가 틀린 쪽이다.
///
/// ⚠ **링크는 스토어가 아니라 랜딩(`alarm-talk.com`)으로 보낸다.** 안드로이드는 Play
/// 주소를 직접 넣지만 iOS 는 그럴 수 없다:
///   - 받는 사람이 어느 기기인지 모른다. iPhone 사용자가 보낸 코드를 Android 친구가
///     받는 경우가 오히려 흔하다(가족 이용권이 그런 물건이다).
///   - App Store 주소는 숫자 앱 ID 가 있어야 만들 수 있는데(`apps.apple.com/app/id…`),
///     그 값은 앱이 스토어에 올라간 뒤에 정해진다. `lib/app-version.ts` 의 iOS
///     `storeUrl` 이 아직 자리표시자인 것과 같은 이유다.
/// 랜딩은 두 배지를 한 자리에서 관리하므로(`apps/landing/lib/site.ts` 의 `STORE_LINKS`),
/// 출시 때 고칠 곳이 세 군데가 아니라 한 군데다.
enum CodeShareText {

    /// 설치 안내에 쓰는 주소. 랜딩 한 곳만 가리킨다 — 위 주석 참조.
    static let installURL = "https://alarm-talk.com"

    /// 가족·커플 초대 코드 공유. 안드로이드 `share_code_invite_body` 대응.
    static func invite(code: String) -> String {
        String(
            format: String(
                localized: "알람톡에서 내 목소리 알람을 같이 쓰자!\n\n초대 코드: %1$@\n\n1. 알람톡 설치 %2$@\n2. 가입하고 로그인\n3. 더보기 → 코드 등록에 위 코드 입력"
            ),
            code,
            installURL
        )
    }

    /// 코드 생김새로 종류를 가른다. 안드로이드 `ui/billing/BillingPanels.kt` 의
    /// `shareVoucher` 와 **같은 판정**이어야 한다 — `INV-` 는 가족·커플 합류,
    /// `GIFT-` 는 개인 이용권 선물이라 받는 사람이 할 일이 다르다.
    static func forCode(_ code: String) -> String {
        code.uppercased().hasPrefix("GIFT-") ? gift(code: code) : invite(code: code)
    }

    /// 선물한 이용권 코드 공유. 안드로이드 `share_code_gift_body` 대응.
    static func gift(code: String) -> String {
        String(
            format: String(
                localized: "알람톡 이용권을 보냈어요.\n\n이용권 코드: %1$@\n\n1. 알람톡 설치 %2$@\n2. 가입하고 로그인\n3. 더보기 → 코드 등록에 위 코드 입력"
            ),
            code,
            installURL
        )
    }
}
