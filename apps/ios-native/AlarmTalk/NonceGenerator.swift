import CryptoKit
import Foundation
import Security

// Apple Sign In replay 방어용 nonce 생성기.
// 클라이언트는 raw nonce 를 보관하고, ASAuthorizationAppleIDRequest.nonce 에는
// SHA256(raw) hex 문자열을 넣어 Apple 이 발급하는 id_token.nonce 클레임에
// 동일한 해시가 들어오도록 한다. 서버는 raw nonce 를 다시 해싱해 검증한다.
enum NonceGenerator {
    /// alphanumeric 32~ 길이의 cryptographically random raw nonce 생성.
    static func makeNonce(length: Int = 32) -> String {
        precondition(length > 0, "nonce length must be positive")
        let charset: [Character] = Array(
            "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-._"
        )
        var result = ""
        result.reserveCapacity(length)
        var remaining = length

        while remaining > 0 {
            var randoms = [UInt8](repeating: 0, count: 16)
            let status = SecRandomCopyBytes(kSecRandomDefault, randoms.count, &randoms)
            if status != errSecSuccess {
                fatalError("SecRandomCopyBytes failed with status: \(status)")
            }
            for random in randoms where remaining > 0 {
                if Int(random) < charset.count {
                    result.append(charset[Int(random) % charset.count])
                    remaining -= 1
                }
            }
        }
        return result
    }

    /// CryptoKit SHA256 hex string. Apple 서명 nonce 필드에 그대로 넣을 수 있는 형식.
    static func sha256(_ input: String) -> String {
        let data = Data(input.utf8)
        let hashed = SHA256.hash(data: data)
        return hashed.map { String(format: "%02x", $0) }.joined()
    }
}
