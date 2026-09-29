import Foundation

enum AudioUserFacingError {
    static func message(for error: Error, fallback: String) -> String {
        let message = error.localizedDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !message.isEmpty, message.containsKorean else {
            return fallback
        }
        return message
    }
}
