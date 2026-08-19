import Foundation

enum AudioUserFacingError {
    static func message(for error: Error, fallback: String) -> String {
        let message = error.localizedDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !message.isEmpty, message.hasKoreanSyllable else {
            return fallback
        }
        return message
    }
}

private extension String {
    var hasKoreanSyllable: Bool {
        contains { character in
            character.unicodeScalars.contains { scalar in
                (0xAC00...0xD7A3).contains(Int(scalar.value))
            }
        }
    }
}
