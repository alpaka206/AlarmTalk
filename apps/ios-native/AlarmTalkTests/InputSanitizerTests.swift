import XCTest
@testable import AlarmTalk

/// `InputSanitizer` 회귀 테스트.
///
/// 안드로이드 `InputSanitizerTest.kt` 및 서버 `packages/shared/test/schemas.test.ts` 와
/// 같은 케이스를 본다. 세 곳의 규칙이 갈라지면 **가장 느슨한 경로가 실질 규칙이 된다**
/// (CLAUDE.md 「입력 규칙은 한 곳에서만」).
final class InputSanitizerTests: XCTestCase {

    // MARK: - 상한은 서버와 같아야 한다

    func test_limits_matchServer() {
        // packages/shared/src/schemas/auth.ts 의 DISPLAY_NAME_MAX_LENGTH / VOICE_NAME_MAX_LENGTH.
        // 앱이 더 느슨하면 서버가 거절하고, 더 빡빡하면 서버가 허용하는 이름을 못 쓴다.
        XCTAssertEqual(InputSanitizer.displayNameMaxLength, 30)
        XCTAssertEqual(InputSanitizer.voiceNameMaxLength, 50)
    }

    // MARK: - 거르는 것

    func test_stripsControlCharacters() {
        // 로그·CSV 를 깨고 TTS 낭독을 망친다.
        XCTAssertEqual(InputSanitizer.sanitizeDisplayName("김\u{0000}규원"), "김규원")
        XCTAssertEqual(InputSanitizer.sanitizeDisplayName("김\u{0007}규원"), "김규원")
        XCTAssertEqual(InputSanitizer.sanitizeDisplayName("김\u{009F}규원"), "김규원")
    }

    func test_stripsZeroWidth() {
        // 눈에 같아 보이는데 다른 값이라 사칭에 쓰인다.
        XCTAssertEqual(InputSanitizer.sanitizeDisplayName("김\u{200B}규원"), "김규원")
        XCTAssertEqual(InputSanitizer.sanitizeDisplayName("김\u{FEFF}규원"), "김규원")
        XCTAssertEqual(InputSanitizer.sanitizeDisplayName("김\u{061C}규원"), "김규원")
    }

    func test_stripsBidiControls() {
        // 보이는 글자 순서를 뒤집는다.
        XCTAssertEqual(InputSanitizer.sanitizeDisplayName("김\u{202E}규원"), "김규원")
        XCTAssertEqual(InputSanitizer.sanitizeDisplayName("김\u{2066}규원"), "김규원")
        XCTAssertEqual(InputSanitizer.sanitizeDisplayName("김\u{2069}규원"), "김규원")
    }

    // MARK: - 남기는 것

    func test_keepsPunctuation() {
        // "O'Brien" 은 정당한 이름이다. 막는 건 주입 방어가 아니라 이름을 못 쓰게 하는 것 —
        // 주입은 서버의 ?-바인딩이 막는다.
        XCTAssertEqual(InputSanitizer.sanitizeDisplayName("O'Brien"), "O'Brien")
        XCTAssertEqual(InputSanitizer.sanitizeDisplayName("Anne-Marie"), "Anne-Marie")
        XCTAssertEqual(InputSanitizer.sanitizeDisplayName("Robert; DROP"), "Robert; DROP")
        XCTAssertEqual(InputSanitizer.sanitizeDisplayName("김규원 🎉"), "김규원 🎉")
    }

    // MARK: - 줄바꿈은 지우지 않고 공백으로

    func test_newlineBecomesSpace_notDeleted() {
        // 지우면 "김"+개행+"규원" 이 "김규원" 으로 붙어 **없던 한 단어**가 된다.
        XCTAssertEqual(InputSanitizer.sanitizeDisplayName("김\n규원"), "김 규원")
        XCTAssertEqual(InputSanitizer.sanitizeDisplayName("김\r\n규원"), "김 규원")
        XCTAssertEqual(InputSanitizer.sanitizeDisplayName("김\t규원"), "김 규원")
    }

    func test_allowNewlines_keepsThemForMultilineFields() {
        // 직접 문구처럼 여러 줄이 정당한 입력에서는 개행을 남긴다.
        XCTAssertEqual(InputSanitizer.sanitizeUserText("한 줄\n두 줄", allowNewlines: true), "한 줄\n두 줄")
        XCTAssertEqual(InputSanitizer.sanitizeUserText("한 줄\n두 줄", allowNewlines: false), "한 줄 두 줄")
    }

    // MARK: - 공백 처리

    func test_collapsesRepeatedSpaces() {
        // 공백만으로 이름을 다르게 보이게 하는 것도 막는다.
        XCTAssertEqual(InputSanitizer.sanitizeDisplayName("김     규원"), "김 규원")
    }

    func test_trimsLeadingOnly_soTypingSpacesWorks() {
        // ⚠ 뒤쪽 공백을 지우면 "김 규원" 을 아예 칠 수 없다:
        //    "김 " → "김" → 다음 글자가 "김규" 로 붙는다.
        // 안드로이드 sanitizeDisplayName 도 trimStart 만 한다. 최종 양쪽 trim 은 서버 몫.
        XCTAssertEqual(InputSanitizer.sanitizeDisplayName("   김규원"), "김규원")
        XCTAssertEqual(InputSanitizer.sanitizeDisplayName("김 "), "김 ")
        XCTAssertEqual(InputSanitizer.sanitizeDisplayName("김 규"), "김 규")
    }

    // MARK: - 길이

    func test_sanitizeDoesNotTruncate() {
        // 말없이 잘리면 사용자는 왜 글자가 안 들어가는지 모른 채 지웠다 다시 친다.
        // 자르는 건 clamp 의 몫이다.
        let long = String(repeating: "가", count: 100)
        XCTAssertEqual(InputSanitizer.sanitizeDisplayName(long).count, 100)
    }

    func test_clampDisplayName() {
        // 한글은 UTF-16 1유닛이라 count 와 utf16.count 가 같다.
        let long = String(repeating: "가", count: 100)
        XCTAssertEqual(InputSanitizer.clampDisplayName(long).utf16.count, 30)
        XCTAssertEqual(InputSanitizer.clampVoiceName(long).utf16.count, 50)
    }

    /// ⚠ **길이는 서버와 같은 단위(UTF-16)로 센다.**
    /// Swift `String.count` 는 grapheme 단위라 서버(JS `String.length`)와 다르다 —
    /// `count` 로 자르면 앱은 통과시키는데 서버가 거절하는 이름이 생긴다.
    func test_clamp_countsUTF16LikeServer() {
        // 이모지 20개: Swift count 20(옛 구현은 통과) / UTF-16 40(서버는 거절)
        let emojis = String(repeating: "😀", count: 20)
        let clamped = InputSanitizer.clampDisplayName(emojis)
        XCTAssertLessThanOrEqual(clamped.utf16.count, 30, "서버가 세는 단위로 상한 안이어야 한다")
        XCTAssertEqual(clamped.utf16.count, 30)
        XCTAssertEqual(clamped.count, 15, "이모지 15개 = UTF-16 30")
    }

    /// 자를 때 서러게이트 쌍을 반으로 가르지 않는다 — 깨진 문자가 DB·JWT 에 실린다.
    func test_clamp_doesNotSplitSurrogatePair() {
        let name = String(repeating: "가", count: 29) + "😀😀"
        let clamped = InputSanitizer.clampDisplayName(name)
        // 29 + 이모지(2) = 31 > 30 이므로 이모지가 통째로 잘려 29 가 된다.
        XCTAssertEqual(clamped.utf16.count, 29)
        XCTAssertEqual(clamped, String(repeating: "가", count: 29))
        // 깨진 서러게이트가 없는지 — UTF-8 왕복이 되면 정상이다.
        XCTAssertEqual(String(decoding: Array(clamped.utf8), as: UTF8.self), clamped)
    }

    func test_clamp_keepsShortStringsUntouched() {
        XCTAssertEqual(InputSanitizer.clampDisplayName("김규원"), "김규원")
    }

    // MARK: - 조합

    func test_combined_realisticAttack() {
        // 제로폭 + 양방향 + 제어문자 + 과다 공백을 한 번에.
        let nasty = "  관\u{200B}리\u{202E}자\u{0000}   님  "
        XCTAssertEqual(InputSanitizer.sanitizeDisplayName(nasty), "관리자 님 ")
    }
}
