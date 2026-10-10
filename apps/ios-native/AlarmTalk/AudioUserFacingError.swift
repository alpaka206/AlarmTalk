import Foundation

enum AudioUserFacingError {
    static func message(for error: Error, fallback: String) -> String {
        userFacingErrorMessage(error, fallback: fallback)
    }
}
