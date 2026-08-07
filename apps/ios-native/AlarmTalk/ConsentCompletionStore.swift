import Foundation

/// 이 기기에서 **이미 동의를 마친 계정**을 기억한다.
///
/// 안드로이드 `voice_alarm_consent` SharedPreferences 캐시의 iOS 대응이다.
///
/// 왜 필요한가: 동의 확인은 서버 왕복이라 콜드 스타트마다 수백 ms~수 초가 걸린다.
/// 그동안 전체 화면 스피너를 띄우면, **이미 오래전에 동의를 마친 사용자**가 앱을 열
/// 때마다 로딩 화면을 본다. 이 캐시가 있으면 곧바로 통과시키고 서버로 재확인만 한다.
///
/// ⚠ **두 값의 역할을 섞지 말 것**(CLAUDE.md 「1회성 오버레이는 확인이 끝난 뒤에만
/// 판단한다」):
///  - **이 캐시** = "이 기기에서 동의를 마친 적이 있다" → **로딩 게이트 통과**에만 쓴다.
///  - `consentStatusChecked` = "이 계정의 응답을 실제로 받았다" → **1회성 오버레이**
///    (웰컴 프로모 등) 판정에 쓴다.
///
/// 캐시로 오버레이를 판정하면 안 된다 — 받을 게 남은 계정(선택 동의 재수집 등)은 완료
/// 캐시가 아예 안 만들어져, 매번 다시 덮인다.
struct ConsentCompletionStore {
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    /// 이 계정이 **이 정책 버전으로** 동의를 마쳤는가.
    ///
    /// 정책 버전을 키에 넣는 이유: 문서가 개정되면 캐시가 저절로 무효가 돼야 한다.
    /// 안 그러면 재동의가 필요한 사용자를 캐시가 통과시켜, 동의 화면이 영영 안 뜬다.
    func hasCompleted(userID: String?, policyVersion: String) -> Bool {
        guard let key = key(userID, policyVersion) else { return false }
        return defaults.bool(forKey: key)
    }

    func markCompleted(userID: String?, policyVersion: String) {
        guard let key = key(userID, policyVersion) else { return }
        defaults.set(true, forKey: key)
    }

    /// 명시적 로그아웃·탈퇴에서만 부른다.
    func clear(userID: String?, policyVersion: String) {
        guard let key = key(userID, policyVersion) else { return }
        defaults.removeObject(forKey: key)
    }

    private func key(_ userID: String?, _ policyVersion: String) -> String? {
        guard let id = userID?.trimmingCharacters(in: .whitespacesAndNewlines), !id.isEmpty else {
            return nil
        }
        return "consent_done_\(policyVersion)_\(id)"
    }
}
