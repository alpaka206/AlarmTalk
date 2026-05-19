import Foundation

/// 메인 앱과 위젯/Live Activity 간 공유 컨테이너 식별자.
///
/// 양쪽 타겟의 entitlements 의 `com.apple.security.application-groups`
/// 배열에 동일한 값이 등록되어 있어야 한다. 어느 한 쪽이라도 비어 있으면
/// `containerURL` 은 nil 을 반환하므로 호출부는 fallback 을 보장해야 한다.
public enum AppGroup {
    /// App Group 식별자. entitlements 와 동일하게 유지할 것.
    public static let identifier = "group.com.voicealarm.nativeapp.ios.shared"

    /// 공유 키체인 access group. `$(AppIdentifierPrefix)` 는 런타임에 해석된다.
    public static let keychainAccessGroup = "com.voicealarm.nativeapp.ios.keychain"

    /// Cross-process JSON/캐시를 저장할 컨테이너 URL.
    public static var containerURL: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: identifier)
    }

    /// 공유된 UserDefaults suite.
    public static var sharedDefaults: UserDefaults? {
        UserDefaults(suiteName: identifier)
    }
}
