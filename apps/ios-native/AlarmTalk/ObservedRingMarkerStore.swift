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
    private static let lateMarkWindow: TimeInterval = 10

    /// 이 프로세스가 마지막으로 소비한 시각. **디스크에 두지 않는다** — 뒤늦은 표시는 그것을
    /// 큐에 건 프로세스 안에서만 도착하므로, 프로세스와 함께 사라지는 것이 맞다.
    private static var lastConsumedAt: [String: TimeInterval] = [:]

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
    static func beginObservation(alarmKitID: String, now: Date = Date()) -> UInt64? {
        guard !alarmKitID.isEmpty else { return nil }
        if let consumed = lastConsumedAt[alarmKitID],
           now.timeIntervalSince1970 - consumed < lateMarkWindow {
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
        if let consumed = lastConsumedAt[alarmKitID],
           now.timeIntervalSince1970 - consumed < lateMarkWindow {
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
        lastConsumedAt[alarmKitID] = now.timeIntervalSince1970
        // 열려 있던 관찰을 무효로 만든다 — 그 콜백이 몇 분 뒤에 와도 표시를 남기지 못한다.
        openObservations.removeValue(forKey: alarmKitID)
        var markers = load()
        let stamp = markers.removeValue(forKey: alarmKitID)
        prune(&markers, now: now)
        UserDefaults.standard.set(markers, forKey: key)
        guard let stamp else { return false }
        return now.timeIntervalSince1970 - stamp < staleAfter
    }

    /// 테스트용 — 남은 표시를 전부 지운다.
    static func reset() {
        lastConsumedAt = [:]
        openObservations = [:]
        UserDefaults.standard.removeObject(forKey: key)
    }

    private static func load() -> [String: TimeInterval] {
        UserDefaults.standard.dictionary(forKey: key) as? [String: TimeInterval] ?? [:]
    }

    private static func prune(_ markers: inout [String: TimeInterval], now: Date) {
        let cutoff = now.timeIntervalSince1970 - staleAfter
        markers = markers.filter { $0.value >= cutoff }
    }
}
