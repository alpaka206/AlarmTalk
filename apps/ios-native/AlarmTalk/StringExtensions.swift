import Foundation

// 여러 ViewModel/뷰에 복붙돼 있던 String 헬퍼를 단일 출처로 통합한다.

extension String {
    /// 공백 trim 후 빈 문자열이면 nil. (nonEmpty/clean 등으로 흩어져 있던 동일 로직 통합.)
    var nilIfBlank: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }


}

extension Optional where Wrapped == String {
    /// 공백 trim 후 빈 문자열이면 nil.
    var nilIfBlank: String? { self?.nilIfBlank }
}
