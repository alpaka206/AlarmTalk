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
/// 서버 표식(`datetime('now')` → `"2026-09-03 12:34:56"`, **UTC**)을 `Date` 로.
///
/// 강등이 "이 시각 **이전에** 만든 오디오만" 을 지킬 때 쓴다(2026-09-03 리뷰 23차) —
/// 시각을 안 보면 교체가 배포된 뒤에 새 목소리로 제대로 만든 알람까지 톤으로 깎는다.
/// 못 읽으면 nil 이고, 그때는 예전처럼 시각을 보지 않는다.
/// 안드로이드 `parseVoiceMarkerMillis` 와 같은 규칙이다.
func parseVoiceMarkerDate(_ marker: String?) -> Date? {
    guard let raw = marker?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else {
        return nil
    }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
    return formatter.date(from: raw)
}

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
        let generation = invalidatedAt?.nilIfBlank
        guard changedLocked(userID, profileID, invalidatedAt) else {
            // ⚠ **바뀐 게 없어도 남은 확인은 이어서 한다**(Codex #703 P1). 세대 없는 옛
            // 신호가 남긴 칸은 **스스로 확정할 수 없고**, 그 뒤 목록은 늘 '바뀐 것 없음' 이라
            // 여기서 물러서면 그 칸을 **다시 집을 경로가 하나도 없다** — 정리에 실패한 예약이
            // 회수된 목소리를 문 채 무기한 남고(전경 sweep 전까지), 메모리 표시는 재시작에
            // 사라져 그 목소리를 다시 고를 수도 있게 된다.
            //
            // 강등은 하지 않는다(바뀐 것이 없으니 내릴 것도 없다) — **확인만** 이어서 한다.
            guard hasPendingLocked(userID, profileID) else { return .nothing }
            return pendingApply(
                userID, profileID,
                generation: generation, [],
                commit: commitClosure(userID, profileID, generation)
            )
        }
        guard let degraded = degrade() else {
            markRetryLocked(userID, profileID, invalidatedAt)
            return .failure(profileID: profileID)
        }
        return pendingApply(
            userID, profileID,
            generation: generation, degraded,
            commit: commitClosure(userID, profileID, generation)
        )
    }

    /// 확정 클로저 — **세대를 모르면 nil 이다**(Codex #703 P1).
    ///
    /// `PendingApply.confirm()` 은 `commit == nil` 을 "이 회차로는 풀 수 없다" 로 읽는다.
    /// 세대 없는 회차에 클로저를 쥐여 주면 그 판정이 무너져, `applied` 를 전진시키지 못한
    /// 채로 세대 없는 칸만 비우고 목소리를 풀어 준다 — 아직 반영되지 않은 진짜 세대가 남아
    /// 있는데도 고를 수 있게 되고, 그때 만든 알람을 뒤늦은 중복 푸시가 벗긴다.
    /// 그 칸은 **세대를 아는 회차가 확정하며 함께 비운다**(`pendingApply` 의 `settled` 판정).
    private func commitClosure(_ userID: String, _ profileID: String, _ generation: String?) -> (() -> Void)? {
        guard let generation else { return nil }
        return { self.commitLocked(userID, profileID, generation) }
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
        guard let degraded = degrade() else {
            markRetryLocked(userID, profileID, invalidatedAt)
            return .failure(profileID: profileID)
        }
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
        // ⚠ **남았는지는 '세대 값' 으로 가른다 — 알람 id 로 가르지 말 것**(Codex #703 P1).
        // 두 세대가 **같은 알람들**에 영향을 주는 것이 보통이라, "내가 확인한 id 로만 이뤄진
        // 칸" 을 지우면 **뒤 세대의 칸까지** 지운다 — 그 세대는 확정된 적이 없는데 목록이
        // 비어 목소리가 풀리고, 그 사이 만든 알람을 뒤 세대의 재시도가 벗긴다.
        //
        // 대신 확정으로 **`applied` 가 어디까지 올라갔는지**를 보고 가른다:
        //  - 내 칸과 세대 없는 칸: 지운다(후자는 확정이 없어 **스스로는 영영 못 비운다**).
        //  - `applied` 이하의 옛 칸: 이미 이 확정에 포함된 것이라 지운다(영구 잔류 방지).
        //  - `applied` 보다 **뒤 세대**의 칸: 남긴다 — 그게 진짜 '아직 반영 안 됨' 이다.
        let appliedField = appliedKey(userID, profileID)
        let settledBox = SettledBox()
        // ⚠ **스냅샷 이후에 얹힌 것은 건드리지 않는다**(Codex #703 P1). 확정은 비동기 예약
        // 정리가 끝난 뒤에 오는데, 그 사이 다른 신호가 **새 칸을 얹거나 기존 칸에 id 를
        // 더할 수 있다.** 그것들은 이 회차가 확인한 적이 없으므로 지우면 재시도 근거가
        // 사라진다 — 지울 대상은 **내가 스냅샷에서 본 그 id 들**뿐이다.
        let snapshot = buckets
        return PendingApply(
            profileID: profileID,
            degraded: degraded,
            unverified: unverified,
            commit: commit.map { commit in
                { [defaults] in
                    commit()
                    var latest = (defaults.dictionary(forKey: key) as? [String: [String]]) ?? [:]
                    let applied = defaults.string(forKey: appliedField) ?? ""
                    for (generation, snapshotIDs) in snapshot {
                        // 이 확정으로 끝난 칸인가 — 내 칸, 세대 없는 칸(스스로는 영영 못
                        // 비운다), 그리고 `applied` 이하로 밀려난 옛 칸.
                        let settled = generation == mine || generation.isEmpty || generation <= applied
                        guard settled else { continue }
                        // **스냅샷에서 본 id 만** 뺀다 — 그 뒤에 더해진 id 는 남긴다.
                        let remainingIDs = (latest[generation] ?? []).filter { !snapshotIDs.contains($0) }
                        if remainingIDs.isEmpty {
                            latest.removeValue(forKey: generation)
                        } else {
                            latest[generation] = remainingIDs
                        }
                    }
                    if latest.isEmpty {
                        defaults.removeObject(forKey: key)
                    } else {
                        defaults.set(latest, forKey: key)
                    }
                    settledBox.allSettled = latest.isEmpty
                }
            },
            remainingAfterCommit: { settledBox.allSettled }
        )
    }

    /// 확정 클로저가 계산한 "이 프로필의 모든 세대가 끝났는가" 를 담아 두는 상자.
    /// 두 클로저가 **같은 값**을 봐야 해서 참조 타입으로 둔다.
    private final class SettledBox {
        var allSettled = false
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

    /**
     * **아직 끝나지 않은 정리가 남은 프로필인가**(재시작 뒤 '정리 중' 표시를 되살리는 근거).
     *
     * ⚠ 메모리 집합만으로는 부족하다(Codex #703 P1). 프로세스가 끝나면 그 집합은 비는데,
     * 저장소에는 미확인 칸·재시도 표식이 그대로 남아 있다 — 다음 권위 새로고침이 표시를
     * 다시 세우기 **전에** 편집기가 그 목소리를 고를 수 있게 되고, 캐시에 남은 TTS 로
     * 알람까지 저장된다. 그 알람을 다음 재시도가 벗긴다.
     * 안드로이드 짝은 `VoiceReplacementMarkerStore.settlingProfileIds`(디스크 집합).
     */
    func unsettledProfileIDs(userID: String?, candidateProfileIDs: [String]) -> Set<String> {
        guard let userID = userID?.nilIfBlank else { return [] }
        Self.lock.lock()
        defer { Self.lock.unlock() }
        return Set(
            candidateProfileIDs.filter { profileID in
                !profileID.isEmpty &&
                    (hasPendingLocked(userID, profileID) ||
                        defaults.string(forKey: retryKey(userID, profileID)) != nil)
            }
        )
    }

    /// 확인이 남은 칸이 있는가. 락을 쥔 채로만 부른다.
    private func hasPendingLocked(_ userID: String, _ profileID: String) -> Bool {
        let key = pendingKey(userID, profileID)
        if let buckets = defaults.dictionary(forKey: key) as? [String: [String]] {
            return buckets.contains { !$0.value.isEmpty }
        }
        // 세대별로 나누기 전의 평평한 배열도 확인 대상이다.
        return !(defaults.stringArray(forKey: key) ?? []).isEmpty
    }

    /// 이 세대를 지금 반영해야 하는가. 락을 쥔 채로만 부른다.
    ///
    /// ⚠ **판정은 '봤다' 가 아니라 '반영했다' 기준이다**(Codex #703 P1 — 2026-08-25 설계 정정).
    /// 예전에는 `seen` 하나만 보고 `incoming > seen` 으로 갈랐는데, `seen` 은 확정할 때도 함께
    /// 올라갔다. 그래서 **강등이 실패한 세대**도 `seen` 은 이미 그 값이라 다음 회차부터
    /// '바뀐 것 없음' 이 되어 **영영 재시도되지 않았다** — 재시작하면 메모리 표시도 사라져,
    /// 회수된 목소리를 문 알람이 그대로 남고 그 목소리를 다시 고를 수도 있게 된다.
    ///
    /// 두 값의 역할을 갈랐다:
    ///  - `seen`: **처음 본 세대**(설치·업그레이드 직후의 기준선). **한 번만 쓴다.**
    ///    첫 조회를 '바뀌었다' 로 읽으면 모든 설치가 직접 입력 알람을 날리므로 필요하다.
    ///  - `applied`: **확정한 세대.** 확정은 강등과 예약 정리가 모두 끝나야 일어난다.
    ///
    /// 그래서 반영하지 못한 세대는 `applied` 가 그대로라 **끝날 때까지 매 회차 다시 집힌다.**
    private func changedLocked(_ userID: String, _ profileID: String, _ invalidatedAt: String?) -> Bool {
        let key = seenKey(userID, profileID)
        let incoming = invalidatedAt ?? ""
        guard let baseline = defaults.string(forKey: key) else {
            defaults.set(incoming, forKey: key)
            // ⚠ **이 기기가 반영에 실패한 적이 있으면 첫 조회라도 집는다**(Codex #703 P1).
            // 목록에 한 번도 오르지 않은 프로필에 옛 푸시가 와서 실패하면 세대도 기준선도
            // 없어 sentinel 만 남는다 — 그걸 안 보면 이 시드가 '바뀐 것 없음' 으로 끝나
            // 정리 중 표시가 풀리고, 그 틈에 만든 알람을 뒤늦은 재시도가 벗긴다.
            // 업데이트 직후 모든 설치가 강등되는 일은 없다 — sentinel 은 **실제로 실패한
            // 기기에만** 있다.
            if defaults.string(forKey: retryKey(userID, profileID)) != nil { return true }
            // ⚠ **기본(시스템) 목소리는 첫 조회라도 집는다**(2026-09-03 리뷰 22차).
            //
            //   마이그레이션 `#111` 은 DB 만 고치고 **푸시를 보내지 않는다.** 그 뒤에 앱을
            //   처음 연 기기는 그때의 표식을 **기준선으로 삼고 넘어가**, 그 목소리로 만든
            //   직접 입력 알람이 **영영 옛 목소리로 운다** — 이름과 미리듣기만 새 목소리다.
            //
            //   시스템 목소리에서는 이 값이 **제자리 교체로만** 채워진다(등록·재등록 같은
            //   일반 경로가 없다). 그래서 "서버에 표식이 있는데 적어 둔 적이 없다" 를
            //   **아직 반영하지 않았다**로 읽어도 모호하지 않다. 클론은 기준선 의미를
            //   그대로 유지한다 — 거기서 열면 재등록 때마다 없던 강등이 생긴다.
            //   ⚠ 새로 깐 기기에서는 대상 알람이 0개라 아무 일도 일어나지 않는다.
            //   안드로이드 `VoiceReplacementMarkerStore.seenLocked` 와 같은 규칙이다.
            return !incoming.isEmpty && isSystemVoiceId(profileID)
        }
        // 서버 값은 `datetime('now')` 문자열이라 사전순 = 시간순이다.
        let applied = defaults.string(forKey: appliedKey(userID, profileID)) ?? ""
        guard incoming > applied else { return false }
        // ⚠ **기준선과 같은 세대라도 '시도했다 실패한' 것이면 다시 집는다**(Codex #703 P1).
        // 목록이 먼저 도착해 그 세대를 기준선으로 적어 둔 뒤, **같은 푸시**의 반영이
        // 실패하면 그 세대는 `incoming > baseline` 을 영영 통과하지 못한다 — `applied` 는
        // 비어 있는데도 다시 집을 길이 없어, 회수된 목소리가 예약된 채 남고 재시작하면
        // 메모리의 '정리 중' 표시마저 사라진다.
        if incoming == defaults.string(forKey: retryKey(userID, profileID)) { return true }
        return incoming > baseline
    }

    /// 반영에 실패해 **다시 집어야 하는** 세대. 확정하면 지운다.
    ///
    /// ⚠ **뒤로 되돌리지 않는다**(Codex #703 P1). 세대 B 가 실패해 표식이 남은 뒤 늦게
    /// 도착한 **앞선** 세대 A 가 또 실패하면, 그대로 쓰면 표식이 A 로 내려간다. 권위 목록은
    /// 여전히 B 를 주는데 B 는 기준선과 같으므로 `changedLocked` 가 `incoming == retry` 도
    /// `incoming > baseline` 도 아니라고 답한다 — **B 는 영영 재시도되지 않는다.**
    ///
    /// ⚠ **세대를 모르는 실패는 기준선으로 대신 적는다**(Codex #703 P1). 옛 신호에는
    /// 세대가 없어 남길 값이 없는데, 그냥 지나가면 프로세스가 끝나는 순간 재시도 근거가
    /// 사라진다(메모리의 '정리 중' 표시는 사라지고, 다음 목록은 기준선과 같아 '바뀐 것
    /// 없음' 이며, 성공한 갈래와 달리 **남겨 둔 칸도 없다**). 그 회차가 실제로 보고 있던
    /// 세대는 기준선이므로 그 값을 적으면 다음 권위 새로고침이 그대로 다시 집는다.
    /// 안드로이드 짝은 `VoiceReplacementMarkerStore.markRetryLocked`.
    private func markRetryLocked(_ userID: String, _ profileID: String, _ generation: String?) {
        // 세대도 기준선도 없으면 sentinel 을 남긴다 — 실제 세대는 `datetime('now')` 문자열
        // 이라 사전순으로 이 값보다 크므로, 첫 권위 세대가 확정하며 곧바로 지워 간다
        // (`commitLocked` 의 `retry <= value`). 안드로이드 `RETRY_SENTINEL` 과 같은 값이다.
        let generation = generation?.nilIfBlank
            ?? defaults.string(forKey: seenKey(userID, profileID))?.nilIfBlank
            ?? Self.retrySentinel
        let key = retryKey(userID, profileID)
        let previous = defaults.string(forKey: key) ?? ""
        let newest = max(generation, previous)
        guard newest != previous else { return }
        defaults.set(newest, forKey: key)
    }

    /// 이미 반영한 세대인가. **같은 값만 보면 안 된다** — 교체가 두 번 일어난 뒤 앞선 세대의
    /// 푸시가 늦게 오면 '아직 안 본 것' 으로 읽혀 뒤 세대로 만든 알람을 지운다.
    private func hasAppliedLocked(_ userID: String, _ profileID: String, _ invalidatedAt: String) -> Bool {
        guard let applied = defaults.string(forKey: appliedKey(userID, profileID)) else { return false }
        return invalidatedAt <= applied
    }

    /// 앞선 세대로 되돌리지 않는다.
    ///
    /// ⚠ **`seen` 은 건드리지 않는다**(2026-08-25 설계 정정). 그건 '처음 본 기준선' 이라
    /// 한 번만 쓴다 — 확정할 때 함께 올리면 **실패한 세대가 '이미 본 것'** 이 되어 다음
    /// 회차부터 재시도되지 않는다(`changedLocked` 주석).
    private func commitLocked(_ userID: String, _ profileID: String, _ invalidatedAt: String?) {
        let value = invalidatedAt ?? ""
        let applied = appliedKey(userID, profileID)
        defaults.set(max(value, defaults.string(forKey: applied) ?? ""), forKey: applied)
        // 반영했으니 재시도 표시는 지운다(그 세대든 그보다 앞선 것이든 끝났다).
        if let retry = defaults.string(forKey: retryKey(userID, profileID)), retry <= value {
            defaults.removeObject(forKey: retryKey(userID, profileID))
        }
    }

    /// 저장소는 값 타입이라 호출부마다 새로 만들어진다 — 락은 **타입 단위**여야 한다.
    /// (호출부는 전부 `@MainActor` 라 이 락 안에서 다시 이 저장소를 부르는 경로가 없다.)
    private static let lock = NSLock()
    private static let pendingPrefix = "voice_replaced_pending_"
    private static let seenPrefix = "voice_replaced_seen_"
    private static let appliedPrefix = "voice_replaced_applied_"
    private static let retryPrefix = "voice_replaced_retry_"

    /// 세대도 기준선도 없을 때 남기는 재시도 표식. 안드로이드 `RETRY_SENTINEL` 과 같은 값.
    private static let retrySentinel = "0"
    private func seenKey(_ userID: String, _ profileID: String) -> String {
        "\(Self.seenPrefix)\(userID):\(profileID)"
    }
    private func appliedKey(_ userID: String, _ profileID: String) -> String {
        "\(Self.appliedPrefix)\(userID):\(profileID)"
    }
    private func retryKey(_ userID: String, _ profileID: String) -> String {
        "\(Self.retryPrefix)\(userID):\(profileID)"
    }
    private func pendingKey(_ userID: String, _ profileID: String) -> String {
        "\(Self.pendingPrefix)\(userID):\(profileID)"
    }
}
