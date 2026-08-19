import Foundation

/// 화면별 "처음 사용 가이드" 노출 이력 저장소.
///
/// `OnboardingCompletionStore` 와 같은 UserDefaults 패턴. 가이드는 계정과 무관한
/// 기기 단위 UX 라 userID 스코프 없이 본 가이드 id 집합만 보관한다.
struct UsageGuideStore {
    enum GuideID: String {
        case alarmEditor = "alarm_editor_v1"
        case voiceClone = "voice_clone_v1"
        /// 홈 탭 첫 방문 코치마크 — Android `UsageGuideStore.GUIDE_HOME`("home_v1") parity.
        case home = "home_v1"
    }

    private let defaults: UserDefaults
    private let seenKey = "usage_guide_seen_ids_v1"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func hasSeen(_ id: GuideID) -> Bool {
        seenIDs().contains(id.rawValue)
    }

    func markSeen(_ id: GuideID) {
        var seen = seenIDs()
        seen.insert(id.rawValue)
        defaults.set(Array(seen), forKey: seenKey)
    }

    private func seenIDs() -> Set<String> {
        Set(defaults.stringArray(forKey: seenKey) ?? [])
    }
}
