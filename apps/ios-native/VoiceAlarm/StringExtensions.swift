import Foundation

// 여러 ViewModel/뷰에 복붙돼 있던 String 헬퍼를 단일 출처로 통합한다.
// (containsKorean ×5, nilIfBlank ×2 중복 제거)

extension String {
    /// 한글(가-힣) 음절이 하나라도 포함되는지.
    var containsKorean: Bool {
        contains { character in
            character.unicodeScalars.contains { scalar in
                (0xAC00...0xD7A3).contains(Int(scalar.value))
            }
        }
    }
}

extension Optional where Wrapped == String {
    /// 공백 trim 후 빈 문자열이면 nil.
    var nilIfBlank: String? {
        switch self {
        case .some(let value):
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        case .none:
            return nil
        }
    }
}
