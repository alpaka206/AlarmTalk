import XCTest
@testable import AlarmTalk

/// "한 번 로그인하면 다시 안 해도 된다" 를 지키는 판정.
///
/// ⚠ 안드로이드 `SessionTokenRenewalTest.kt` 와 **같은 경우**를 검사한다. 두 플랫폼의
/// 임계값·판정이 갈라지면 한쪽만 조용히 로그아웃된다.
final class SessionTokenRenewalTests: XCTestCase {

    /// 서명 없이 payload 만 있는 가짜 JWT — 판정은 `exp` 만 읽으므로 이걸로 충분하다.
    private func token(expiresIn seconds: TimeInterval) -> String {
        let exp = Int(Date().addingTimeInterval(seconds).timeIntervalSince1970)
        let payload = try! JSONSerialization.data(withJSONObject: ["exp": exp])
        let encoded = payload.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        return "header.\(encoded).signature"
    }

    func test_expiresAt_readsExpClaim() {
        let expected = Date().addingTimeInterval(3600)
        let parsed = SessionTokenRenewal.expiresAt(token: token(expiresIn: 3600))
        XCTAssertNotNil(parsed)
        XCTAssertEqual(parsed!.timeIntervalSince1970, expected.timeIntervalSince1970, accuracy: 2)
    }

    /// 방금 발급된 토큰(365일)은 건드리지 않는다 — 매 회차 `/auth/me` 를 때리면
    /// 기기당 하루 96회다.
    func test_freshToken_isNotRenewed() {
        XCTAssertFalse(SessionTokenRenewal.shouldRenew(token: token(expiresIn: 365 * 24 * 3600)))
    }

    /// 임계값(90일)을 지나면 갱신한다.
    func test_tokenNearingExpiry_isRenewed() {
        XCTAssertTrue(SessionTokenRenewal.shouldRenew(token: token(expiresIn: 80 * 24 * 3600)))
    }

    func test_expiredToken_isRenewed() {
        XCTAssertTrue(SessionTokenRenewal.shouldRenew(token: token(expiresIn: -3600)))
    }

    /// ⚠ 핵심: **못 읽으면 갱신한다.** false 로 답하면 갱신이 영영 안 돌아
    /// 조용한 로그아웃으로 끝난다.
    func test_unparseableToken_isRenewed() {
        XCTAssertTrue(SessionTokenRenewal.shouldRenew(token: "not-a-jwt"))
        XCTAssertTrue(SessionTokenRenewal.shouldRenew(token: "a.b.c"))
        XCTAssertTrue(SessionTokenRenewal.shouldRenew(token: "header.eyJzdWIiOiJ4In0.sig")) // exp 없음
    }

    /// 세션이 없는 상태(빈 토큰)에서 헛되이 네트워크를 때리지 않는다.
    func test_emptyToken_isNotRenewed() {
        XCTAssertFalse(SessionTokenRenewal.shouldRenew(token: ""))
    }

    /// base64url 은 `-`/`_` 를 쓰고 패딩이 없다 — 표준 디코더로는 못 읽는다.
    func test_base64URLWithoutPadding_decodes() {
        // exp 값을 바꿔 가며 payload 길이(=패딩 필요량)를 흔든다.
        for seconds in [1.0, 61.0, 3601.0, 86_401.0] {
            XCTAssertNotNil(
                SessionTokenRenewal.expiresAt(token: token(expiresIn: seconds)),
                "패딩 길이 \(seconds) 에서 디코딩 실패"
            )
        }
    }
}
