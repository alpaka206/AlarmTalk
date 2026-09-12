import XCTest
@testable import AlarmTalk

/// delivery 태그 벗기기 — 안드로이드 `DeliveryTagStripTest` 와 **같은 규칙**이다.
///
/// ⚠ iOS 에는 2026-08-13 까지 이 기능이 **아예 없었다.** 서버가 준 문구를 그대로 화면에
/// 올려서, 태그가 섞인 행은 잠금화면·Live Activity 에 대괄호가 그대로 보였다.
final class DeliveryTagsTests: XCTestCase {

    func test_생성물의_태그를_벗긴다() {
        XCTAssertEqual(DeliveryTags.strip("[cheerfully] 잘 잤어?", generated: true), "잘 잤어?")
    }

    /// 태그 어휘는 **열린 집합**이다 — 철자 목록으로는 못 따라간다.
    func test_목록에_없던_어휘도_벗긴다() {
        XCTAssertEqual(
            DeliveryTags.strip("[shouting] 일어나! [laughs nervously] 힘내자.", generated: true),
            "일어나! 힘내자."
        )
    }

    /// 쉼표가 든 두 마디 지시. 쉼표를 빼면 **매치조차 안 돼** 그대로 샌다.
    func test_쉼표가_든_태그도_벗긴다() {
        XCTAssertEqual(
            DeliveryTags.strip("[measured, deliberate] I am ready.", generated: true),
            "I am ready."
        )
    }

    /// ⚠ **판정 축은 출처 하나다.** 사용자가 친 대괄호는 지우면 저장 시 영구 소실된다.
    func test_사용자_문구는_손대지_않는다() {
        let text = "[after lunch] take medicine"
        XCTAssertEqual(DeliveryTags.strip(text, generated: false), text)
    }

    /// 벗길 게 없으면 **공백 정리조차** 하지 않는다 — 이 값이 그대로 다시 저장된다.
    func test_벗길_게_없으면_원문_그대로() {
        let text = "  일어나  규원아  "
        XCTAssertEqual(DeliveryTags.strip(text, generated: true), text)
    }

    /// 비우면 편집기가 저장을 막아 그 알람을 고치지도 지우지도 못하게 된다.
    func test_태그만_있는_문구는_비우지_않는다() {
        XCTAssertEqual(DeliveryTags.strip("[calm]", generated: true), "[calm]")
    }
}
