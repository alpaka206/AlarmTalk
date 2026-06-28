import Foundation

/// 사용자가 온보딩 "목소리 고르기"에서 선택한 **기본 목소리**(시스템 스톡 보이스) id 와
/// 그 목소리가 사용자를 부를 **호칭**을 기기에 저장한다. 기기별 클라이언트 설정이며
/// 유저별 키를 둔다(온보딩 완료 저장과 동일한 방식).
///
/// Android `DefaultVoicePreferenceStore`(SharedPreferences) 미러. 키도 동일:
///   - `default_voice_<userId>`    : 기본 목소리 id
///   - `default_listener_<userId>` : 기본 목소리 호칭(listenerTitle)
///
/// 용도:
///  - 새 알람 에디터가 기본 목소리를 미리 선택(임의 첫 번째 대신).
///  - 알람창에선 기본(시스템) 목소리를 못 바꾸므로 목록에 고른 기본 1개만 노출.
///  - 목소리 탭이 "선택된 기본 목소리 + 호칭"으로 노출/수정.
///  - 시스템(기본) 목소리 알람 TTS 의 listenerTitle 로 호칭 사용.
struct DefaultVoicePreferenceStore {
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    /// 저장된 기본 목소리 id. 고른 적 없으면 nil.
    func defaultVoiceId(userID: String?) -> String? {
        guard let key = voiceKey(userID) else { return nil }
        return defaults.string(forKey: key)?.nilIfBlank
    }

    /// 기본 목소리 선택을 저장한다. voiceId 가 비면 선택을 지운다.
    func setDefaultVoiceId(userID: String?, voiceId: String?) {
        guard let key = voiceKey(userID) else { return }
        if let voiceId = voiceId?.trimmingCharacters(in: .whitespacesAndNewlines), !voiceId.isEmpty {
            defaults.set(voiceId, forKey: key)
        } else {
            defaults.removeObject(forKey: key)
        }
    }

    /// 사용자가 기본 목소리를 한 번이라도 골랐는지(온보딩 목소리 스텝 완료 판정).
    func hasChosen(userID: String?) -> Bool {
        defaultVoiceId(userID: userID) != nil
    }

    /// 기본(시스템) 목소리가 사용자를 부를 호칭. 없으면 nil.
    func listenerTitle(userID: String?) -> String? {
        guard let key = listenerKey(userID) else { return nil }
        return defaults.string(forKey: key)?.nilIfBlank
    }

    /// 호칭을 저장한다. 비면 지운다.
    func setListenerTitle(userID: String?, title: String?) {
        guard let key = listenerKey(userID) else { return }
        if let title = title?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty {
            defaults.set(title, forKey: key)
        } else {
            defaults.removeObject(forKey: key)
        }
    }

    private func voiceKey(_ userID: String?) -> String? {
        guard let id = normalized(userID) else { return nil }
        return "default_voice_\(id)"
    }

    private func listenerKey(_ userID: String?) -> String? {
        guard let id = normalized(userID) else { return nil }
        return "default_listener_\(id)"
    }

    private func normalized(_ userID: String?) -> String? {
        guard let id = userID?.trimmingCharacters(in: .whitespacesAndNewlines), !id.isEmpty else {
            return nil
        }
        return id
    }
}
