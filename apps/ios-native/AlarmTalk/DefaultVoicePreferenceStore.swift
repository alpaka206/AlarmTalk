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

    // MARK: last-used 목소리 (온보딩 기본 목소리와 **다른 키**)

    /// 마지막으로 **알람에 실제로 저장한** 목소리 id.
    ///
    /// ⚠ `default_voice_<uid>` 와 **절대 섞지 않는다.** 그 키는 온보딩 완료 판정
    /// (`hasChosen` → `hasCompletedSetup` → `RootView`)에 쓰이므로, 알람 저장이 그걸
    /// 덮으면 온보딩을 건너뛴 사용자가 갑자기 '완료' 로 바뀐다.
    ///
    /// 규약(`CLAUDE.md` 「알람 편집기 기본값 = 직전 선택 유지」):
    ///  - 기록은 **알람 저장 성공 시에만**. 편집기에서 눌러만 보고 취소한 건 기억하지 않는다.
    ///  - 프리셀렉트는 **마지막에 쓴 것이 그룹보다 우선**이다. 그룹(내 클론 → 공유받은 →
    ///    기본) 순서를 먼저 보면, 클론을 가진 사람이 기본 목소리를 골라 저장해도 매번
    ///    클론으로 되돌아간다.
    func lastUsedVoiceId(userID: String?) -> String? {
        guard let key = lastUsedVoiceKey(userID) else { return nil }
        return defaults.string(forKey: key)?.nilIfBlank
    }

    func setLastUsedVoiceId(userID: String?, voiceId: String?) {
        guard let key = lastUsedVoiceKey(userID) else { return }
        if let voiceId = voiceId?.trimmingCharacters(in: .whitespacesAndNewlines), !voiceId.isEmpty {
            defaults.set(voiceId, forKey: key)
        } else {
            defaults.removeObject(forKey: key)
        }
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
            if let skippedKey = skippedKey(userID) {
                defaults.removeObject(forKey: skippedKey)
            }
        } else {
            defaults.removeObject(forKey: key)
        }
    }

    /// 사용자가 기본 목소리를 한 번이라도 골랐는지(온보딩 목소리 스텝 완료 판정).
    func hasChosen(userID: String?) -> Bool {
        defaultVoiceId(userID: userID) != nil
    }

    func hasCompletedSetup(userID: String?) -> Bool {
        hasChosen(userID: userID) || hasSkipped(userID: userID)
    }

    func markSkipped(userID: String?) {
        guard let key = skippedKey(userID) else { return }
        defaults.set(true, forKey: key)
    }

    private func hasSkipped(userID: String?) -> Bool {
        guard let key = skippedKey(userID) else { return false }
        return defaults.bool(forKey: key)
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

    /// 명시적 로그아웃·탈퇴에서만 부른다.
    /// ⚠ 자동 401 에서 지우면 같은 사람이 다시 로그인할 때 취향을 잃는다.
    func clear(userID: String?) {
        guard let voiceKey = voiceKey(userID),
              let listenerKey = listenerKey(userID),
              let skippedKey = skippedKey(userID) else { return }
        defaults.removeObject(forKey: voiceKey)
        defaults.removeObject(forKey: listenerKey)
        defaults.removeObject(forKey: skippedKey)
        if let lastUsed = lastUsedVoiceKey(userID) { defaults.removeObject(forKey: lastUsed) }
    }

    private func voiceKey(_ userID: String?) -> String? {
        guard let id = normalized(userID) else { return nil }
        return "default_voice_\(id)"
    }

    private func listenerKey(_ userID: String?) -> String? {
        guard let id = normalized(userID) else { return nil }
        return "default_listener_\(id)"
    }

    private func lastUsedVoiceKey(_ userID: String?) -> String? {
        guard let id = normalized(userID) else { return nil }
        return "last_voice_\(id)"
    }

    private func skippedKey(_ userID: String?) -> String? {
        guard let id = normalized(userID) else { return nil }
        return "default_voice_setup_skipped_\(id)"
    }

    private func normalized(_ userID: String?) -> String? {
        guard let id = userID?.trimmingCharacters(in: .whitespacesAndNewlines), !id.isEmpty else {
            return nil
        }
        return id
    }
}
