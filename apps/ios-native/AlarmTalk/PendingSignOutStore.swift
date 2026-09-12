import Foundation

/// **끝내지 못한 명시적 로그아웃·탈퇴 뒷정리.** 계정별로 쌓인다.
///
/// ⚠ 로그아웃의 뒷정리(소유자 새기기 · 예약 끊기 · 행 끄기 · 푸시 해제 · 토큰 폐기)는
/// 알람 저장소가 로드된 뒤에만, 그리고 네트워크가 될 때만 끝난다. 그런데
/// `waitUntilLoadedFromDisk` 는 **상한이 있는 기다림**이고(BGTask 예산 때문에 3초) 네트워크는
/// 오프라인일 수 있다. 그 창에 걸리면 **아무것도 못 끄고 끝난다** — 그 계정의 OS 예약은
/// 살아 있고, 로그인 화면 뒤라 사용자는 끌 수도 없다.
///
/// 자동 401 은 `SessionExpiryStore` 가 같은 일을 해 주지만, 명시적 로그아웃은 그 값을
/// **지우므로** 되짚을 근거가 없다. 그래서 별도로 남긴다.
///
/// ⚠ **한 칸이 아니라 목록이다**(Codex #699 P2). A 의 뒷정리가 오프라인으로 남아 있는데
/// B 가 로그인했다 로그아웃하면, 한 칸짜리 저장소는 **A 를 덮어써서** A 의 푸시 바인딩과
/// 서버 토큰이 영영 정리되지 않는다. 계정이 여럿 오간 기기에서 실제로 생기는 상태다.
enum PendingSignOutStore {

    private static let key = "pending_sign_out_user_ids\(TestIsolation.storageSuffix)"

    /// 계정을 모를 때 쓰는 자리표시자. 그때는 '누구인지 모름' 으로 뒷정리한다
    /// (`stopAllScheduledAlarms` 가 켜진 것을 전부 끄는 안전한 쪽으로 처리한다).
    private static let unknownMarker = ""

    private static var defaults: UserDefaults { .standard }

    /// 뒷정리를 마저 해야 하는 계정들. 빈 문자열은 '누구인지 모름'.
    static var pendingUserIds: [String] {
        defaults.stringArray(forKey: key) ?? []
    }

    /// 명시적 로그아웃·탈퇴를 시작할 때 적는다.
    ///
    /// ⚠ **자동 401 에서는 부르지 않는다.** 그건 사용자가 그만두겠다고 한 게 아니라서
    /// 알람을 끄면 안 된다 — 이 표시는 "끄는 일을 마저 하라" 는 뜻이다.
    static func mark(_ userId: String?) {
        let resolved = userId?.nilIfBlank ?? unknownMarker
        var current = pendingUserIds
        guard !current.contains(resolved) else { return }
        current.append(resolved)
        defaults.set(current, forKey: key)
    }

    /// 그 계정의 뒷정리가 아직 남아 있는가. 철회·완료로 사라졌는지 **await 뒤에 다시** 볼 때 쓴다.
    static func isPending(_ userId: String?) -> Bool {
        pendingUserIds.contains(userId?.nilIfBlank ?? unknownMarker)
    }

    /// 그 계정의 뒷정리가 **실제로 끝났을 때만** 지운다(서버 쪽까지 포함).
    static func clear(_ userId: String?) {
        let resolved = userId?.nilIfBlank ?? unknownMarker
        let next = pendingUserIds.filter { $0 != resolved }
        if next.count != pendingUserIds.count {
            defaults.set(next, forKey: key)
        }
        KeychainStore.deleteData(account: tokenAccount(for: resolved))
    }

    // MARK: - 서버 뒷정리용 토큰

    private static func tokenAccount(for userId: String) -> String {
        "pending_sign_out_token\(TestIsolation.storageSuffix).\(userId)"
    }

    /// 푸시 해제·토큰 폐기에 쓸 토큰을 남긴다.
    ///
    /// ⚠ **로컬 세션은 곧 지워진다**(사용자를 네트워크 왕복만큼 기다리게 하지 않는다).
    /// 그 뒤에 프로세스가 죽으면 토큰이 사라져 **다시 시도할 방법이 없다** — 기기는 떠난
    /// 계정에 묶인 채 알림을 계속 받고 서버 토큰도 유효하게 남는다.
    /// 그래서 서버 쪽이 끝날 때까지만 따로 보관한다. 자격증명이므로 **키체인**에 둔다.
    static func markServerCleanup(token: String?, for userId: String?) {
        guard let token = token?.nilIfBlank, let data = token.data(using: .utf8) else { return }
        _ = KeychainStore.saveData(data, account: tokenAccount(for: userId?.nilIfBlank ?? unknownMarker))
    }

    /// 아직 서버 뒷정리가 안 끝난 토큰.
    static func serverCleanupToken(for userId: String?) -> String? {
        let account = tokenAccount(for: userId?.nilIfBlank ?? unknownMarker)
        guard let data = KeychainStore.readData(account: account) else { return nil }
        return String(data: data, encoding: .utf8)?.nilIfBlank
    }

    /// 테스트 전용 — 회차 사이를 갈라 준다.
    static func removeAll() {
        for id in pendingUserIds { KeychainStore.deleteData(account: tokenAccount(for: id)) }
        defaults.removeObject(forKey: key)
    }
}
