import Foundation

/// 웰컴 프로모 안내를 이 **계정**에 이미 띄웠는지 기록한다.
///
/// 안드로이드 `ui/main/PromoPromptStore.kt`.
/// 계정 단위인 이유: 코드 등록은 계정에 붙는 혜택이라, 같은 기기에서 다른 계정으로
/// 들어온 사람에게는 다시 안내해야 한다. 반대로 한 번 본 계정에는 다시 띄우지 않는다 —
/// 첫 실행에는 이미 동의·권한·목소리 준비가 줄지어 있어, 반복 노출까지 얹으면 안내가
/// 아니라 조르기가 된다.
struct PromoPromptStore {
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    func hasPrompted(userID: String) -> Bool { defaults.bool(forKey: key(userID)) }
    func markPrompted(userID: String) { defaults.set(true, forKey: key(userID)) }

    private func key(_ userID: String) -> String { "promo_prompted_\(userID)" }
}
