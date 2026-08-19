import Foundation

/// **끝내지 못한 명시적 로그아웃.** 없으면 `nil`.
///
/// ⚠ 로그아웃의 뒷정리(소유자 새기기 · 예약 끊기 · 행 끄기)는 **알람 저장소가 디스크에서
/// 로드된 뒤에만** 할 수 있다. 그런데 `waitUntilLoadedFromDisk` 는 **상한이 있는 기다림**이라
/// (BGTask 예산 때문에 3초) 로드가 안 끝난 채로도 돌아온다. 콜드 스타트 직후 로그아웃하면
/// 그 창에 걸려 **빈 목록을 보고 아무것도 못 끄고 끝난다** — 그 계정의 OS 예약은 살아 있고,
/// 로그인 화면 뒤라 사용자는 끌 수도 없다(Codex #699 P1).
///
/// 자동 401 은 `SessionExpiryStore` 가 같은 일을 해 주지만, 명시적 로그아웃은 그 값을
/// **지우므로** 되짚을 근거가 없다. 그래서 별도로 남긴다.
///
/// 다음 실행(또는 로드 완료)에서 이 표시를 보고 뒷정리를 마저 한다.
enum PendingSignOutStore {

    private static let key = "pending_sign_out_user_id\(TestIsolation.storageSuffix)"

    private static var defaults: UserDefaults { .standard }

    /// 명시적 로그아웃을 시작할 때 적는다.
    ///
    /// ⚠ **자동 401 에서는 부르지 않는다.** 그건 사용자가 그만두겠다고 한 게 아니라서
    /// 알람을 끄면 안 된다 — 이 표시는 "끄는 일을 마저 하라" 는 뜻이다.
    static func mark(_ userId: String?) {
        // 계정 id 를 모를 수도 있다(세션이 이미 비었다). 그때도 표시는 남겨야 뒷정리가 돈다 —
        // 빈 문자열로 두면 `stopAllScheduledAlarms` 가 '누구인지 모름' 으로 받아 안전한 쪽
        // (켜진 것을 전부 끈다)으로 처리한다.
        defaults.set(userId?.nilIfBlank ?? "", forKey: key)
    }

    /// 뒷정리를 마저 해야 하는가. 값이 있으면 그 계정(빈 문자열이면 '누구인지 모름').
    static var pendingUserId: String?? {
        guard let raw = defaults.string(forKey: key) else { return nil }
        return .some(raw.nilIfBlank)
    }

    /// 뒷정리가 **실제로 끝났을 때만** 지운다.
    static func clear() {
        defaults.removeObject(forKey: key)
    }
}
