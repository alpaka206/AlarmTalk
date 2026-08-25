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
/// **본 값과 반영한 값을 따로 적는다.** 처음 본 프로필은 조용히 '봤다' 로만 적는데, 그걸
/// '반영했다' 로도 읽으면 곧이어 도착한 푸시가 **아무것도 하지 않고** 끝난다 — iOS 는 같은
/// 푸시에서 목록 갱신(`onVoiceChanged`)이 교체 처리(`onVoiceReplaced`)보다 먼저 끝난다.
///
/// ⚠ **표식은 뒤로 가지 않는다.** 공유 목소리 목록은 내 목소리 목록과 갱신 경로가 달라 한쪽이
/// 낡은 채로 판정에 들어올 수 있다. 되돌아가면 이미 처리한 교체를 다시 처리하고, 그 사이
/// **새 목소리로** 만든 알람을 지운다.
///
/// ⚠ `updated_at` 으로 대신하지 말 것 — 이름 변경·공유 토글도 그 값을 올린다.
///
/// ⚠ **판정·강등·확정은 한 임계구역이다.** 이 저장소가 노출하는 것은 `applyIfChanged`·
/// `applyIfNotApplied` 둘뿐이고, 강등을 **락 안에서** 부른다. 판정만 잠그면 소용없다 —
/// 판정해 둔 값을 들고 기다리는 사이 더 새 세대가 강등·확정되고 사용자가 **새 목소리로**
/// 알람을 만들면, 뒤늦게 깨어난 옛 회차가 그 알람을 되돌릴 수 없이 지운다.
///
/// ⚠ **로그아웃에서 지우지 말 것.** 로그아웃은 로컬 알람을 지우지 않고 끄기만 한다 — 그 사이
/// 다른 기기에서 교체가 일어나고 같은 계정이 다시 들어오면, 표식이 없는 기기는 첫 조회를
/// '처음 봤다' 로 읽어 **영영 강등하지 않는다.** 그 알람을 다시 켜면 지운 목소리로 운다.
struct VoiceReplacementMarkerStore {
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    /// **목록에서 새 세대를 봤으면** 강등하고 확정한다(판정→강등→확정이 한 임계구역).
    ///
    /// 처음 보는 프로필은 조용히 적어 두고 아무것도 하지 않는다 — 첫 조회를 '바뀌었다' 로
    /// 읽으면 업데이트 직후 모든 설치가 직접 입력 알람을 되돌릴 수 없이 날린다.
    ///
    /// - Parameter degrade: 강등 개수. **nil 이면 확정하지 않는다**(계정이 바뀌었거나 실패해
    ///   다음 회차가 다시 집어야 하는 경우).
    @discardableResult
    func applyIfChanged(
        userID: String?,
        profileID: String,
        invalidatedAt: String?,
        degrade: () -> Int?
    ) -> Int {
        guard let userID = userID?.nilIfBlank, !profileID.isEmpty else { return 0 }
        Self.lock.lock()
        defer { Self.lock.unlock() }
        guard changedLocked(userID, profileID, invalidatedAt) else { return 0 }
        guard let degraded = degrade() else { return 0 }
        commitLocked(userID, profileID, invalidatedAt)
        return degraded
    }

    /// **아직 반영하지 않은 세대면** 강등하고 확정한다(푸시·교체 직후 경로).
    ///
    /// 늦게 도착한 푸시가 그 사이 사용자가 **새 목소리로** 다시 만든 알람까지 지우지 않도록,
    /// 이미 그 세대 이후를 반영했으면 건너뛴다. 세대를 모르는 옛 신호는 예전처럼 무조건
    /// 반영하되 **확정하지 않는다** — 무엇을 봤는지 모르기 때문이다.
    @discardableResult
    func applyIfNotApplied(
        userID: String?,
        profileID: String,
        invalidatedAt: String?,
        degrade: () -> Int?
    ) -> Int {
        guard let userID = userID?.nilIfBlank, !profileID.isEmpty else { return 0 }
        Self.lock.lock()
        defer { Self.lock.unlock() }
        let generation = invalidatedAt?.nilIfBlank
        if let generation, hasAppliedLocked(userID, profileID, generation) { return 0 }
        guard let degraded = degrade() else { return 0 }
        if let generation { commitLocked(userID, profileID, generation) }
        return degraded
    }

    /// 첫 조회 시드 + 세대 비교. 락을 쥔 채로만 부른다.
    private func changedLocked(_ userID: String, _ profileID: String, _ invalidatedAt: String?) -> Bool {
        let key = seenKey(userID, profileID)
        let incoming = invalidatedAt ?? ""
        guard let previous = defaults.string(forKey: key) else {
            defaults.set(incoming, forKey: key)
            return false
        }
        // 서버 값은 `datetime('now')` 문자열이라 사전순 = 시간순이다. 앞선 값이면 무시한다.
        return incoming > previous
    }

    /// 이미 반영한 세대인가. **같은 값만 보면 안 된다** — 교체가 두 번 일어난 뒤 앞선 세대의
    /// 푸시가 늦게 오면 '아직 안 본 것' 으로 읽혀 뒤 세대로 만든 알람을 지운다.
    private func hasAppliedLocked(_ userID: String, _ profileID: String, _ invalidatedAt: String) -> Bool {
        guard let applied = defaults.string(forKey: appliedKey(userID, profileID)) else { return false }
        return invalidatedAt <= applied
    }

    /// 앞선 세대로 되돌리지 않는다.
    private func commitLocked(_ userID: String, _ profileID: String, _ invalidatedAt: String?) {
        let value = invalidatedAt ?? ""
        let seen = seenKey(userID, profileID)
        let applied = appliedKey(userID, profileID)
        defaults.set(max(value, defaults.string(forKey: seen) ?? ""), forKey: seen)
        defaults.set(max(value, defaults.string(forKey: applied) ?? ""), forKey: applied)
    }

    /// 저장소는 값 타입이라 호출부마다 새로 만들어진다 — 락은 **타입 단위**여야 한다.
    /// (호출부는 전부 `@MainActor` 라 이 락 안에서 다시 이 저장소를 부르는 경로가 없다.)
    private static let lock = NSLock()
    private static let seenPrefix = "voice_replaced_seen_"
    private static let appliedPrefix = "voice_replaced_applied_"
    private func seenKey(_ userID: String, _ profileID: String) -> String {
        "\(Self.seenPrefix)\(userID):\(profileID)"
    }
    private func appliedKey(_ userID: String, _ profileID: String) -> String {
        "\(Self.appliedPrefix)\(userID):\(profileID)"
    }
}
