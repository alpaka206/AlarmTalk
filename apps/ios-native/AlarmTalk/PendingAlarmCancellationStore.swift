import Foundation

/// **끊어야 하는데 아직 못 끊은 OS 예약의 UUID 목록.**
///
/// ⚠ **행 상태로 이걸 대신하지 말 것**(Codex #699 P1). 처음에는 "꺼졌는데 손잡이가 남은
/// 행" 으로 회수 대상을 골랐는데, 그 판정은 두 군데서 무너진다:
///
/// 1. 회수가 또 실패한 뒤 그 예약이 **울리면** `processAlarmUpdate` 의 `markRinging` 이
///    행을 `enabled = true` 로 되돌린다 → 다음 회차부터 대상에서 빠져 **영구 고아**가 된다.
///    회수하려던 바로 그 상태를 회수 시도가 만들어 내는 셈이다.
/// 2. `cancelScheduledAlarmsNotOwnedBy` 는 남의 계정 행을 **끄지 않는다**(그 의도는 그
///    사람 것이다). 그래서 그쪽 취소가 실패하면 행은 켜진 채라 애초에 대상이 아니다.
///
/// 그래서 **행이 아니라 UUID 를** 따로 적는다. 행 생애(켜짐·꺼짐·삭제·재예약)와 무관해지고,
/// 행이 새 UUID 로 다시 예약돼도 옛 고아를 잃지 않는다 — `alarmKitID` 한 칸으로는 둘을
/// 동시에 들 수 없다.
///
/// `UserDefaults` 에 두는 이유: 비밀이 아니고, 앱을 껐다 켜도 남아야 한다(못 끊은 예약은
/// 다음 실행에서 끊어야 한다).
enum PendingAlarmCancellationStore {

    private static let key = "pending_alarm_cancellations\(TestIsolation.storageSuffix)"

    private static var defaults: UserDefaults { .standard }

    /// 지금 끊어야 하는 예약들.
    static var all: [String] {
        defaults.stringArray(forKey: key) ?? []
    }

    /// 취소에 실패했을 때 적는다. 이미 있으면 그대로 둔다.
    static func add(_ alarmKitID: String?) {
        guard let id = alarmKitID?.nilIfBlank else { return }
        var current = all
        guard !current.contains(id) else { return }
        current.append(id)
        defaults.set(current, forKey: key)
    }

    /// 끊었거나, OS 에 더 이상 없다고 확인했을 때 지운다.
    static func remove(_ alarmKitID: String?) {
        guard let id = alarmKitID?.nilIfBlank else { return }
        let next = all.filter { $0 != id }
        guard next.count != all.count else { return }
        defaults.set(next, forKey: key)
    }

    /// 테스트 전용 — 회차 사이를 갈라 준다.
    static func removeAll() {
        defaults.removeObject(forKey: key)
    }
}
