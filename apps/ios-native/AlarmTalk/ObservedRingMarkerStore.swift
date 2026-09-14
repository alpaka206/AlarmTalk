import Foundation

/// **이번 울림을 관찰자가 적었는가** 를 남기는 표시.
///
/// iOS 는 발사 시점에 우리 코드가 돌지 않는다(AlarmKit). 그래서 울림을 두 자리에서 적는다 —
/// 앱이 살아 있으면 `.alerting` 진입에서, 아니면 해제·다시 울림 인텐트에서
/// (`docs/spec/usage-events.md` §2). 그 둘이 같은 회차를 두 번 적지 않게 가르는 표시다.
///
/// ⚠ **행의 상태(`ringing`)로 가르면 안 된다**(2026-09-07 리뷰 35차). 두 방향으로 틀린다:
/// - 관찰자가 적은 뒤 프로세스가 죽고 인텐트가 콜드로 깨어나면 **행을 못 읽어** 울림을 한 번
///   더 적는다(id 가 달라 서버 멱등으로도 안 걸린다).
/// - 반대로 콜드 인텐트는 `markStopped` 를 못 돌려 행에 `ringing` 이 남는다 — 그러면 다음
///   회차의 **정당한 울림을 삼킨다.** 삼키는 쪽이 더 나쁘다(잃은 회차는 되짚을 수 없다).
///
/// 그래서 회차마다 표시를 남기고, 인텐트가 **소비**한다. 표시가 있으면 관찰자가 적은 것이다.
/// ⚠ **메인에서만 만진다.** `mark`·`consume` 이 사전 전체를 읽고-고쳐-쓰므로, 다른 스레드가
/// 끼어들면 소비된 표시를 되살려 **다음 회차를 삼킨다.** 인텐트의 소비가 `@MainActor` 라
/// 남기는 쪽도 메인으로 맞춘다(`AlarmKitViewModel` 이 큐 콜백에서 메인으로 되돌아온다).
@MainActor
enum ObservedRingMarkerStore {
    private static let key = "observed_ring_markers"

    /// 표시가 오래 남아 다음 회차를 삼키지 않도록 두는 상한.
    ///
    /// 아무도 안 누른 울림은 표시를 그대로 남긴다(소비할 사람이 없다). 상한이 없으면 그
    /// 표시가 **다음 울림**을 관찰자가 적은 것으로 오인하게 만든다 — 그건 삼키는 쪽이라
    /// 더 나쁘다. 반복 알람의 가장 짧은 주기(하루)보다 넉넉히 짧게 잡는다.
    static let staleAfter: TimeInterval = 6 * 60 * 60

    /// **소비 직후에 도착한 표시를 무시하는 창**(2026-09-07 리뷰 37차).
    ///
    /// 표시는 울림이 **파일에 적힌 뒤에** 남는다(`UsageEventQueue.record` 의 `onPersisted`).
    /// 그 사이에 사용자가 누르면 인텐트는 표시 없는 회차로 보고 울림을 적고(중복 — 옳은
    /// 방향), **그 뒤에** 도착한 콜백이 이미 소비된 회차의 표시를 남긴다. 그 표시는 아무도
    /// 소비하지 않아 `staleAfter` 동안 살아 **다음 회차의 정당한 울림을 삼킨다.**
    ///
    /// ⚠ **이 값이 길어도 잃는 것은 없다** — 표시를 *안 남기는* 쪽이라 최악이 중복 1건이다
    /// (`staleAfter` 와 방향이 반대다). 그래도 가장 짧은 다시 울림(1분)보다는 훨씬 짧게 둔다.
    private static let lateMarkWindow: Duration = .seconds(10)

    /// 이 프로세스가 마지막으로 소비한 시각. **디스크에 두지 않는다** — 뒤늦은 표시는 그것을
    /// 큐에 건 프로세스 안에서만 도착하므로, 프로세스와 함께 사라지는 것이 맞다.
    ///
    /// ⚠ **벽시계로 재지 않는다**(2026-09-08 리뷰 40차). 기기 시계는 양쪽으로 튀고
    /// (NTP 보정·수동 변경) **두 방향 다 틀린다**:
    /// - **뒤로 가면** `지금 - 소비` 가 음수라 아래 창을 **언제나** 통과한다. 그 구간의
    ///   관찰은 표를 못 받아 표시를 남기지 못하고, 울림은 그대로 적히므로(관찰자의 기록은
    ///   표와 무관하다) 같은 회차가 관찰자와 인텐트 **양쪽에서** 적힌다. 사건 `id` 가 달라
    ///   서버 `INSERT OR IGNORE` 로도 안 겹친다. **중복 1건** — 견딜 수 있는 방향이다.
    /// - **앞으로 뛰면** 소비 2초 뒤의 늦은 `.alerting` 이 한참 지난 것으로 보여 창을
    ///   **빠져나간다.** 이미 끝난 회차에 표시가 남고, 아무도 소비하지 않은 그 표시를
    ///   **다음 회차**가 소비해 정당한 울림을 **삼킨다.** 이쪽은 되짚을 수 없다
    ///   (`docs/spec/usage-events.md` §2).
    /// 음수만 막으면 뒤쪽 절반이 그대로 남고, 음수를 그냥 통과시키면 앞쪽 구간에서도 늦은
    /// 표시가 안 걸러져 삼킨다. 단조 시계는 **두 방향을 함께** 없앤다 — 이 값은 **이
    /// 프로세스 안에서만** 비교되므로(디스크에 남는 표시의 시각은 프로세스를 건너 비교돼
    /// 계속 벽시계다) 그래도 된다.
    private static var lastConsumedAt: [String: ContinuousClock.Instant] = [:]

    /// 위 값을 재는 시계. **`ContinuousClock` 이다** — 잠든 사이에도 흘러야 한다.
    /// `SuspendingClock`·`ProcessInfo.systemUptime` 은 잠들면 멈춰서, 밤새 잠든 폰의 다음
    /// 울림이 "소비 10초 안" 으로 보인다(그 회차 표시가 사라져 울림이 두 번 적힌다).
    /// 테스트가 갈아 끼운다 — `reset()` 이 되돌려 놓는다.
    static var monotonicNow: () -> ContinuousClock.Instant = { ContinuousClock.now }

    /// 열려 있는 관찰의 일련번호. **늦게 도착한 콜백을 시각이 아니라 인과로 가른다**
    /// (2026-09-07 리뷰 38차) — 콜백은 파일 쓰기 뒤 메인 큐를 거치므로 **도착 시각에
    /// 상한이 없다**(앱이 잠들면 몇 분 뒤에 온다). 그 사이 소비가 지나갔으면 그 표는
    /// 무효다: 소비가 번호를 지우므로, 늦게 온 커밋은 아무리 늦어도 걸러진다.
    private static var openObservations: [String: UInt64] = [:]
    private static var serialCounter: UInt64 = 0

    /// `.alerting` 을 본 순간 **동기로** 부른다. 돌려주는 표를 커밋에 그대로 넘긴다.
    ///
    /// 소비가 방금 지나간 회차면 nil 이다 — 그건 이미 끝난 울림을 뒤늦게 처리하는 것이라,
    /// 토큰으로는 못 가른다(그 표는 지금 막 발급돼 유효하다). 그래서 짧은 창을 함께 쓴다.
    static func beginObservation(alarmKitID: String) -> UInt64? {
        guard !alarmKitID.isEmpty else { return nil }
        if let consumed = lastConsumedAt[alarmKitID],
           monotonicNow() - consumed < lateMarkWindow {
            return nil
        }
        serialCounter += 1
        openObservations[alarmKitID] = serialCounter
        return serialCounter
    }

    /// 관찰자가 이번 회차를 적었다고 남긴다. **적은 뒤에** 부른다 — 순서를 뒤집으면
    /// 그 사이에 죽었을 때 적히지 않은 울림을 적힌 것으로 오인해 삼킨다.
    /// 울림이 파일에 적힌 뒤에 부른다. [beginObservation] 이 준 표를 그대로 넘긴다.
    ///
    /// 표가 이미 무효면(소비가 지나갔거나 더 새 관찰이 열렸으면) **아무것도 남기지 않는다.**
    /// 남기면 그 표시는 아무도 소비하지 않아 다음 회차의 정당한 울림을 삼킨다.
    static func commit(alarmKitID: String, observation: UInt64, now: Date = Date()) {
        guard openObservations[alarmKitID] == observation else { return }
        openObservations.removeValue(forKey: alarmKitID)
        mark(alarmKitID: alarmKitID, now: now)
    }

    static func mark(alarmKitID: String, now: Date = Date()) {
        guard !alarmKitID.isEmpty else { return }
        // 방금 소비가 지나갔으면 이 표시는 **이미 끝난 회차**의 것이다 — 남기면 다음 회차를
        // 삼킨다. 버리는 쪽의 최악은 중복 1건이다.
        // ⚠ 이 판정만 `monotonicNow()` 다 — 아래 `now` 는 **디스크 표시의 시각**이라 계속
        //   벽시계다(프로세스를 건너 비교된다). 호출자가 `now` 를 흔들어도 이 창은 안 움직인다.
        if let consumed = lastConsumedAt[alarmKitID],
           monotonicNow() - consumed < lateMarkWindow {
            return
        }
        var markers = load()
        markers[alarmKitID] = now.timeIntervalSince1970
        prune(&markers, now: now)
        UserDefaults.standard.set(markers, forKey: key)
    }

    /// 표시를 **지우고**, 그것이 이번 회차의 것이었는지 답한다.
    ///
    /// 지우는 것은 언제나다 — 낡은 표시를 남겨 두면 다음 회차를 삼킨다.
    static func consume(alarmKitID: String, now: Date = Date()) -> Bool {
        guard !alarmKitID.isEmpty else { return false }
        lastConsumedAt[alarmKitID] = monotonicNow()
        // 열려 있던 관찰을 무효로 만든다 — 그 콜백이 몇 분 뒤에 와도 표시를 남기지 못한다.
        openObservations.removeValue(forKey: alarmKitID)
        var markers = load()
        let stamp = markers.removeValue(forKey: alarmKitID)
        prune(&markers, now: now)
        UserDefaults.standard.set(markers, forKey: key)
        guard let stamp else { return false }
        // ⚠ **미래에 앉은 표시는 이번 회차의 것이 아니다.** 기기 시계가 뒤로 가면(수동 변경·
        // 시각 보정) `now - stamp` 가 음수라 이 비교를 **언제나** 통과한다 — 시계를 되돌린
        // 만큼 6시간을 넘겨 살아남아 **어제 표시가 오늘의 정당한 울림을 삼킨다.**
        // 나이가 음수면 믿지 않는다: 그쪽 최악은 중복 1건이고, 삼킨 회차는 되짚을 수 없다
        // (`docs/spec/usage-events.md` §2). 서버가 `occurred_at` 을 도착 시각으로 자르는
        // 것과 같은 이유다(`routes/events.ts` 의 `boundOccurredAt`).
        let age = now.timeIntervalSince1970 - stamp
        return age >= 0 && age < staleAfter
    }

    /// 테스트용 — 남은 표시를 전부 지운다.
    static func reset() {
        lastConsumedAt = [:]
        openObservations = [:]
        monotonicNow = { ContinuousClock.now }
        UserDefaults.standard.removeObject(forKey: key)
    }

    private static func load() -> [String: TimeInterval] {
        UserDefaults.standard.dictionary(forKey: key) as? [String: TimeInterval] ?? [:]
    }

    private static func prune(_ markers: inout [String: TimeInterval], now: Date) {
        let nowStamp = now.timeIntervalSince1970
        let cutoff = nowStamp - staleAfter
        // 미래 표시는 나이가 음수라 만료되지 않는다 — 함께 걷어낸다. `mark` 는 같은 `now`
        // 로 적고 곧바로 이 정리를 부르므로 방금 적은 것은 같은 값이라 남는다.
        // 잘못 걷어도 최악은 중복 1건이다(표시가 없으면 인텐트가 적는다).
        markers = markers.filter { $0.value >= cutoff && $0.value <= nowStamp }
    }
}
