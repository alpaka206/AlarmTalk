import Foundation

/// **기계가 만든 문구**에서 delivery 태그(대괄호 안 연출 지시문)를 벗긴다.
///
/// 안드로이드 `data/DeliveryTags.kt` 의 대응물이다 — **한쪽만 고치지 말 것.**
/// ⚠ iOS 에는 2026-08-13 까지 이 코드가 **아예 없었다.** 서버가 준 문구를 그대로 화면에
/// 올렸고, 그래서 태그가 섞인 옛 행은 잠금화면·Live Activity·편집기에 대괄호가 그대로 보였다.
///
/// **판정 축은 '출처' 하나다.** 사용자가 직접 친 문구에는 손대지 않는다.
/// 서버는 사용자가 친 대괄호를 의도적으로 보존하는데(`deriveAlarmDisplayText`) 앱만 지우면,
/// 편집기에서 한 번 열었다 저장하는 순간 그 부분이 영구히 사라진다.
///
/// ⚠ **철자 목록으로 판정하지 말 것.** 태그 어휘는 **열린 집합**이다(비언어 소리·발성 방식·
/// 태도를 모델이 고른다). 그래서 `[after lunch]`(사용자 메모)와 `[laughs nervously]`(우리 태그)를
/// 모양으로는 구분할 수 없다 — 구분은 `generated` 가 한다.
enum DeliveryTags {

    /// delivery 태그의 **모양**. 백엔드 `vertex-translate.ts` 의 `TAG_BODY_PATTERN`,
    /// 안드로이드 `DeliveryTags.kt` 의 `BRACKETED_RE` 와 같은 문자셋이다.
    ///
    /// ⚠ **쉼표를 빼지 말 것.** `[low, controlled]`·`[measured, deliberate]` 처럼 두 마디로 된
    /// 지시가 흔하다. 쉼표가 없으면 그 형태는 **매치조차 되지 않아** 그대로 샌다.
    private static let bracketed = try? NSRegularExpression(
        pattern: "\\[[a-z][a-z ,-]{1,48}\\]",
        options: [.caseInsensitive]
    )

    /// - Parameter generated: 서버·프리셋이 만든 문구면 true, 사용자가 직접 입력한 문구면 false.
    static func strip(_ text: String, generated: Bool) -> String {
        guard generated, let bracketed else { return text }
        let range = NSRange(text.startIndex..., in: text)
        guard bracketed.firstMatch(in: text, range: range) != nil else {
            // 벗길 게 없으면 원문을 **그대로** 돌려준다 — 공백 정리조차 하지 않는다.
            // 이 값이 그대로 다시 저장되는 경로가 있다.
            return text
        }
        let stripped = bracketed.stringByReplacingMatches(
            in: text, range: range, withTemplate: " "
        )
        let cleaned = stripped
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        // ⚠ 다 벗겨 아무것도 안 남으면 벗기지 않은 것으로 친다. 문구가 비면 편집기가 저장을
        // 막아 그 알람을 고칠 수도 지울 수도 없게 된다(안드로이드도 같은 방어가 있다).
        return cleaned.isEmpty ? text : cleaned
    }
}
