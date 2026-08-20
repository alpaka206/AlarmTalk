import Foundation

/// **자동으로 세션이 끊긴(토큰 만료·폐기) 계정.** 없으면 `nil`.
///
/// 안드로이드 `network/AuthSessionStore.kt` 의 `sessionExpiredOwnerUserId` 를 옮긴 것이다.
/// 비로그인 상태에서 **어떤 알람을 되살려도 되는지** 가르는 값이다 — 자동 401 과 명시적
/// 로그아웃은 둘 다 세션이 비지만 알람에 대한 기대가 정반대다:
///
/// - **자동 401**(토큰 만료): 본인이 그대로 쓰던 기기다. 알람은 계속 울려야 하고,
///   업데이트·부팅으로 OS 예약이 지워졌으면 다시 새겨야 한다.
/// - **명시적 로그아웃**: 사용자가 끝낸 것이다. 예약은 이미 취소했고 행도 껐다 —
///   다시 로그인하기 전까지 되살리면 안 된다.
///
/// ⚠ **불리언이 아니라 계정 id 인 이유**는 한 기기에 여러 계정이 오갔을 때다. A 의 세션이
/// 만료된 뒤 B 가 로그인했다 B 도 만료되면, 되살려야 하는 건 **B 것뿐**이다. 불리언이면
/// A 의 알람까지 로그인 화면 뒤에서 함께 살아난다(안드로이드 Codex #665 P1, iOS #699 P1).
///
/// 값이 없는 기기는 **아무것도 되살리지 않는다** — 못 가릴 때는 되살려서 못 끄게 만드는
/// 쪽보다 로그인 한 번 시키는 쪽이 안전하다. 그래서 별도 마이그레이션이 필요 없다.
///
/// 키체인이 아니라 `UserDefaults` 에 두는 이유: 비밀이 아니고, 세션이 사라진 뒤에도
/// 남아 있어야 하는 값이라서다. (키체인의 세션 항목은 그때 지워진다.)
enum SessionExpiryStore {

    private static let key = "session_expired_owner_user_id\(TestIsolation.storageSuffix)"

    private static var defaults: UserDefaults { .standard }

    /// 자동 401 처리에서 **세션을 비우기 전에** 부른다.
    static func markSessionExpired(userId: String?) {
        guard let resolved = userId?.nilIfBlank else { return }
        defaults.set(resolved, forKey: key)
    }

    /// 자동으로 끊긴 계정. 명시적 로그아웃 뒤에는 `nil` 이다.
    static var expiredOwnerUserId: String? {
        defaults.string(forKey: key)?.nilIfBlank
    }

    /// **명시적 로그아웃과 로그인 확정 양쪽에서** 부른다.
    ///
    /// ⚠ 세션을 저장할 때마다(프로필 수정·rolling refresh) 지우면 안 된다 — 로그아웃 직후
    /// 늦게 도착한 응답 하나가 이 표시를 지워, 떼어낸 알람이 되살아난다(안드로이드 주석과 같은 함정).
    static func clear() {
        defaults.removeObject(forKey: key)
    }
}
