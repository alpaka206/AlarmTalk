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

    /// 세션 쓰기·CAS 가 공유하는 잠금. 배경 작업과 전경이 같은 항목을 건드린다.
    private static let sessionLock = NSLock()

    /**
     * **읽고-대조하고-쓰기를 한 덩어리로**(2026-09-01 리뷰).
     *
     * ⚠ `readSession()` 으로 확인한 뒤 `saveSession()` 을 부르면 그 사이가 창이다. 같은
     * 계정으로 로그아웃→재로그인이 끼면 **옛 배경 작업이 방금 발급된 로그인 토큰을 덮는다**
     * — 이후 요청이 전부 401 이 된다. 계정 id 만 대조해도 같은 계정 재로그인은 못 거르므로
     * **토큰(에폭)까지** 본다.
     *
     * @return 실제로 저장했으면 true. 세션이 바뀌었으면 아무것도 하지 않고 false.
     */
    /**
     * 세션이 **아직 그 세션일 때만** [action] 을 돌린다 — 검사와 실행을 한 덩어리로.
     *
     * 안드로이드 `AuthSessionStore.runIfGeneration` 의 짝이다. iOS 에는 세션 세대 카운터가
     * 없어 **토큰을 에폭으로** 쓴다 — 같은 계정으로 로그아웃→재로그인하면 토큰이 바뀌므로
     * 계정 id 만으로는 못 거르는 그 창을 이걸로 닫는다.
     *
     * @return action 을 돌렸으면 true.
     */
    static func runIfCurrentSession(
        userID: String,
        token: String,
        action: () -> Void
    ) -> Bool {
        sessionLock.lock()
        defer { sessionLock.unlock() }
        guard let current = readSessionUnlocked(),
              current.user.id == userID,
              current.token == token
        else { return false }
        action()
        return true
    }

    @discardableResult
    static func saveSessionIfCurrent(
        expectedUserID: String,
        expectedToken: String,
        transform: (AuthSession) -> AuthSession,
        /// 저장이 성공한 **직후, 같은 잠금 안에서** 돌 부수효과(판정 스냅샷 쓰기 등).
        ///
        /// ⚠ 락 **밖**에서 하면 그 사이의 로그아웃→같은 계정 재로그인에서 옛 작업이 새
        /// 세션의 스냅샷을 되살린다 — 세션만 원자적으로 바꿔 봐야 짝이 되는 스냅샷이
        /// 어긋나면 예약·울림 게이트가 지나간 등급으로 판단한다(2026-09-01 리뷰).
        onSaved: ((AuthSession) -> Void)? = nil
    ) throws -> Bool {
        sessionLock.lock()
        defer { sessionLock.unlock() }
        guard let current = readSessionUnlocked(),
              current.user.id == expectedUserID,
              current.token == expectedToken
        else { return false }
        let next = transform(current)
        try saveSessionUnlocked(next)
        onSaved?(next)
        return true
    }

    static func saveSession(_ session: AuthSession) throws {
        sessionLock.lock()
        defer { sessionLock.unlock() }
        try saveSessionUnlocked(session)
    }

    private static func saveSessionUnlocked(_ session: AuthSession) throws {
        let data = try JSONEncoder().encode(session)
        deleteSessionUnlocked()

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
        sessionLock.lock()
        defer { sessionLock.unlock() }
        return readSessionUnlocked()
    }

    private static func readSessionUnlocked() -> AuthSession? {
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
        sessionLock.lock()
        defer { sessionLock.unlock() }
        deleteSessionUnlocked()
    }

    /// ⚠ `NSLock` 은 재진입이 아니다 — 잠금을 이미 쥔 경로(`saveSessionUnlocked`)는 이걸 쓴다.
    private static func deleteSessionUnlocked() {
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
