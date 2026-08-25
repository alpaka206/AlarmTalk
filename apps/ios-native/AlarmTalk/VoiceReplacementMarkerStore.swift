import Foundation

/// **제자리 목소리 교체를 스스로 알아채기 위한 표식.**
///
/// 안드로이드 `data/VoiceReplacementMarkerStore.kt` 와 같은 규칙이다.
///
/// 교체는 옛 프로필 **행을 재사용**한다(id 가 그대로다). 그래서 접근 가능 목록 대조
/// (`VoiceStudioViewModel.reconcileInaccessibleVoiceAlarms`)로는 영원히 안 걸리고, 본인 소유
/// 알람은 pull 대상도 아니라 서버가 행을 내려도 이 기기에 닿지 않는다.
///
/// 푸시(`voice_access_revoked` + `voiceProfileId`)는 **즉시성만** 맡는다 — iOS 는 강제 종료된
/// 앱에 무음 푸시를 아예 보내지 않는다. 정확성은 목록을 다시 받는 경로(앱 시작·탭 진입·
/// 백그라운드 주기)가 서버의 `custom_audio_invalidated_at` 을 여기 적힌 값과 대조해 맡는다.
///
/// ⚠ **처음 본 프로필은 조용히 적기만 한다.** 첫 조회에서 '바뀌었다' 로 읽으면 업데이트 직후
/// 모든 설치가 직접 입력 알람을 되돌릴 수 없이 날린다.
///
/// ⚠ `updated_at` 으로 대신하지 말 것 — 이름 변경·공유 토글도 그 값을 올린다.
struct VoiceReplacementMarkerStore {
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    /// **그 사이 교체가 있었는가.** 처음 보는 프로필은 조용히 적어 두고 false 를 돌려준다.
    ///
    /// ⚠ 바뀐 값은 여기서 적지 **않는다** — 강등이 실제로 끝난 뒤 `commit` 으로 적는다.
    /// 미리 적으면 강등이 실패했을 때 다시는 시도하지 않는다(신호를 잃는다).
    func changed(userID: String?, profileID: String, invalidatedAt: String?) -> Bool {
        guard let userID = userID?.nilIfBlank, !profileID.isEmpty else { return false }
        let key = key(userID, profileID)
        let incoming = invalidatedAt ?? ""
        guard let previous = defaults.string(forKey: key) else {
            defaults.set(incoming, forKey: key)
            return false
        }
        return previous != incoming
    }

    /// 강등까지 끝났으니 이 값을 '본 것' 으로 확정한다.
    func commit(userID: String?, profileID: String, invalidatedAt: String?) {
        guard let userID = userID?.nilIfBlank, !profileID.isEmpty else { return }
        defaults.set(invalidatedAt ?? "", forKey: key(userID, profileID))
    }

    /// 명시적 로그아웃·탈퇴에서만 부른다.
    func clear(userID: String?) {
        guard let userID = userID?.nilIfBlank else { return }
        let prefix = "\(Self.keyPrefix)\(userID):"
        for key in defaults.dictionaryRepresentation().keys where key.hasPrefix(prefix) {
            defaults.removeObject(forKey: key)
        }
    }

    private static let keyPrefix = "voice_replaced_"
    private func key(_ userID: String, _ profileID: String) -> String {
        "\(Self.keyPrefix)\(userID):\(profileID)"
    }
}
