import Foundation

struct OnboardingCompletionStore {
    private let defaults: UserDefaults
    private let usersKey = "onboarding_completed_users_v1"
    private let legacyCompletedKey = "onboarding_completed_v1"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func hasCompleted(userID: String) -> Bool {
        let normalized = normalize(userID)
        guard !normalized.isEmpty else { return false }
        let completed = completedUsers()
        if completed.contains(normalized) {
            return true
        }

        if completed.isEmpty && defaults.bool(forKey: legacyCompletedKey) {
            markCompleted(userID: normalized)
            return true
        }
        return false
    }

    func markCompleted(userID: String) {
        let normalized = normalize(userID)
        guard !normalized.isEmpty else { return }
        var completed = completedUsers()
        completed.insert(normalized)
        defaults.set(Array(completed), forKey: usersKey)
    }

    private func completedUsers() -> Set<String> {
        Set(defaults.stringArray(forKey: usersKey) ?? [])
    }

    private func normalize(_ userID: String) -> String {
        userID.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
