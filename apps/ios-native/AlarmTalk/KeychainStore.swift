import Foundation
import Security

enum KeychainStore {
    // ⚠ 유닛 테스트는 호스트 앱 프로세스에서 돌아 **기기의 진짜 세션**을 지운다
    // (`AuthViewModelTests` → `signOut()` → `deleteSession()`). 서비스 이름을 갈라
    // 테스트가 사용자를 로그아웃시키지 못하게 한다 — 근거는 `TestIsolation`.
    private static let service = "com.alarmtalk.app.auth\(TestIsolation.storageSuffix)"

    /// 테스트용 서비스 이름을 쓰고 있는가. 값(서비스 문자열)을 밖으로 내보내지 않고
    /// **갈렸다는 사실만** 알린다 — 회귀 테스트가 단언할 대상은 그것뿐이다.
    static var isIsolatedForTests: Bool { service.hasSuffix(TestIsolation.storageSuffix) && TestIsolation.isRunningUnitTests }
    private static let sessionAccount = "session"

    static func saveSession(_ session: AuthSession) throws {
        let data = try JSONEncoder().encode(session)
        deleteSession()

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: sessionAccount,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecValueData as String: data,
        ]
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw KeychainError.unhandledStatus(status)
        }
    }

    static func readSession() -> AuthSession? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: sessionAccount,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else { return nil }
        return try? JSONDecoder().decode(AuthSession.self, from: data)
    }

    static func deleteSession() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: sessionAccount,
        ]
        SecItemDelete(query as CFDictionary)
    }

    // MARK: - Generic secure blob storage
    //
    // 민감한 사용자 데이터(예: 운세용 성별/생년월일/태어난 시각)를 UserDefaults 대신
    // Keychain 에 보관하기 위한 범용 헬퍼. `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`
    // — 첫 잠금 해제 이후 접근 가능(백그라운드 동작 호환), 기기 밖으로 백업/이전되지 않음.

    /// 임의 데이터를 지정 account 로 저장(upsert). 기존 값이 있으면 덮어쓴다.
    @discardableResult
    static func saveData(_ data: Data, account: String) -> Bool {
        deleteData(account: account)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecValueData as String: data,
        ]
        return SecItemAdd(query as CFDictionary, nil) == errSecSuccess
    }

    /// 지정 account 의 데이터 조회. 없으면 nil.
    static func readData(account: String) -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else { return nil }
        return data
    }

    /// 지정 account 의 데이터 삭제.
    static func deleteData(account: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }
}

enum KeychainError: LocalizedError {
    case unhandledStatus(OSStatus)

    var errorDescription: String? {
        switch self {
        case .unhandledStatus(let status):
            return "Keychain operation failed with status \(status)."
        }
    }
}
