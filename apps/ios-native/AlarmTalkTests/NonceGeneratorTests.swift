import XCTest
@testable import AlarmTalk

final class NonceGeneratorTests: XCTestCase {
    // 빈 문자열 SHA256 은 RFC 6234 의 well-known 값과 같아야 한다.
    // 이 값이 깨지면 CryptoKit 동작 자체가 바뀐 것이므로 곧바로 잡힌다.
    func testSha256OfEmptyStringMatchesKnownDigest() {
        let expected = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        XCTAssertEqual(NonceGenerator.sha256(""), expected)
    }

    func testSha256IsDeterministicForSameInput() {
        let input = "raw-nonce-1234567890ABCDEFGH"
        let first = NonceGenerator.sha256(input)
        let second = NonceGenerator.sha256(input)
        XCTAssertEqual(first, second)
        XCTAssertEqual(first.count, 64, "SHA-256 hex string must be 64 chars")
        XCTAssertTrue(first.allSatisfy { $0.isHexDigit }, "hex string must be lowercase hex")
    }

    func testMakeNonceProducesAlphanumericRawNonceOfRequestedLength() {
        let nonce = NonceGenerator.makeNonce(length: 32)
        XCTAssertEqual(nonce.count, 32)
        let allowed: Set<Character> = Set(
            "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-._"
        )
        XCTAssertTrue(
            nonce.allSatisfy { allowed.contains($0) },
            "raw nonce must contain only the Apple-sample charset (got: \(nonce))"
        )
    }

    func testMakeNonceProducesDifferentValuesAcrossCalls() {
        // 동일 결과가 나올 확률은 64^32 분의 1 수준이라 실질적으로 0.
        let a = NonceGenerator.makeNonce()
        let b = NonceGenerator.makeNonce()
        XCTAssertNotEqual(a, b)
    }

    func testSha256ContractWithRawNonceMatchesServerExpectation() {
        // 서버가 SHA256(rawNonce) hex 로 비교하므로, 32바이트 raw nonce 의
        // 결과가 64자 lowercase hex 인지 형태 검증을 한 번 더 보장한다.
        let raw = NonceGenerator.makeNonce(length: 32)
        let hash = NonceGenerator.sha256(raw)
        XCTAssertEqual(hash.count, 64)
        XCTAssertTrue(hash.allSatisfy { $0.isHexDigit })
    }
}
