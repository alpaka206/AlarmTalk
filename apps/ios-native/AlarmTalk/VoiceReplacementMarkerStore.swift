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
        degrade: () -> [String]?
    ) -> PendingApply {
        guard let userID = userID?.nilIfBlank, !profileID.isEmpty else { return .nothing }
        Self.lock.lock()
        defer { Self.lock.unlock() }
        guard changedLocked(userID, profileID, invalidatedAt) else { return .nothing }
        guard let degraded = degrade() else { return .failure(profileID: profileID) }
        return pendingApply(userID, profileID, generation: invalidatedAt?.nilIfBlank, degraded) {
            commitLocked(userID, profileID, invalidatedAt)
        }
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
        degrade: () -> [String]?
    ) -> PendingApply {
        guard let userID = userID?.nilIfBlank, !profileID.isEmpty else { return .nothing }
        Self.lock.lock()
        defer { Self.lock.unlock() }
        let generation = invalidatedAt?.nilIfBlank
        if let generation, hasAppliedLocked(userID, profileID, generation) { return .nothing }
        guard let degraded = degrade() else { return .failure(profileID: profileID) }
        guard let generation else {
            // 세대를 모르는 옛 신호는 반영만 하고 **확정하지 않는다**(무엇을 봤는지 모른다).
            // ⚠ 그래도 **미확인 목록은 디스크에 남긴다**(Codex #703 P1). 메모리에만 두면
            // 예약 정리가 실패한 채 실행이 끝났을 때 되짚을 근거가 사라진다 — 앞선 새로고침이
            // 이미 지금 세대를 시드해 뒀으면 다음 회차들은 '바뀐 것 없음' 으로 지나가고,
            // 그 예약은 회수된 목소리를 문 채 무기한 남는다. 이 칸은 확정이 없어 스스로
            // 비지 않으므로, **세대를 아는 회차가 확정하며 함께 비운다**(그 회차의 확인
            // 대상은 모든 칸의 합집합이라 이 id 들도 그때 확인된다).
            return pendingApply(userID, profileID, generation: nil, degraded, commit: nil)
        }
        return pendingApply(userID, profileID, generation: generation, degraded) {
            commitLocked(userID, profileID, generation)
        }
    }

    /**
     * **확인이 남은 행 목록을 들고 다닌다.**
     *
     * 강등은 성공했는데 예약 정리가 실패하면 확정하지 않고 다음 회차에 맡기는데, 그때 그
     * 행들은 **이미 톤으로 내려가 있어** 다시 강등 대상이 되지 않는다(빈 결과). 빈 결과를
     * '확인할 것이 없다' 로 읽으면 그 회차가 그냥 확정해 버려, 실패한 예약이 회수된 목소리를
     * 그대로 물고 남는다. 그래서 확정될 때까지 **디스크에 들고 있다가** 다음 회차에 함께
     * 돌려준다.
     */
    private func pendingApply(
        _ userID: String,
        _ profileID: String,
        generation: String?,
        _ degraded: [String],
        commit: (() -> Void)?
    ) -> PendingApply {
        let key = pendingKey(userID, profileID)
        // ⚠ **세대별로 나눠 들고 있는다**(Codex #703 P1). 한 배열에 섞으면 어느 순서로든
        // 사고가 난다: 앞 세대가 먼저 확정하며 통째로 비우면 뒤 세대의 목록이 사라지고,
        // 반대로 늦게 온 옛 세대가 뒤 세대의 id 를 **자기 것으로 주워** 확정하며 지워도
        // 같다. 어느 쪽이든 그 세대는 강등할 행이 없어(이미 톤이다) 다음 회차가 예약을
        // 확인하지 않은 채 확정한다 — 실패했던 예약이 회수된 목소리를 그대로 물고 남는다.
        //
        // **확인은 전부, 제거는 내 것만.** 확인은 읽기라 남의 세대 것을 함께 봐도 해가 없고
        // (오히려 봐야 한다), 지우는 것만 자기 칸으로 한정한다.
        let mine = generation ?? ""
        var buckets = (defaults.dictionary(forKey: key) as? [String: [String]]) ?? [:]
        // 세대별로 나누기 **전에** 적어 둔 값은 평평한 배열이다 — 업그레이드 도중에 미확인
        // 목록을 잃지 않도록 세대 없는 칸으로 옮긴다(그 칸은 옛 신호와 같은 취급이다).
        if buckets.isEmpty, let legacy = defaults.stringArray(forKey: key), !legacy.isEmpty {
            buckets[""] = legacy
        }
        let carriedMine = buckets[mine] ?? []
        let updatedMine = carriedMine + degraded.filter { !carriedMine.contains($0) }
        if updatedMine != carriedMine {
            buckets[mine] = updatedMine
            defaults.set(buckets, forKey: key)
        }
        // 확인 대상은 **모든 세대**의 합집합이다(중복 제거, 순서 유지).
        var seen = Set<String>()
        let unverified = buckets.keys.sorted().flatMap { buckets[$0] ?? [] }.filter { seen.insert($0).inserted }
        // 확정 뒤 이 프로필에 다른 세대가 남았는지 — 남았으면 그 목소리를 다시 고를 수
        // 있게 하면 안 된다(뒤 세대가 재시도할 때 그 사이 만든 알람을 벗긴다).
        //
        // ⚠ **저장된 값을 그때그때 다시 읽는다.** 확정이 없는 회차(세대 없는 옛 신호)도
        // 같은 판정을 써야 하므로, 커밋 클로저가 세운 지역 변수에 기대지 않는다.
        let verifiedIDs = Set(unverified)
        let noGenerationRemains: () -> Bool = { [defaults] in
            let latest = (defaults.dictionary(forKey: key) as? [String: [String]]) ?? [:]
            return !latest.contains { _, ids in !ids.allSatisfy { verifiedIDs.contains($0) } }
        }
        return PendingApply(
            profileID: profileID,
            degraded: degraded,
            unverified: unverified,
            commit: commit.map { commit in
                { [defaults] in
                    commit()
                    var latest = (defaults.dictionary(forKey: key) as? [String: [String]]) ?? [:]
                    latest.removeValue(forKey: mine)
                    // ⚠ **이 회차가 확인을 마친 칸은 전부 비운다.** `unverified` 는 만들어질
                    // 때 **모든 칸의 합집합**이었고 확정은 그 전부의 예약을 확인한 뒤에만
                    // 온다 — 그러니 그 안에 든 id 로만 이뤄진 칸은 이미 끝난 칸이다.
                    // 내 칸만 지우면 **확정 없이 남은 옛 칸**(예: 앞 회차가 확인에 실패해
                    // 남긴 것, 확정이 아예 없는 세대 없는 칸)이 영원히 남아, 아래
                    // `remaining` 이 늘 참이 되고 그 목소리가 **영구히 '정리 중'** 으로
                    // 굳는다 — 다시 고를 수 없다.
                    //
                    // 스냅샷 **뒤에** 새로 얹힌 칸(다음 세대)은 확인하지 못한 id 를 갖고
                    // 있으므로 남는다 — 그게 `remaining` 이 잡아야 할 진짜 대상이다.
                    latest = latest.filter { _, ids in !ids.allSatisfy { verifiedIDs.contains($0) } }
                    if latest.isEmpty {
                        defaults.removeObject(forKey: key)
                    } else {
                        defaults.set(latest, forKey: key)
                    }
                }
            },
            remainingAfterCommit: noGenerationRemains
        )
    }

    /**
     * 강등까지 끝났고, **확정만 남은 상태.**
     *
     * ⚠ `confirm()` 은 **예약(AlarmKit)까지 실제로 맞춘 뒤에** 부른다. 강등은 로컬 행을 고칠
     * 뿐이고 울리는 것은 이미 구워 둔 예약이라, 확정을 먼저 하면 그 사이 실행이 끝났을 때
     * 다음 회차가 같은 세대를 건너뛰어 **회수된 목소리가 그대로 예약된 채 남는다.**
     * 부르지 않으면 다음 회차가 다시 집는다(안전한 방향).
     */
    struct PendingApply {
        /// 어떤 목소리의 교체인가 — 정리가 끝날 때까지 그 목소리를 고르지 못하게 막는 데 쓴다.
        let profileID: String
        /// **이번 회차에** 강등한 알람 id 들. 사용자 안내(대기표) 개수는 이 값으로 센다.
        let degraded: [String]
        /// 확정 전에 예약을 확인해야 할 id 들 — 이번 회차 것 **+ 지난 회차에서 확인하지 못하고
        /// 넘어온 것**. 빈 회차를 '확인할 것 없음' 으로 읽으면 실패한 예약이 그대로 남는다.
        let unverified: [String]
        /// **강등 자체가 실패했다**(저장 실패·계정 변경). 확정할 수 없고, 그 목소리는
        /// 계속 '정리 중' 이어야 한다.
        ///
        /// ⚠ `.nothing` 으로 뭉개지 말 것(Codex #703 P1) — 프로필 id 를 잃으면 실패한
        /// 회차가 **아무 표시도 남기지 않고** 끝나, 그 목소리가 확정 없이 고를 수 있는 채 남는다.
        let failed: Bool
        /// 확정 뒤 이 프로필에 **다른 세대의 미확인 목록이 남았는가.**
        private let remainingAfterCommit: (() -> Bool)?
        private let commit: (() -> Void)?

        init(
            profileID: String,
            degraded: [String],
            unverified: [String],
            failed: Bool = false,
            commit: (() -> Void)?,
            remainingAfterCommit: (() -> Bool)? = nil
        ) {
            self.profileID = profileID
            self.degraded = degraded
            self.unverified = unverified
            self.failed = failed
            self.commit = commit
            self.remainingAfterCommit = remainingAfterCommit
        }

        /// 강등이 실패해 확정할 수 없는 회차 — **프로필 id 는 들고 간다.**
        static func failure(profileID: String) -> PendingApply {
            PendingApply(profileID: profileID, degraded: [], unverified: [], failed: true, commit: nil)
        }

        /// 아무것도 하지 않은 회차(판정에서 걸렸거나 강등이 확정을 거부했다).
        static var nothing: PendingApply {
            PendingApply(profileID: "", degraded: [], unverified: [], commit: nil)
        }

        /// 예약까지 맞춘 뒤에만 부른다.
        ///
        /// 확정도 판정과 **같은 자물쇠**를 거친다 — 다른 회차가 그 사이 값을 읽거나 쓰면
        /// 표식이 과거로 되돌아갈 수 있다.
        /// - Returns: 이 프로필의 **모든 세대**가 끝났는가. false 면 다른 세대가 아직
        ///   확인을 기다리는 것이라 그 목소리를 다시 고를 수 있게 하면 안 된다
        ///   (Codex #703 P1 — 뒤 세대가 재시도할 때 그 사이 만든 알람을 벗긴다).
        @discardableResult
        func confirm() -> Bool {
            guard !failed else { return false }
            // ⚠ **확정하지 못하는 회차는 풀지 않는다.** 세대를 모르는 옛 신호는 `commit` 이
            // nil 이라 `applied` 를 전진시키지 못한다 — 그런 회차가 "다 끝났다" 고 답하면
            // **아직 반영되지 않은 진짜 세대가 남아 있는데도** 그 목소리가 다시 고를 수 있게
            // 되고, 그때 만든 알람을 다음 회차가 벗긴다.
            //
            // 예약 확인만으로는 부족하다: `remainingAfterCommit` 은 "확인이 끝난 칸인가" 를
            // 보지 "그 세대를 확정했는가" 를 보지 않는다. 확정 없이 푸는 유일한 갈래를 여기서
            // 막는다(할 일이 없던 `.nothing` 은 호출부가 프로필 id 로 이미 걸러 낸다).
            guard let commit else { return false }
            VoiceReplacementMarkerStore.lock.lock()
            defer { VoiceReplacementMarkerStore.lock.unlock() }
            commit()
            return remainingAfterCommit?() ?? true
        }
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
    private static let pendingPrefix = "voice_replaced_pending_"
    private static let seenPrefix = "voice_replaced_seen_"
    private static let appliedPrefix = "voice_replaced_applied_"
    private func seenKey(_ userID: String, _ profileID: String) -> String {
        "\(Self.seenPrefix)\(userID):\(profileID)"
    }
    private func appliedKey(_ userID: String, _ profileID: String) -> String {
        "\(Self.appliedPrefix)\(userID):\(profileID)"
    }
    private func pendingKey(_ userID: String, _ profileID: String) -> String {
        "\(Self.pendingPrefix)\(userID):\(profileID)"
    }
}
