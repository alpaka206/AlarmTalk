import Foundation

/// 사용자 입력 정리 — **앱의 1차 방어선**.
///
/// 규칙의 유일 출처는 서버 `@alarmtalk/shared` 의 `normalizeDisplayName` /
/// `DISPLAY_NAME_MAX_LENGTH` / `VOICE_NAME_MAX_LENGTH` 이고, 안드로이드도 같은 규칙을
/// `ui/components/CodeRedeemField.kt` 에 갖고 있다. 세 곳이 같아야 한다 —
/// **가장 느슨한 경로가 실질 규칙이 되기 때문**이다(CLAUDE.md 「입력 규칙은 한 곳에서만」).
///
/// 거르는 것과 그 이유:
///  - **제어문자**: 로그·CSV 를 깨고 TTS 낭독을 망친다.
///  - **제로폭**(U+200B~U+200F, U+FEFF, U+061C): 눈에 같아 보이는데 다른 값이라 사칭에 쓰인다.
///  - **양방향 제어문자**(U+202A~U+202E, U+2066~U+2069): 보이는 글자 순서를 뒤집는다.
///
/// **남기는 것**: 따옴표·세미콜론·하이픈 등 문장부호. "O'Brien" 은 정당한 이름이고,
/// 막는 건 주입 방어가 아니라 이름을 못 쓰게 하는 것이다 — 주입은 서버의 `?`-바인딩이 막는다.
enum InputSanitizer {

    /// 표시 이름 상한. 서버 `DISPLAY_NAME_MAX_LENGTH`(30) 와 같아야 한다.
    /// 앱이 더 느슨하면 서버에서 거절당하고, 더 빡빡하면 서버가 허용하는 이름을 못 쓴다.
    static let displayNameMaxLength = 30

    /// 목소리 프로필 이름 상한. 서버 `VOICE_NAME_MAX_LENGTH`(50) 와 같아야 한다.
    /// 계정 닉네임보다 긴 건 **의도다** — 사람 이름이 아니라 라벨이라
    /// ("엄마 목소리(2024년 녹음)") 여유를 둔다. **글자 규칙은 둘이 같다.**
    static let voiceNameMaxLength = 50

    /// 일반 사용자 입력 정리.
    ///
    /// - Parameter allowNewlines: 여러 줄 입력(직접 문구 등)이면 true.
    ///
    /// 줄바꿈·탭은 **지우지 않고 공백으로 바꾼다.** 지우면 "김\n규원" 이 "김규원" 으로 붙어
    /// 원래 없던 한 단어가 된다 — 걸러내려던 건 서식 문자지 단어 경계가 아니다.
    static func sanitizeUserText(_ raw: String, allowNewlines: Bool = false) -> String {
        var out = String()
        out.reserveCapacity(raw.count)
        for scalar in raw.unicodeScalars {
            switch scalar {
            case "\n":
                out.unicodeScalars.append(allowNewlines ? "\n" : " ")
            case "\r", "\t":
                out.unicodeScalars.append(" ")
            default:
                if isStripped(scalar) { continue }
                out.unicodeScalars.append(scalar)
            }
        }
        return out
    }

    /// 표시 이름·목소리 이름 정리. `sanitizeUserText` + 연속 공백 접기 + **앞쪽만** trim.
    /// 안드로이드 `sanitizeDisplayName` 과 같은 규칙이다.
    ///
    /// ⚠ **뒤쪽 공백을 지우지 않는 건 의도다.** 입력 중에 매 글자마다 trailing space 를
    /// 먹어 버리면 "김 규원" 처럼 띄어쓰기가 있는 이름을 아예 칠 수 없다("김 " → "김" →
    /// 다음 글자가 "김규" 로 붙는다). 최종 정규화(양쪽 trim)는 서버
    /// `normalizeDisplayName` 이 하고, 그건 제출 시점에 한 번만 돌면 된다.
    ///
    /// ⚠ **길이도 여기서 자르지 않는다.** 자르는 건 `clamp(_:max:)` 의 몫이다 —
    /// 말없이 잘리면 사용자는 왜 글자가 안 들어가는지 모른 채 지웠다 다시 친다.
    static func sanitizeDisplayName(_ raw: String) -> String {
        let sanitized = sanitizeUserText(raw, allowNewlines: false)
        // 연속 공백을 하나로 — 공백만으로 이름을 다르게 보이게 하는 것도 막는다.
        var collapsed = ""
        var lastWasSpace = false
        for ch in sanitized {
            let isSpace = ch == " "
            if isSpace && lastWasSpace { continue }
            collapsed.append(ch)
            lastWasSpace = isSpace
        }
        // 앞쪽만 다듬는다(위 주석 참고).
        return String(collapsed.drop(while: { $0 == " " }))
    }

    /// 상한까지 자른다. **길이는 서버와 같은 단위(UTF-16 코드 유닛)로 센다.**
    ///
    /// ⚠ Swift `String.count` 는 **grapheme cluster** 단위라 서버와 다르다. 서버
    /// (`@alarmtalk/shared` 의 `DisplayNameSchema`)는 JS `String.length` = UTF-16 코드
    /// 유닛으로 센다. 이모지 하나가 Swift 로는 1, 서버로는 2다.
    ///
    /// 그래서 `count` 로 자르면 **앱은 통과시키는데 서버가 거절하는 이름**이 생긴다 —
    /// 이모지 20개는 Swift 20(통과)이지만 UTF-16 40(거절)이다. 사용자는 "16/30" 을 보면서
    /// 저장이 안 되고, 무엇을 지워야 하는지 알 방법이 없어 갇힌다. 가입 화면에서는
    /// 가입 자체가 막힌다.
    ///
    /// 자를 때 **서러게이트 쌍을 반으로 가르지 않는다** — 깨진 문자가 DB·JWT 에 실린다.
    /// 서버 `clampDisplayName` 도 같은 보호를 한다.
    static func clamp(_ raw: String, max maxLength: Int) -> String {
        let units = Array(raw.utf16)
        guard units.count > maxLength else { return raw }
        var end = maxLength
        // 경계가 서러게이트 쌍 한가운데면 그 글자를 통째로 버린다.
        if end > 0, UTF16.isLeadSurrogate(units[end - 1]) { end -= 1 }
        return String(decoding: units[0..<end], as: UTF16.self)
    }

    /// 표시 이름 한 번에 — 정리 후 상한까지. 외부에서 받은 값(애플/구글이 준 이름 등)처럼
    /// **거부해 봐야 알려 줄 사람이 없는** 값에 쓴다. 서버 `clampDisplayName` 과 같은 역할.
    static func clampDisplayName(_ raw: String) -> String {
        clamp(sanitizeDisplayName(raw), max: displayNameMaxLength)
    }

    /// 목소리 이름 한 번에.
    static func clampVoiceName(_ raw: String) -> String {
        clamp(sanitizeDisplayName(raw), max: voiceNameMaxLength)
    }

    private static func isStripped(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.value {
        case 0x00...0x1F, 0x7F...0x9F:   // C0 / C1 제어문자
            return true
        case 0x061C:                      // Arabic Letter Mark
            return true
        case 0x200B...0x200F:             // zero-width space ~ RLM
            return true
        case 0x202A...0x202E:             // 양방향 embedding/override
            return true
        case 0x2066...0x2069:             // 양방향 isolate
            return true
        case 0xFEFF:                      // zero-width no-break space (BOM)
            return true
        default:
            return false
        }
    }
}

extension InputSanitizer {
    /// 이용권·초대 코드 정리. 안드로이드 `sanitizeRedeemCode`(`CodeRedeemField.kt`).
    ///
    /// 대문자·영숫자·하이픈만 남긴다 — 코드는 사람이 옮겨 적는 값이라 눈에 안 보이는
    /// 공백·제로폭이 섞이면 "맞게 넣었는데 안 된다" 가 된다.
    static func sanitizeRedeemCode(_ raw: String) -> String {
        // ⚠ 밑줄(`_`)도 남긴다 — 안드로이드 `sanitizeRedeemCode` 가 허용하는데 여기서만
        // 지우면 밑줄이 든 프로모 코드가 **조용히 다른 코드가 되어** 등록에 실패한다.
        String(sanitizeUserText(raw).uppercased().filter { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" })
            .prefix(64)
            .description
    }
}
