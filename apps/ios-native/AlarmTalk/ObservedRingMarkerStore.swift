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
enum ObservedRingMarkerStore {
    private static let key = "observed_ring_markers"

    /// 표시가 오래 남아 다음 회차를 삼키지 않도록 두는 상한.
    ///
    /// 아무도 안 누른 울림은 표시를 그대로 남긴다(소비할 사람이 없다). 상한이 없으면 그
    /// 표시가 **다음 울림**을 관찰자가 적은 것으로 오인하게 만든다 — 그건 삼키는 쪽이라
    /// 더 나쁘다. 반복 알람의 가장 짧은 주기(하루)보다 넉넉히 짧게 잡는다.
    static let staleAfter: TimeInterval = 6 * 60 * 60

    /// 관찰자가 이번 회차를 적었다고 남긴다. **적은 뒤에** 부른다 — 순서를 뒤집으면
    /// 그 사이에 죽었을 때 적히지 않은 울림을 적힌 것으로 오인해 삼킨다.
    static func mark(alarmKitID: String, now: Date = Date()) {
        guard !alarmKitID.isEmpty else { return }
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
        var markers = load()
        let stamp = markers.removeValue(forKey: alarmKitID)
        prune(&markers, now: now)
        UserDefaults.standard.set(markers, forKey: key)
        guard let stamp else { return false }
        return now.timeIntervalSince1970 - stamp < staleAfter
    }

    /// 테스트용 — 남은 표시를 전부 지운다.
    static func reset() {
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
