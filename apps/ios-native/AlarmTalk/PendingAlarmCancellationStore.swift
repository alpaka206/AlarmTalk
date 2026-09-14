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

    /// 이 UUID 를 왜 끊으려 했는가.
    ///
    /// ⚠ **출처를 구분하지 않으면 회수가 남의 알람을 끈다**(Codex #699 P1).
    /// 회수는 끊은 뒤 **행도 끄는데**(울려서 되살아난 경우를 되돌리려고), 그 처리가 맞는
    /// 것은 **떠나는 계정의 종료**에서 온 UUID 뿐이다. 로그인 때 정리하는 **남의 계정**
    /// 예약은 행을 일부러 켜 둔 것이라(자동 401 로 세션만 잃었다) 끄면 그 사람이 돌아왔을 때
    /// 알람이 사라진다.
    enum Origin: String {
        /// 떠나는 계정의 종료 sweep — 행도 꺼져 있어야 한다.
        case accountLeave
        /// 로그인 시 남의 계정 예약 정리 — **행은 건드리지 않는다.**
        case foreignCleanup
        /// 받은 가족 알람이 같은 시각에서 밀어낸 알람 — **행도 꺼져 있어야 한다.**
        ///
        /// ⚠ `.foreignCleanup` 으로 두면 밀어낸 알람이 되살아난다(Codex #703 P1).
        /// 취소가 실패한 채 그 예약이 **울면** `markRinging` 이 행을 `enabled = true` 로
        /// 되돌리는데, 회수가 손잡이만 지우고 끝내면 그 행은
        /// `enabled = true, alarmKitID = nil` — 정확히 복구 후보라 곧바로 다시 예약된다.
        /// 밀어냈다는 결정이 조용히 취소되고, 다음 회차부터 **받은 알람과 나란히 운다.**
        case conflictDisplacement

        /// 회수가 끝났을 때 행을 **다시 꺼야 하는가.**
        ///
        /// 우리가 끄기로 정한 것(계정 종료·같은 시각 밀어내기)만 true 다. 남의 계정 정리는
        /// 행을 일부러 켜 둔 것이라(자동 401 로 세션만 잃었다) 여기서 끄면 그 사람이
        /// 돌아왔을 때 알람이 사라진다.
        var restoresDisabledRow: Bool {
            switch self {
            case .accountLeave, .conflictDisplacement: return true
            case .foreignCleanup: return false
            }
        }
    }

    /// 취소에 실패했을 때 적는다. 이미 있으면 그대로 둔다.
    ///
    /// - Parameter alarmID: 이 예약을 만든 **행**. ⚠ **적어 두지 않으면 고아를 잃는다**
    ///   (Codex #703 P1). 행의 `alarmKitID` 한 칸은 **지금 예약**을 가리키므로, 그 행이
    ///   다시 예약되는 순간 못 끊은 옛 손잡이는 **어디서도 참조되지 않는다** — 다음 회차의
    ///   전달 정리는 그것을 보지 못한 채 "끝났다" 고 답하고 ACK 가 서버 행을 지운다.
    ///   그러면 그 예약은 행 없이 울어 목록에 보이지도, 끌 수도 없다.
    static func add(_ alarmKitID: String?, origin: Origin, alarmID: String? = nil) {
        guard let id = alarmKitID?.nilIfBlank else { return }
        // ⚠ **이미 있어도 출처는 더 강한 쪽으로 올린다**(Codex #699 P2).
        // 남의 계정 정리에서 먼저 실패해 `.foreignCleanup` 으로 적힌 UUID 를, 뒤이어 **그
        // 주인이 명시적으로 로그아웃**하며 다시 실패해도 그냥 돌아가면 출처가 낡은 채 남는다.
        // 그 사이 고아가 울어 `markRinging` 이 행을 켜면, 회수는 낡은 출처를 보고 **행을 끄지
        // 않는다** — 명시적으로 로그아웃한 알람이 다음 로그인에 되살아난다.
        // '더 강한' 은 **행을 다시 꺼야 하는 쪽**이다(`restoresDisabledRow`) — 출처가 늘어도
        // 이 조건을 같이 고칠 필요가 없게 목록을 여기 베끼지 않는다.
        var origins = defaults.dictionary(forKey: originsKey) as? [String: String] ?? [:]
        if origin.restoresDisabledRow || origins[id] == nil {
            origins[id] = origin.rawValue
            defaults.set(origins, forKey: originsKey)
        }
        if let alarmID = alarmID?.nilIfBlank {
            var owners = defaults.dictionary(forKey: ownersKey) as? [String: String] ?? [:]
            owners[id] = alarmID
            defaults.set(owners, forKey: ownersKey)
        }
        var current = all
        guard !current.contains(id) else { return }
        current.append(id)
        defaults.set(current, forKey: key)
    }

    /// 그 행이 아직 못 끊은 예약들. 행의 `alarmKitID` 와 **무관하다** — 그게 요점이다.
    static func owedHandles(forAlarmID alarmID: String) -> [String] {
        guard let alarmID = alarmID.nilIfBlank else { return [] }
        let owners = defaults.dictionary(forKey: ownersKey) as? [String: String] ?? [:]
        return all.filter { owners[$0] == alarmID }
    }

    /// 그 UUID 의 출처. 기록이 없으면(이 빌드 이전) **행을 건드리지 않는 쪽**으로 본다 —
    /// 못 가릴 때는 남의 알람을 끄는 것보다 켜 둔 채 두는 편이 되돌릴 수 있다.
    static func origin(of alarmKitID: String) -> Origin {
        let origins = defaults.dictionary(forKey: originsKey) as? [String: String] ?? [:]
        return origins[alarmKitID].flatMap(Origin.init(rawValue:)) ?? .foreignCleanup
    }

    private static let originsKey = "pending_alarm_cancellation_origins\(TestIsolation.storageSuffix)"

    /// UUID → 그 예약을 만든 행 id.
    private static let ownersKey = "pending_alarm_cancellation_owners\(TestIsolation.storageSuffix)"

    /// 끊었거나, OS 에 더 이상 없다고 확인했을 때 지운다.
    static func remove(_ alarmKitID: String?) {
        guard let id = alarmKitID?.nilIfBlank else { return }
        var origins = defaults.dictionary(forKey: originsKey) as? [String: String] ?? [:]
        if origins.removeValue(forKey: id) != nil { defaults.set(origins, forKey: originsKey) }
        var owners = defaults.dictionary(forKey: ownersKey) as? [String: String] ?? [:]
        if owners.removeValue(forKey: id) != nil { defaults.set(owners, forKey: ownersKey) }
        let next = all.filter { $0 != id }
        guard next.count != all.count else { return }
        defaults.set(next, forKey: key)
    }

    /// 테스트 전용 — 회차 사이를 갈라 준다.
    static func removeAll() {
        defaults.removeObject(forKey: key)
        defaults.removeObject(forKey: originsKey)
        defaults.removeObject(forKey: ownersKey)
    }
}
